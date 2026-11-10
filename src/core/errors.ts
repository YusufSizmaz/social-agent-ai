/** An error that will fail the same way on every attempt, so the job should not be retried */
export class NonRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NonRetryableError';
  }
}

/**
 * drizzle-orm wraps driver errors in a DrizzleQueryError ("Failed query: <sql> params: <values>")
 * and keeps the PostgreSQL error as `cause`. Returns that underlying error, or the error itself.
 */
function rootError(err: unknown): unknown {
  let current = err;
  for (let depth = 0; depth < 5; depth++) {
    const cause = (current as { cause?: unknown } | null)?.cause;
    if (!(current instanceof Error) || !current.message.startsWith('Failed query:') || cause === undefined) break;
    current = cause;
  }
  return current;
}

/** Error code (e.g. PostgreSQL SQLSTATE '23505' or 'ECONNREFUSED'), looking through drizzle's wrapper */
export function errorCode(err: unknown): unknown {
  return (rootError(err) as { code?: unknown } | null)?.code;
}

export function errorMessage(err: unknown): string {
  // Never surface drizzle's "Failed query" text: it includes the query parameters (e.g. credentials)
  err = rootError(err);
  if (!(err instanceof Error)) return String(err);
  if (err.message) return err.message;
  // Node reports failed multi-address connections as an AggregateError with an empty message
  const inner = err instanceof AggregateError ? err.errors.find((e) => e instanceof Error && e.message) : undefined;
  const code = (err as { code?: unknown }).code;
  return inner?.message ?? (typeof code === 'string' ? code : err.name);
}

/** Stack trace of the underlying error (drizzle's wrapper stack starts with the query parameters) */
export function errorStack(err: unknown): string | undefined {
  const root = rootError(err);
  return root instanceof Error ? root.stack : undefined;
}

/** True when the error means PostgreSQL could not be reached at all */
export function isConnectionRefused(err: unknown): boolean {
  const code = errorCode(err);
  return code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ETIMEDOUT';
}

/** Thrown when a job should run again later without spending one of its attempts */
export class DeferJobError extends Error {
  constructor(message: string, readonly runAt: Date) {
    super(message);
    this.name = 'DeferJobError';
  }
}

/** HTTP status carried by SDK errors (@google/genai uses `status`, twitter-api-v2 uses `code`) */
export function httpStatus(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  for (const key of ['status', 'code', 'statusCode'] as const) {
    const value = (err as Record<string, unknown>)[key];
    if (typeof value === 'number' && value >= 100 && value < 600) return value;
  }
  return undefined;
}

/**
 * Client errors (bad credentials, invalid input, forbidden) won't succeed on retry.
 * Rate limits (429) and timeouts (408) are worth retrying, as is anything without a status.
 */
const DEFAULT_RATE_LIMIT_BACKOFF_MS = 15 * 60 * 1000;

/**
 * For rate-limit errors (429), how long to wait before trying again. Uses the reset time the
 * platform reported (twitter-api-v2 exposes `rateLimit.reset` in epoch seconds) or a Retry-After
 * header, falling back to 15 minutes. Returns 0 for any other error.
 */
export function rateLimitBackoffMs(err: unknown, now = Date.now()): number {
  if (httpStatus(err) !== 429) return 0;
  const e = err as { rateLimit?: { reset?: unknown }; headers?: Record<string, unknown> };

  const reset = Number(e.rateLimit?.reset);
  if (Number.isFinite(reset) && reset > 0) {
    return Math.max(60_000, reset * 1000 - now + 5_000);
  }

  const retryAfter = Number(e.headers?.['retry-after']);
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.max(60_000, retryAfter * 1000);
  }

  return DEFAULT_RATE_LIMIT_BACKOFF_MS;
}

export function isRetryable(err: unknown): boolean {
  if (err instanceof NonRetryableError) return false;
  const status = httpStatus(err);
  if (status === undefined) return true;
  return status === 408 || status === 429 || status >= 500;
}
