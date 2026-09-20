import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response
} from "express";
import { Command } from "commander";

import { logger, type Logger } from "./logger";
import { httpLogger } from "../middleware/httpLogger";
import { requestLifecycleLogger } from "../middleware/requestLifecycleLogger";

export type ServerOptions = {
  serviceName: string;
  host: string;
  port: number;
  corsOrigins: string[];
};

export function normalizeCorsOrigins(value: string | undefined): string[] {
  if (value === undefined) {
    return [];
  }
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "" || trimmed === "false" || trimmed === "none") {
    return [];
  }
  return [
    ...new Set(
      value
        .split(",")
        .map((segment) => segment.trim())
        .filter(Boolean)
    )
  ];
}

function corsAllowlistMiddleware(
  allowedOrigins: string[]
): (req: Request, res: Response, next: NextFunction) => void {
  const allowed = new Set(allowedOrigins);
  return (req: Request, res: Response, next: NextFunction): void => {
    const origin = req.get("Origin");
    if (origin && allowed.has(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.append("Vary", "Origin");
    }

    if (req.method === "OPTIONS") {
      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET,POST,PUT,PATCH,DELETE,OPTIONS"
      );
      const requestedHeaders = req.get("Access-Control-Request-Headers");
      if (requestedHeaders) {
        res.setHeader("Access-Control-Allow-Headers", requestedHeaders);
      }
      res.sendStatus(204);
      return;
    }

    next();
  };
}

export type ServerContext = {
  options: ServerOptions;
  log: Logger;
};

export interface IServerContext {
  run: () => void;
  registerRoutes: () => void;
  getApp: () => Express;
  options: ServerOptions;
  log: Logger;
}

export function initializeServerOptions(): Command {
  const program = new Command();
  const defaultCorsOrigins =
    process.env.CORS_ORIGINS !== undefined
      ? process.env.CORS_ORIGINS
      : "http://localhost:5173,http://127.0.0.1:5173";

  program
    .name("sutra")
    .option("--service-name <string>", "Service name", "sutra")
    .option("--port <number>", "Port for HTTP server", process.env.PORT ?? "3000")
    .option("--host <string>", "Host for HTTP server", process.env.HOST ?? "0.0.0.0")
    .option(
      "--cors-origins <string>",
      "Comma-separated allowed CORS origins; empty or false disables",
      normalizeCorsOrigins,
      defaultCorsOrigins.split(",")
    );

  return program;
}

export function initializeServerContext(options: ServerOptions): ServerContext {
  return {
    options,
    log: logger
  };
}

export class ExpressServer implements IServerContext {
  protected readonly app: Express;
  protected readonly serviceName: string;
  public readonly log: Logger;
  public readonly options: ServerOptions;

  constructor(context: ServerContext) {
    this.options = context.options;
    this.serviceName = context.options.serviceName;
    this.app = express();
    this.log = context.log;
  }

  public registerRoutes(): void {
    if (this.options.corsOrigins.length > 0) {
      this.app.use(corsAllowlistMiddleware(this.options.corsOrigins));
    }

    this.app.use(express.json());
    this.app.use(requestLifecycleLogger);
    this.app.use(httpLogger);

    this.app.get("/health", (_req: Request, res: Response) => {
      res.status(200).json({
        status: "ok",
        service: this.serviceName,
        timestamp: new Date().toISOString()
      });
    });

    this.app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
      this.log.error("request_failed", {
        requestId: req.requestId ?? "unknown",
        method: req.method,
        path: req.originalUrl,
        message: err.message
      });

      res.status(500).json({
        message: "Internal server error",
        requestId: req.requestId ?? "unknown"
      });
    });
  }

  public getApp(): Express {
    return this.app;
  }

  public run(): void {
    this.registerRoutes();

    this.app.listen(this.options.port, this.options.host, () => {
      this.log.info("server_started", {
        service: this.serviceName,
        host: this.options.host,
        port: this.options.port
      });
    });
  }
}
