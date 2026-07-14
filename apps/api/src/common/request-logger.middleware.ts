import { randomUUID } from 'crypto';
import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

const logger = new Logger('HTTP');

/**
 * Phase 9 (production hardening — observability): every request gets a
 * correlation ID, trusting an upstream-supplied `x-request-id` if present
 * (e.g. Azure Front Door/App Gateway already generates one) rather than
 * always minting a fresh one, so a single request can be traced end-to-end
 * across whatever sits in front of this API. Echoed back on the response
 * header so a client-visible error can be matched to a specific log line
 * without any log aggregation tooling.
 *
 * Runs as raw Express middleware (not a guard/interceptor) specifically so
 * it executes before EntraJwtGuard — an unauthenticated or malformed
 * request still gets a request ID and a logged line, which is exactly the
 * traffic most worth being able to correlate.
 *
 * Deliberately does not log headers or body — request/response line only
 * (method, path, status, duration, requestId). Never logs the
 * Authorization header or any other credential.
 */
export function requestLoggerMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = req.headers['x-request-id']?.toString() ?? randomUUID();
  req.requestId = requestId;
  res.setHeader('x-request-id', requestId);

  const startedAt = Date.now();
  res.on('finish', () => {
    const durationMs = Date.now() - startedAt;
    logger.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${durationMs}ms [${requestId}]`);
  });

  next();
}
