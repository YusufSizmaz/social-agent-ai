import { Platform, QUEUE_POLL_INTERVAL_MS, JobType } from '../config/constants.js';
import { logger } from '../config/logger.js';
import type { PlatformAdapter, ProjectPlugin, ContentRequest, GeneratedContent } from '../types/index.js';
import { dequeueJob, completeJob, failJob, enqueueJob } from './queue.js';
import { startAllCrons, stopAllCrons, registerCron } from './scheduler.js';

export class Engine {
  private adapters = new Map<Platform, PlatformAdapter>();
  private plugins = new Map<string, ProjectPlugin>();
  private running = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  registerAdapter(adapter: PlatformAdapter): void {
    this.adapters.set(adapter.platform, adapter);
    logger.info(`Adapter registered: ${adapter.platform}`);
  }

  registerPlugin(plugin: ProjectPlugin): void {
    this.plugins.set(plugin.name, plugin);
    logger.info(`Plugin registered: ${plugin.name}`);
  }

  getAdapter(platform: Platform): PlatformAdapter | undefined {
    return this.adapters.get(platform);
  }

  getPlugin(name: string): ProjectPlugin | undefined {
    return this.plugins.get(name);
  }

  async start(): Promise<void> {
    logger.info('Engine starting...');

    for (const adapter of this.adapters.values()) {
      await adapter.init();
    }

    for (const plugin of this.plugins.values()) {
      await plugin.init();
    }

    registerCron('poll-plugins', '*/5 * * * *', () => this.pollPlugins());

    startAllCrons();
    this.startJobPolling();
    this.running = true;

    logger.info('Engine started successfully', {
      adapters: [...this.adapters.keys()],
      plugins: [...this.plugins.keys()],
    });
  }

  async stop(): Promise<void> {
    logger.info('Engine stopping...');
    this.running = false;

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    stopAllCrons();

    for (const plugin of this.plugins.values()) {
      await plugin.destroy();
    }

    for (const adapter of this.adapters.values()) {
      await adapter.destroy();
    }

    logger.info('Engine stopped');
  }

  private startJobPolling(): void {
    this.pollTimer = setInterval(() => {
      if (this.running) {
        this.processNextJob().catch((err) => {
          logger.error('Job processing error', { error: err instanceof Error ? err.message : String(err) });
        });
      }
    }, QUEUE_POLL_INTERVAL_MS);
  }

  private async processNextJob(): Promise<void> {
    const job = await dequeueJob();
    if (!job) return;

    logger.info(`Processing job ${job.id} (${job.type})`, { attempt: job.attempts });

    try {
      switch (job.type) {
        case JobType.GENERATE_CONTENT:
          await this.handleGenerateContent(job.payload);
          break;
        case JobType.PUBLISH_POST:
          await this.handlePublishPost(job.payload);
          break;
        case JobType.FETCH_ANALYTICS:
          await this.handleFetchAnalytics(job.payload);
          break;
        case JobType.POLL_SOURCE:
          await this.pollPlugins();
          break;
        default:
          logger.warn(`Unknown job type: ${job.type}`);
      }
      await completeJob(job.id);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const canRetry = job.attempts < job.maxAttempts;
      await failJob(job.id, errorMsg, canRetry);

      if (!canRetry) {
        logger.error(`Job ${job.id} permanently failed`, { error: errorMsg });
      }
    }
  }

  private async pollPlugins(): Promise<void> {
    for (const plugin of this.plugins.values()) {
      try {
        const requests = await plugin.poll();
        for (const request of requests) {
          await enqueueJob(JobType.GENERATE_CONTENT, {
            pluginName: plugin.name,
            request,
          });
        }
        if (requests.length > 0) {
          logger.info(`Plugin "${plugin.name}" produced ${requests.length} content requests`);
        }
      } catch (err) {
        logger.error(`Plugin "${plugin.name}" poll failed`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  private async handleGenerateContent(payload: Record<string, unknown>): Promise<void> {
    const pluginName = payload['pluginName'] as string;
    const request = payload['request'] as ContentRequest;
    const plugin = this.plugins.get(pluginName);

    if (!plugin) {
      throw new Error(`Plugin not found: ${pluginName}`);
    }

    // Actual content generation is handled by AI modules (Stage 2)
    logger.info(`Content generation requested for ${pluginName}`, { platform: request.platform });
  }

  private async handlePublishPost(payload: Record<string, unknown>): Promise<void> {
    const platform = payload['platform'] as Platform;
    const adapter = this.adapters.get(platform);

    if (!adapter) {
      throw new Error(`No adapter for platform: ${platform}`);
    }

    const content = payload['content'] as GeneratedContent;
    const accountId = payload['accountId'] as string;

    const result = await adapter.post(content, accountId);
    if (!result.success) {
      throw new Error(result.error ?? 'Post failed');
    }

    logger.info(`Post published on ${platform}`, { platformPostId: result.platformPostId });
  }

  private async handleFetchAnalytics(payload: Record<string, unknown>): Promise<void> {
    const platform = payload['platform'] as Platform;
    const adapter = this.adapters.get(platform);

    if (!adapter) {
      throw new Error(`No adapter for platform: ${platform}`);
    }

    const platformPostId = payload['platformPostId'] as string;
    const accountId = payload['accountId'] as string;

    const analytics = await adapter.getAnalytics(platformPostId, accountId);
    logger.debug(`Analytics fetched for ${platformPostId}`, analytics);
  }
}

export const engine = new Engine();
