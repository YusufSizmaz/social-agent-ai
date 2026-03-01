import PQueue from 'p-queue';
import { Platform, RATE_LIMITS } from '../config/constants.js';
import { logger } from '../config/logger.js';

const queues = new Map<string, PQueue>();

function getKey(platform: Platform, accountId: string): string {
  return `${platform}:${accountId}`;
}

function getOrCreateQueue(platform: Platform, accountId: string): PQueue {
  const key = getKey(platform, accountId);
  let queue = queues.get(key);
  if (!queue) {
    const limits = RATE_LIMITS[platform];
    queue = new PQueue({
      concurrency: 1,
      interval: limits.minIntervalMs,
      intervalCap: 1,
    });
    queues.set(key, queue);
    logger.debug(`Rate limiter created for ${key}`, { minIntervalMs: limits.minIntervalMs });
  }
  return queue;
}

export async function rateLimited<T>(
  platform: Platform,
  accountId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const queue = getOrCreateQueue(platform, accountId);
  return queue.add(fn) as Promise<T>;
}

export function clearRateLimiters(): void {
  for (const queue of queues.values()) {
    queue.clear();
  }
  queues.clear();
}
