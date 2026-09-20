import { type Request, type Response, type Express } from "express";

import {
  ExpressServer,
  initializeServerContext,
  initializeServerOptions,
  type ServerContext,
  type ServerOptions
} from "../../lib/base-server";
import { appendOpenAIConfigOptions } from "../../lib/openrouter";
import {
  appendPostgresOptions,
  DbService,
  resolvePostgresOptions,
  type RawPostgresOptions
} from "../../lib/postgres-prisma";

export type SutraContext = ServerContext & { db?: DbService };

export const initializeAppOptions = (
  argv: string[] = process.argv
): Record<string, unknown> => {
  return appendPostgresOptions(appendOpenAIConfigOptions(initializeServerOptions()))
    .parse(argv)
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
  const db = new DbService(
    resolvePostgresOptions({
      pgHost: opts.pgHost as string | undefined,
      pgPort: opts.pgPort as string | number | undefined,
      pgUser: opts.pgUser as string | undefined,
      pgPassword: opts.pgPassword as string | undefined,
      pgDatabase: opts.pgDatabase as string | undefined,
      pgSsl: opts.pgSsl as boolean | string | undefined
    } satisfies RawPostgresOptions)
  );
  await db.connect();
  return { ...context, db };
};

export class SutraServer extends ExpressServer {
  public readonly db?: DbService;

  constructor(context: SutraContext) {
    super(context);
    this.db = context.db;
  }

  override registerRoutes(): void {
    super.registerRoutes();

    this.app.get("/sutra", (_req: Request, res: Response) => {
      res.status(200).json({
        status: "ok",
        service: this.options.serviceName
      });
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
