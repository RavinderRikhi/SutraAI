import type { NextFunction, Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";

import { logger } from "../lib/logger";

const REDACTED_HEADERS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key"
]);

function sanitizeHeaders(headers: Request["headers"]): Record<string, unknown> {
  return Object.entries(headers).reduce<Record<string, unknown>>(
    (acc, [key, value]) => {
      acc[key] = REDACTED_HEADERS.has(key.toLowerCase()) ? "[REDACTED]" : value;
      return acc;
    },
    {}
  );
}

export function requestLifecycleLogger(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const requestId = uuidv4();
  const startHrTime = process.hrtime.bigint();
  req.requestId = requestId;
  res.setHeader("x-request-id", requestId);

  logger.info("request_received", {
    requestId,
    method: req.method,
    path: req.originalUrl,
    ip: req.ip,
    userAgent: req.get("user-agent") ?? null,
    headers: sanitizeHeaders(req.headers)
  });

  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startHrTime) / 1_000_000;
    logger.info("request_completed", {
      requestId,
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: Number(durationMs.toFixed(2))
    });
  });

  res.on("close", () => {
    if (res.writableEnded) {
      return;
    }

    const durationMs = Number(process.hrtime.bigint() - startHrTime) / 1_000_000;
    logger.error("request_failed", {
      requestId,
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: Number(durationMs.toFixed(2)),
      reason: "connection_closed_before_response"
    });
  });

  next();
}
