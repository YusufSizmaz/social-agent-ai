import { RETRY_CONFIG } from '../config/constants.js';
import { logger } from '../config/logger.js';

export async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  maxRetries = RETRY_CONFIG.maxRetries,
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt === maxRetries) break;

      const delay = Math.min(
        RETRY_CONFIG.baseDelayMs * Math.pow(2, attempt) + Math.random() * 1000,
        RETRY_CONFIG.maxDelayMs,
      );

      logger.warn(`Retry ${attempt + 1}/${maxRetries} for "${label}" in ${Math.round(delay)}ms`, {
        error: lastError.message,
      });

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
