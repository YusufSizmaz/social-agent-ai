import { RETRY_CONFIG } from '../config/constants.js';
import { logger } from '../config/logger.js';
import { httpStatus, isRetryable } from './errors.js';

export async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  maxRetries = RETRY_CONFIG.maxRetries,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      // A 429 won't clear within a few seconds; let the job queue reschedule after the reset time
      if (attempt === maxRetries || !isRetryable(err) || httpStatus(err) === 429) break;

      const delay = Math.min(
        RETRY_CONFIG.baseDelayMs * Math.pow(2, attempt) + Math.random() * 1000,
        RETRY_CONFIG.maxDelayMs,
      );

      logger.warn(`Retry ${attempt + 1}/${maxRetries} for "${label}" in ${Math.round(delay)}ms`, {
        error: err instanceof Error ? err.message : String(err),
      });

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
