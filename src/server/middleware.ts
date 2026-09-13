import { timingSafeEqual } from 'crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z, type ZodTypeAny } from 'zod';
import { logger } from '../config/logger.js';
import { errorMessage, isConnectionRefused } from '../core/errors.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/**
 * HTTP Basic Auth for the dashboard and API. Disabled when no password is configured.
 * `publicPaths` are matched by prefix and skip authentication (health checks, OAuth callbacks).
 */
export function basicAuth(options: { username: string; password?: string; publicPaths: string[] }): RequestHandler {
  const { username, password, publicPaths } = options;

  return (req, res, next) => {
    if (!password || publicPaths.some((p) => req.path === p || req.path.startsWith(`${p}/`))) {
      next();
      return;
    }

    const header = req.headers.authorization ?? '';
    const [scheme, encoded] = header.split(' ');
    if (scheme === 'Basic' && encoded) {
      const decoded = Buffer.from(encoded, 'base64').toString('utf8');
      const sep = decoded.indexOf(':');
      if (sep >= 0 && safeEqual(decoded.slice(0, sep), username) && safeEqual(decoded.slice(sep + 1), password)) {
        next();
        return;
      }
    }

    res.setHeader('WWW-Authenticate', 'Basic realm="Social Agent AI", charset="UTF-8"');
    res.status(401).json({ error: 'Authentication required' });
  };
}

/** Rejects requests whose `:id` route parameter is not a UUID (avoids leaking Postgres errors) */
export const requireUuidParam: RequestHandler = (req, res, next) => {
  if (req.params['id'] !== undefined && !isUuid(req.params['id'])) {
    res.status(400).json({ error: 'Invalid id' });
    return;
  }
  next();
};

/** Parses a request body with a zod schema, responding 400 with readable issues on failure */
export function parseBody<T extends ZodTypeAny>(schema: T, req: Request, res: Response): z.infer<T> | undefined {
  const result = schema.safeParse(req.body ?? {});
  if (!result.success) {
    res.status(400).json({
      error: 'Invalid request body',
      issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
    return undefined;
  }
  return result.data;
}

/** Wraps async route handlers so rejected promises reach the error handler */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const status = (err as { status?: number; statusCode?: number })?.status
    ?? (err as { statusCode?: number })?.statusCode
    ?? 500;

  if (status >= 500) {
    logger.error(`${req.method} ${req.path} failed`, {
      error: errorMessage(err),
      ...(isConnectionRefused(err) ? {} : { stack: err instanceof Error ? err.stack : undefined }),
    });
  }

  if (res.headersSent) return;

  res.status(status).json({
    error: status >= 500 ? 'Internal server error' : (err instanceof Error ? err.message : 'Bad request'),
  });
}
