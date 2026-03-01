import type { Platform } from '../config/constants.js';
import type { PlatformAdapter, GeneratedContent, PlatformPostResult, PostAnalyticsData } from '../types/index.js';
import { rateLimited } from '../core/rate-limiter.js';
import { withRetry } from '../core/retry.js';
import { logger } from '../config/logger.js';

export abstract class BasePlatformAdapter implements PlatformAdapter {
  abstract platform: Platform;

  abstract init(): Promise<void>;
  abstract destroy(): Promise<void>;

  protected abstract doPost(content: GeneratedContent, accountId: string): Promise<PlatformPostResult>;
  protected abstract doDelete(platformPostId: string, accountId: string): Promise<boolean>;
  protected abstract doGetAnalytics(platformPostId: string, accountId: string): Promise<PostAnalyticsData>;

  async post(content: GeneratedContent, accountId: string): Promise<PlatformPostResult> {
    return rateLimited(this.platform, accountId, () =>
      withRetry(() => this.doPost(content, accountId), `${this.platform}.post`),
    );
  }

  async delete(platformPostId: string, accountId: string): Promise<boolean> {
    return rateLimited(this.platform, accountId, () =>
      withRetry(() => this.doDelete(platformPostId, accountId), `${this.platform}.delete`),
    );
  }

  async getAnalytics(platformPostId: string, accountId: string): Promise<PostAnalyticsData> {
    return rateLimited(this.platform, accountId, () =>
      withRetry(() => this.doGetAnalytics(platformPostId, accountId), `${this.platform}.getAnalytics`),
    );
  }

  protected log(message: string, meta?: Record<string, unknown>): void {
    logger.info(`[${this.platform}] ${message}`, meta);
  }
}
