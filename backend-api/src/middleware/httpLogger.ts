import morgan from "morgan";
import type { Request } from "express";

import { logger } from "../lib/logger";

morgan.token("request-id", (req) => (req as Request).requestId ?? "unknown");

export const httpLogger = morgan(
  ":request-id :method :url :status :res[content-length] - :response-time ms",
  {
    stream: {
      write: (message: string) => {
        logger.info("http_access", { message: message.trim() });
      }
    }
  }
);
