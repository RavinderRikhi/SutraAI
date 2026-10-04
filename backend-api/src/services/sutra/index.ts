import { type Request, type Response, type Express } from "express";

import {
  ExpressServer,
  initializeServerContext,
  initializeServerOptions,
  type ServerContext,
  type ServerOptions
} from "../../lib/base-server";
import type OpenAI from "openai";

import { appendOpenAIConfigOptions, createOpenRouterClient } from "../../lib/openrouter";
import {
  buildChatSystemPrompt,
  createChatCompletion,
  parseChatModelPayload,
  parseChatRequestBody
} from "./chatHandler";
import {
  chunkText,
  extractTextFromUpload,
  isAllowedUploadExtension,
  multerLimitMessage,
  uploadDocuments
} from "./documentUpload";
import {
  appendPostgresOptions,
  DbService,
  resolvePostgresOptions,
  type RawPostgresOptions
} from "../../lib/postgres-prisma";

export type SutraContext = ServerContext & {
  db?: DbService;
  openRouter?: OpenAI;
};

function argvForCommander(argv: string[]): string[] {
  const dashDash = argv.indexOf("--");
  if (dashDash === -1) {
    return argv;
  }
  return ["node", "sutra", ...argv.slice(dashDash + 1)];
}

export const initializeAppOptions = (
  argv: string[] = process.argv
): Record<string, unknown> => {
  const commanderArgv = argvForCommander(argv);
  return appendPostgresOptions(appendOpenAIConfigOptions(initializeServerOptions()))
    .parse(commanderArgv)
    .opts() as Record<string, unknown>;
};

export const initializeApp = async (
  args: string[] = process.argv
): Promise<SutraContext> => {
  const opts = initializeAppOptions(args);
  const options: ServerOptions = {
    serviceName: String(opts.serviceName ?? "sutra"),
    host: String(opts.host ?? "0.0.0.0"),
    port: Number(opts.port ?? 3000),
    corsOrigins: Array.isArray(opts.corsOrigins)
      ? (opts.corsOrigins as string[])
      : []
  };
  const context = initializeServerContext(options);
  const pgOptions = resolvePostgresOptions({
    pgConnectionString: opts.pgConnectionString as string | undefined,
    pgHost: opts.pgHost as string | undefined,
    pgPort: opts.pgPort as string | number | undefined,
    pgUser: opts.pgUser as string | undefined,
    pgPassword: opts.pgPassword as string | undefined,
    pgDatabase: opts.pgDatabase as string | undefined,
    pgSsl: opts.pgSsl as boolean | string | undefined
  } satisfies RawPostgresOptions);
  const db = new DbService(pgOptions);
  await db.connect();
  context.log.info("postgres_connected", {
    host: pgOptions.host,
    port: pgOptions.port,
    database: pgOptions.database
  });
  const openRouter = createOpenRouterClient({
    apiKey: String(opts.openrouterApiKey ?? ""),
    baseURL: String(opts.openrouterBaseUrl ?? ""),
    httpReferer: String(opts.openrouterHttpReferer ?? ""),
    appTitle: String(opts.openrouterAppTitle ?? "")
  });
  context.log.info("openrouter_client_created", {
    baseURL: openRouter.baseURL
  });
  return { ...context, db, openRouter };
};

function jsonError(
  res: Response,
  status: number,
  message: string,
  requestId?: string
): void {
  res.status(status).json({
    message,
    ...(requestId ? { requestId } : {})
  });
}

function isPrismaNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: string }).code === "P2025"
  );
}

export class SutraServer extends ExpressServer {
  public readonly db?: DbService;
  public readonly openRouter?: OpenAI;

  constructor(context: SutraContext) {
    super(context);
    this.db = context.db;
    this.openRouter = context.openRouter;
  }

  override registerRoutes(): void {
    super.registerRoutes();

    this.app.get("/sutra", (_req: Request, res: Response) => {
      res.status(200).json({
        status: "ok",
        service: this.options.serviceName
      });
    });

    this.app.post("/api/chat", (req: Request, res: Response, next) => {
      void this.handleChatPost(req, res).catch(next);
    });

    this.app.post("/api/documents/upload", (req: Request, res: Response, next) => {
      uploadDocuments(req, res, (err: unknown) => {
        if (err) {
          const limitMessage = multerLimitMessage(err);
          if (limitMessage !== null) {
            jsonError(res, 400, limitMessage, req.requestId);
            return;
          }
          next(err);
          return;
        }
        void this.handleDocumentUpload(req, res).catch(next);
      });
    });
  }

  private async handleChatPost(req: Request, res: Response): Promise<void> {
    const requestId = req.requestId;
    const parsed = parseChatRequestBody(req.body);
    if (parsed === null) {
      jsonError(res, 400, "Invalid chat request", requestId);
      return;
    }

    if (this.db === undefined || this.openRouter === undefined) {
      jsonError(res, 503, "Chat unavailable", requestId);
      return;
    }

    const { subdomainSlug, messages, jsonState } = parsed;

    this.log.info("chat_request", {
      requestId: requestId ?? "unknown",
      subdomainSlug,
      messageCount: messages.length
    });

    const tenant = await this.db.getTenantBySlug(subdomainSlug);
    if (tenant === null) {
      this.log.info("chat_error", {
        requestId: requestId ?? "unknown",
        subdomainSlug,
        message: "Tenant not found"
      });
      jsonError(res, 404, "Tenant not found", requestId);
      return;
    }

    const systemContent = buildChatSystemPrompt(tenant, jsonState);

    let content: string | null | undefined;
    try {
      const completion = await createChatCompletion(
        this.openRouter,
        systemContent,
        messages
      );
      content = completion.choices[0]?.message?.content;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log.error("chat_error", {
        requestId: requestId ?? "unknown",
        subdomainSlug,
        message
      });
      jsonError(res, 502, "Chat model failed", requestId);
      return;
    }

    const modelPayload = parseChatModelPayload(content);
    if (modelPayload === null) {
      this.log.error("chat_error", {
        requestId: requestId ?? "unknown",
        subdomainSlug,
        message: "Invalid model response"
      });
      jsonError(res, 502, "Invalid model response", requestId);
      return;
    }

    try {
      await this.db.updateTenantState(subdomainSlug, modelPayload.jsonState);
    } catch (error) {
      if (isPrismaNotFound(error)) {
        jsonError(res, 404, "Tenant not found", requestId);
        return;
      }
      throw error;
    }

    this.log.info("chat_ok", {
      requestId: requestId ?? "unknown",
      subdomainSlug
    });

    res.status(200).json({
      reply: modelPayload.reply,
      jsonState: modelPayload.jsonState
    });
  }

  private async handleDocumentUpload(req: Request, res: Response): Promise<void> {
    const requestId = req.requestId;

    if (this.db === undefined) {
      jsonError(res, 503, "Upload unavailable", requestId);
      return;
    }

    const subdomainSlug =
      typeof req.body?.subdomainSlug === "string" ? req.body.subdomainSlug.trim() : "";
    const files = Array.isArray(req.files) ? req.files : [];

    if (subdomainSlug === "" || files.length === 0) {
      jsonError(res, 400, "Invalid upload request", requestId);
      return;
    }

    if (!files.every((f) => isAllowedUploadExtension(f.originalname))) {
      jsonError(res, 400, "Only .pdf and .txt files are allowed", requestId);
      return;
    }

    const fileResults: Array<{ filename: string; chunksIngested: number }> = [];
    const allChunks: Array<{ filename: string; content: string }> = [];

    for (const file of files) {
      const text = await extractTextFromUpload({
        originalname: file.originalname,
        buffer: file.buffer
      });
      if (text.trim() === "") {
        jsonError(res, 400, "No extractable text", requestId);
        return;
      }
      const chunks = chunkText(text).map((content) => ({
        filename: file.originalname,
        content
      }));
      fileResults.push({
        filename: file.originalname,
        chunksIngested: chunks.length
      });
      allChunks.push(...chunks);
    }

    try {
      await this.db.saveDocumentChunks(subdomainSlug, allChunks);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith("Tenant not found:")) {
        jsonError(res, 404, "Tenant not found", requestId);
        return;
      }
      throw error;
    }

    this.log.info("documents_uploaded", {
      requestId: requestId ?? "unknown",
      subdomainSlug,
      fileCount: files.length,
      chunksIngested: allChunks.length
    });

    res.status(200).json({
      success: true,
      message: "Documents ingested successfully",
      files: fileResults
    });
  }
}

export function createSutraApp(options?: ServerOptions): Express {
  const resolved: ServerOptions =
    options ?? {
      serviceName: "sutra",
      host: "0.0.0.0",
      port: 3000,
      corsOrigins: []
    };
  const context = initializeServerContext(resolved);
  const server = new SutraServer(context);
  server.registerRoutes();
  return server.getApp();
}

if (require.main === module) {
  initializeApp(process.argv)
    .then((context) => {
      const server = new SutraServer(context);
      server.run();

      const shutdown = (): void => {
        const done = context.db?.disconnect() ?? Promise.resolve();
        done
          .catch((error) => {
            console.error(error);
          })
          .finally(() => {
            process.exit(0);
          });
      };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
