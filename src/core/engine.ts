import { eq } from 'drizzle-orm';
import { Platform, QUEUE_POLL_INTERVAL_MS, JobType } from '../config/constants.js';
import { logger } from '../config/logger.js';
import type { PlatformAdapter, ProjectPlugin, ContentRequest, GeneratedContent, AccountStrategy } from '../types/index.js';
import { dequeueJob, completeJob, failJob, enqueueJob } from './queue.js';
import { startAllCrons, stopAllCrons, registerCron } from './scheduler.js';
import { syncAccountCrons } from './account-scheduler.js';
import { generateText } from '../ai/text-generator.js';
import { db, schema } from '../db/index.js';
import { notifyPostPublished, notifyPostFailed, notifyContentGenerated, notifyDailySummary } from '../notifications/whatsapp.js';
import { trackAllPublishedPosts, trackPostAnalytics } from '../analytics/tracker.js';
import { generateReport } from '../analytics/reporter.js';
import { optimizeStrategies } from './strategy-optimizer.js';

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
    registerCron('track-analytics', '0 */6 * * *', async () => { await trackAllPublishedPosts(); });
    registerCron('daily-report', '0 23 * * *', () => this.sendDailyReport());
    registerCron('optimize-strategies', '0 2 * * 1', () => optimizeStrategies());

    await syncAccountCrons();

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
    // Account-strategy-based generation
    if (payload['strategy'] && payload['accountId']) {
      await this.handleStrategyGeneration(payload);
      return;
    }

    // Plugin-based generation (legacy path)
    const pluginName = payload['pluginName'] as string;
    const request = payload['request'] as ContentRequest;
    const plugin = this.plugins.get(pluginName);

    if (!plugin) {
      throw new Error(`Plugin not found: ${pluginName}`);
    }

    const content = await generateText(request);

    const [post] = await db
      .insert(schema.posts)
      .values({
        projectId: request.projectId,
        accountId: (payload['accountId'] as string) || request.projectId,
        platform: request.platform as 'twitter' | 'instagram' | 'youtube' | 'tiktok',
        contentType: request.contentType as 'text' | 'image' | 'video' | 'story' | 'reel' | 'short',
        text: content.text,
        hashtags: content.hashtags,
        mediaUrls: content.mediaUrls ?? [],
        status: 'publishing',
        tone: request.tone as 'emotional' | 'informative' | 'urgent' | 'hopeful' | 'friendly',
      })
      .returning();

    logger.info(`Content generated for plugin ${pluginName}`, { postId: post!.id });

    await enqueueJob(JobType.PUBLISH_POST, {
      postId: post!.id,
      platform: request.platform,
      accountId: payload['accountId'] as string,
      content,
    });
  }

  private async handleStrategyGeneration(payload: Record<string, unknown>): Promise<void> {
    const accountId = payload['accountId'] as string;
    const projectId = payload['projectId'] as string;
    const platform = payload['platform'] as Platform;
    const strategy = payload['strategy'] as AccountStrategy;

    // Determine content action based on contentMix percentages
    const roll = Math.random() * 100;
    const { original, repost } = strategy.contentMix;
    let action: 'original' | 'repost' | 'reply';
    if (roll < original) {
      action = 'original';
    } else if (roll < original + repost) {
      action = 'repost';
    } else {
      action = 'reply';
    }

    // Only handle original content for now (repost/reply require existing posts)
    if (action !== 'original') {
      logger.info(`Skipping ${action} action for account ${accountId} — not yet implemented`);
      return;
    }

    // Pick a random content type from strategy
    const contentType = strategy.contentTypes[Math.floor(Math.random() * strategy.contentTypes.length)]!;

    const langInstruction = strategy.language === 'tr'
      ? 'Yaniti mutlaka Turkce yaz.'
      : strategy.language === 'en'
        ? 'Write the response in English.'
        : '';

    const hashtagInstruction = strategy.hashtags?.length
      ? `Su hashtag\'leri mutlaka kullan: ${strategy.hashtags.join(' ')}`
      : '';

    const prompt = [strategy.promptTemplate, langInstruction, hashtagInstruction]
      .filter(Boolean)
      .join('\n');

    const request: ContentRequest = {
      projectId,
      platform,
      contentType: contentType as ContentRequest['contentType'],
      tone: strategy.tone,
      prompt,
    };

    const content = await generateText(request);

    // Merge strategy hashtags with generated ones
    if (strategy.hashtags?.length) {
      const existing = new Set(content.hashtags.map(h => h.toLowerCase()));
      for (const tag of strategy.hashtags) {
        if (!existing.has(tag.toLowerCase())) {
          content.hashtags.push(tag);
        }
      }
    }

    const [post] = await db
      .insert(schema.posts)
      .values({
        projectId,
        accountId,
        platform: platform as 'twitter' | 'instagram' | 'youtube' | 'tiktok',
        contentType: contentType as 'text' | 'image' | 'video' | 'story' | 'reel' | 'short',
        text: content.text,
        hashtags: content.hashtags,
        mediaUrls: content.mediaUrls ?? [],
        status: 'publishing',
        tone: strategy.tone as 'emotional' | 'informative' | 'urgent' | 'hopeful' | 'friendly',
      })
      .returning();

    const username = await this.getAccountUsername(accountId);

    logger.info(`Strategy content generated for account ${accountId}`, {
      postId: post!.id,
      action,
      contentType,
    });

    await notifyContentGenerated({
      username,
      platform,
      contentType,
      text: content.text,
    });

    await enqueueJob(JobType.PUBLISH_POST, {
      postId: post!.id,
      platform,
      accountId,
      content,
    });
  }

  private async getAccountUsername(accountId: string): Promise<string> {
    const [acc] = await db
      .select({ username: schema.accounts.username })
      .from(schema.accounts)
      .where(eq(schema.accounts.id, accountId))
      .limit(1);
    return acc?.username ?? accountId;
  }

  private async handlePublishPost(payload: Record<string, unknown>): Promise<void> {
    const platform = payload['platform'] as Platform;
    const postId = payload['postId'] as string | undefined;
    const adapter = this.adapters.get(platform);

    if (!adapter) {
      throw new Error(`No adapter for platform: ${platform}`);
    }

    const content = payload['content'] as GeneratedContent;
    const accountId = payload['accountId'] as string;
    const username = await this.getAccountUsername(accountId);

    try {
      const result = await adapter.post(content, accountId);

      if (!result.success) {
        if (postId) {
          await db
            .update(schema.posts)
            .set({ status: 'failed', errorMessage: result.error ?? 'Post failed', updatedAt: new Date() })
            .where(eq(schema.posts.id, postId));
        }
        await notifyPostFailed({
          username,
          platform,
          text: content.text,
          error: result.error ?? 'Post failed',
        });
        throw new Error(result.error ?? 'Post failed');
      }

      if (postId) {
        await db
          .update(schema.posts)
          .set({
            status: 'published',
            publishedAt: new Date(),
            platformPostId: result.platformPostId ?? null,
            platformUrl: result.url ?? null,
            updatedAt: new Date(),
          })
          .where(eq(schema.posts.id, postId));
      }

      logger.info(`Post published on ${platform}`, { postId, platformPostId: result.platformPostId });

      await notifyPostPublished({
        username,
        platform,
        text: content.text,
        hashtags: content.hashtags,
        platformUrl: result.url,
        platformPostId: result.platformPostId,
      });
    } catch (err) {
      if (postId) {
        await db
          .update(schema.posts)
          .set({
            status: 'failed',
            errorMessage: err instanceof Error ? err.message : String(err),
            updatedAt: new Date(),
          })
          .where(eq(schema.posts.id, postId));
      }
      // Only notify if we haven't already (the !result.success path above already notified)
      if (!(err instanceof Error && err.message === 'Post failed')) {
        await notifyPostFailed({
          username,
          platform,
          text: content.text,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      throw err;
    }
  }

  private async sendDailyReport(): Promise<void> {
    try {
      const report = await generateReport(1);
      await notifyDailySummary(report);
      logger.info('Daily report sent successfully');
    } catch (err) {
      logger.error('Failed to send daily report', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async handleFetchAnalytics(payload: Record<string, unknown>): Promise<void> {
    const postId = payload['postId'] as string;

    if (!postId) {
      throw new Error('handleFetchAnalytics requires postId in payload');
    }

    const result = await trackPostAnalytics(postId);
    if (result) {
      logger.info(`Analytics tracked for post ${postId}`, result);
    } else {
      logger.warn(`Could not track analytics for post ${postId}`);
    }
  }
}

export const engine = new Engine();
