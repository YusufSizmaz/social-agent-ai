import { eq, and, ne, gte, sql, isNotNull, asc } from 'drizzle-orm';
import { Platform, ContentType, QUEUE_POLL_INTERVAL_MS, JobType } from '../config/constants.js';
import { logger } from '../config/logger.js';
import type { PlatformAdapter, ProjectPlugin, ContentRequest, GeneratedContent, AccountStrategy } from '../types/index.js';
import { dequeueJob, completeJob, failJob, enqueueJob, recoverStaleJobs, type Job } from './queue.js';
import { startAllCrons, stopAllCrons, registerCron } from './scheduler.js';
import { syncAccountCrons } from './account-scheduler.js';
import { generateText } from '../ai/text-generator.js';
import { createContent, failsQualityGate, type CreatedContent } from './content-service.js';
import { checkContentSafety, fitToPlatform } from './safety-guard.js';
import { pickContentAction, mergeHashtags } from './content-mix.js';
import { NonRetryableError, errorMessage, isRetryable } from './errors.js';
import { db, schema } from '../db/index.js';
import { notifyPostPublished, notifyPostFailed, notifyContentGenerated, notifyDailySummary } from '../notifications/whatsapp.js';
import { trackAllPublishedPosts, trackPostAnalytics } from '../analytics/tracker.js';
import { generateReport } from '../analytics/reporter.js';
import { optimizeStrategies } from './strategy-optimizer.js';

type PlatformValue = typeof schema.posts.$inferInsert['platform'];
type ContentTypeValue = typeof schema.posts.$inferInsert['contentType'];
type ToneValue = NonNullable<typeof schema.posts.$inferInsert['tone']>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHUTDOWN_GRACE_MS = 60_000;

interface NewPost {
  projectId: string;
  accountId: string;
  platform: Platform;
  contentType: ContentType;
  tone: ToneValue;
  content: CreatedContent;
  source: string;
}

export class Engine {
  private adapters = new Map<Platform, PlatformAdapter>();
  private plugins = new Map<string, ProjectPlugin>();
  private running = false;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;

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

  isRunning(): boolean {
    return this.running;
  }

  /** Lets adapters drop cached API clients after an account's credentials change */
  invalidateAccount(accountId: string): void {
    for (const adapter of this.adapters.values()) {
      adapter.invalidateAccount?.(accountId);
    }
  }

  async start(): Promise<void> {
    logger.info('Engine starting...');

    await recoverStaleJobs();

    for (const adapter of this.adapters.values()) {
      await adapter.init();
    }

    for (const plugin of this.plugins.values()) {
      try {
        await plugin.init();
      } catch (err) {
        logger.error(`Plugin "${plugin.name}" failed to initialize`, { error: errorMessage(err) });
      }
    }

    registerCron('poll-plugins', '*/5 * * * *', () => this.pollPlugins());
    registerCron('track-analytics', '0 */6 * * *', async () => { await trackAllPublishedPosts(); });
    registerCron('daily-report', '0 23 * * *', () => this.sendDailyReport());
    registerCron('optimize-strategies', '0 2 * * 1', () => optimizeStrategies());
    registerCron('recover-stale-jobs', '*/10 * * * *', async () => { await recoverStaleJobs(); });

    await syncAccountCrons();

    startAllCrons();
    this.running = true;
    this.startJobPolling();

    logger.info('Engine started successfully', {
      adapters: [...this.adapters.keys()],
      plugins: [...this.plugins.keys()],
    });
  }

  async stop(): Promise<void> {
    logger.info('Engine stopping...');
    this.running = false;

    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }

    stopAllCrons();

    if (this.inFlight) {
      logger.info('Waiting for the current job to finish...');
      await Promise.race([
        this.inFlight,
        new Promise((resolve) => setTimeout(resolve, SHUTDOWN_GRACE_MS)),
      ]);
    }

    for (const plugin of this.plugins.values()) {
      await plugin.destroy();
    }

    for (const adapter of this.adapters.values()) {
      await adapter.destroy();
    }

    logger.info('Engine stopped');
  }

  /** Drains the queue, then waits for the poll interval. Never runs two polls at once. */
  private startJobPolling(): void {
    const tick = async (): Promise<void> => {
      try {
        while (this.running) {
          const run = this.processNextJob();
          this.inFlight = run.then(() => undefined, () => undefined);
          const processed = await run;
          if (!processed) break;
        }
      } catch (err) {
        logger.error('Job processing error', { error: errorMessage(err) });
      } finally {
        this.inFlight = null;
        if (this.running) {
          this.pollTimer = setTimeout(() => void tick(), QUEUE_POLL_INTERVAL_MS);
        }
      }
    };

    this.pollTimer = setTimeout(() => void tick(), 0);
  }

  private async processNextJob(): Promise<boolean> {
    const job = await dequeueJob();
    if (!job) return false;

    logger.info(`Processing job ${job.id} (${job.type})`, { attempt: job.attempts });

    try {
      switch (job.type) {
        case JobType.GENERATE_CONTENT:
          await this.handleGenerateContent(job.payload);
          break;
        case JobType.PUBLISH_POST:
          await this.handlePublishPost(job);
          break;
        case JobType.FETCH_ANALYTICS:
          await this.handleFetchAnalytics(job.payload);
          break;
        case JobType.POLL_SOURCE:
          await this.pollPlugins();
          break;
        default:
          throw new NonRetryableError(`Unknown job type: ${job.type}`);
      }
      await completeJob(job.id);
    } catch (err) {
      const message = errorMessage(err);
      const canRetry = isRetryable(err) && job.attempts < job.maxAttempts;
      await failJob(job.id, message, canRetry, job.attempts);

      if (canRetry) {
        logger.warn(`Job ${job.id} failed, will retry`, { error: message, attempt: job.attempts });
      } else {
        logger.error(`Job ${job.id} permanently failed`, { error: message });
      }
    }

    return true;
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
        logger.error(`Plugin "${plugin.name}" poll failed`, { error: errorMessage(err) });
      }
    }
  }

  private async handleGenerateContent(payload: Record<string, unknown>): Promise<void> {
    if (payload['strategy'] && payload['accountId']) {
      await this.handleStrategyGeneration(payload);
      return;
    }

    const pluginName = payload['pluginName'] as string;
    const request = payload['request'] as ContentRequest;
    const plugin = this.plugins.get(pluginName);

    if (!plugin) {
      throw new NonRetryableError(`Plugin not found: ${pluginName}`);
    }

    const target = await this.resolveTarget(request.projectId, request.platform, payload['accountId'] as string | undefined);
    if (!target) return;

    const prompt = request.prompt?.trim() ? request.prompt : plugin.getPrompt(request);
    const resolvedRequest: ContentRequest = {
      ...request,
      projectId: target.projectId,
      prompt,
      context: { ...request.context, projectConfig: target.projectConfig, projectName: target.projectName },
    };

    let content = await createContent(resolvedRequest);
    if (plugin.transform) {
      const transformed = fitToPlatform(plugin.transform({ ...content, hashtags: [...content.hashtags] }), request.platform);
      content = {
        ...content,
        text: transformed.text,
        hashtags: transformed.hashtags,
        mediaUrls: transformed.mediaUrls ?? content.mediaUrls,
      };
    }

    await this.saveAndQueue({
      projectId: target.projectId,
      accountId: target.accountId,
      platform: request.platform,
      contentType: request.contentType,
      tone: request.tone as ToneValue,
      content,
      source: `plugin:${plugin.name}`,
    });
  }

  /**
   * Resolves a plugin's project reference (UUID or name) and picks the account to post with.
   * Returns null — skipping the request — when the project has no active account for the platform.
   */
  private async resolveTarget(projectRef: string, platform: Platform, accountId?: string) {
    const [project] = await db
      .select({ id: schema.projects.id, name: schema.projects.name, config: schema.projects.config })
      .from(schema.projects)
      .where(UUID_RE.test(projectRef)
        ? eq(schema.projects.id, projectRef)
        : sql`lower(${schema.projects.name}) = lower(${projectRef})`)
      .limit(1);

    if (!project) {
      throw new NonRetryableError(`Project "${projectRef}" not found — create it in the dashboard first`);
    }

    const [account] = await db
      .select({ id: schema.accounts.id })
      .from(schema.accounts)
      .where(accountId
        ? and(eq(schema.accounts.id, accountId), eq(schema.accounts.projectId, project.id))
        : and(
            eq(schema.accounts.projectId, project.id),
            eq(schema.accounts.platform, platform as PlatformValue),
            eq(schema.accounts.active, true),
          ))
      .orderBy(asc(schema.accounts.role))
      .limit(1);

    if (!account) {
      logger.warn(`No active ${platform} account for project "${project.name}", skipping content request`);
      return null;
    }

    return {
      projectId: project.id,
      projectName: project.name,
      projectConfig: project.config ?? {},
      accountId: account.id,
    };
  }

  /** Stores generated content and queues it for publishing — or holds it for review if it fails the quality gate */
  private async saveAndQueue(post: NewPost): Promise<string> {
    const holdForReview = failsQualityGate(post.content);

    const [created] = await db
      .insert(schema.posts)
      .values({
        projectId: post.projectId,
        accountId: post.accountId,
        platform: post.platform as PlatformValue,
        contentType: post.contentType as ContentTypeValue,
        text: post.content.text,
        hashtags: post.content.hashtags,
        mediaUrls: post.content.mediaUrls,
        status: holdForReview ? 'review' : 'publishing',
        tone: post.tone,
        qualityScore: post.content.qualityScore,
        metadata: {
          source: post.source,
          ...(post.content.qualityFeedback ? { qualityFeedback: post.content.qualityFeedback } : {}),
        },
      })
      .returning({ id: schema.posts.id });

    const postId = created!.id;
    const username = await this.getAccountUsername(post.accountId);

    logger.info(`Content generated (${post.source})`, {
      postId,
      accountId: post.accountId,
      contentType: post.contentType,
      heldForReview: holdForReview,
    });

    await notifyContentGenerated({
      username,
      platform: post.platform,
      contentType: post.contentType,
      text: post.content.text,
    });

    if (holdForReview) {
      logger.warn(`Post ${postId} scored ${post.content.qualityScore} and was held for manual review`);
      return postId;
    }

    await enqueueJob(JobType.PUBLISH_POST, {
      postId,
      platform: post.platform,
      accountId: post.accountId,
    });

    return postId;
  }

  private async handleStrategyGeneration(payload: Record<string, unknown>): Promise<void> {
    const accountId = payload['accountId'] as string;
    const projectId = payload['projectId'] as string;
    const platform = payload['platform'] as Platform;
    const strategy = payload['strategy'] as AccountStrategy;

    const action = pickContentAction(strategy.contentMix, Math.random());

    if (action === 'repost') {
      await this.handleRepost(accountId, projectId, platform);
      return;
    }

    if (action === 'reply') {
      await this.handleReply(accountId, projectId, platform, strategy);
      return;
    }

    const contentTypes = strategy.contentTypes?.length ? strategy.contentTypes : [ContentType.TEXT];
    const contentType = contentTypes[Math.floor(Math.random() * contentTypes.length)]!;

    const [project] = await db
      .select({ name: schema.projects.name, config: schema.projects.config })
      .from(schema.projects)
      .where(eq(schema.projects.id, projectId))
      .limit(1);

    const prompt = [
      strategy.promptTemplate,
      strategy.hashtags?.length ? `Include these hashtags: ${strategy.hashtags.join(' ')}` : '',
    ].filter(Boolean).join('\n');

    const content = await createContent({
      projectId,
      platform,
      contentType,
      tone: strategy.tone,
      prompt,
      context: {
        language: strategy.language,
        projectConfig: project?.config ?? {},
        projectName: project?.name,
      },
    });

    const merged = fitToPlatform(
      { ...content, hashtags: mergeHashtags(strategy.hashtags, content.hashtags) },
      platform,
    );

    await this.saveAndQueue({
      projectId,
      accountId,
      platform,
      contentType,
      tone: strategy.tone as ToneValue,
      content: { ...content, hashtags: merged.hashtags },
      source: 'strategy',
    });
  }

  private async findCandidatePosts(
    accountId: string,
    projectId: string,
    platform: Platform,
  ) {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    return db
      .select({
        id: schema.posts.id,
        platformPostId: schema.posts.platformPostId,
        accountId: schema.posts.accountId,
        text: schema.posts.text,
      })
      .from(schema.posts)
      .where(
        and(
          eq(schema.posts.projectId, projectId),
          eq(schema.posts.platform, platform as PlatformValue),
          eq(schema.posts.status, 'published'),
          ne(schema.posts.accountId, accountId),
          gte(schema.posts.publishedAt, twentyFourHoursAgo),
          isNotNull(schema.posts.platformPostId),
          sql`NOT (COALESCE(${schema.posts.metadata}, '{}'::jsonb) ? 'repostOf')`,
        ),
      );
  }

  private async getMetadataField(accountId: string, field: string): Promise<Set<string>> {
    const rows = await db
      .select({ metadata: schema.posts.metadata })
      .from(schema.posts)
      .where(
        and(
          eq(schema.posts.accountId, accountId),
          sql`${schema.posts.metadata}->>${field} IS NOT NULL`,
        ),
      );

    return new Set(
      rows
        .map(r => (r.metadata as Record<string, unknown>)?.[field] as string)
        .filter(Boolean),
    );
  }

  private async handleRepost(accountId: string, projectId: string, platform: Platform): Promise<void> {
    const candidatePosts = await this.findCandidatePosts(accountId, projectId, platform);
    if (candidatePosts.length === 0) {
      logger.info(`No repostable content found for account ${accountId}, skipping`);
      return;
    }

    const repostedIds = await this.getMetadataField(accountId, 'repostOf');
    const unreposted = candidatePosts.filter(p => !repostedIds.has(p.id));

    if (unreposted.length === 0) {
      logger.info(`All candidate posts already reposted by account ${accountId}, skipping`);
      return;
    }

    const target = unreposted[Math.floor(Math.random() * unreposted.length)]!;

    const adapter = this.adapters.get(platform);
    if (!adapter?.repost) {
      logger.warn(`Platform ${platform} does not support repost`);
      return;
    }

    const result = await adapter.repost(target.platformPostId!, accountId);

    if (result.success) {
      await db.insert(schema.posts).values({
        projectId,
        accountId,
        platform: platform as PlatformValue,
        contentType: 'text',
        text: `[RT] ${(target.text || '').substring(0, 100)}`,
        hashtags: [],
        mediaUrls: [],
        status: 'published',
        publishedAt: new Date(),
        platformPostId: target.platformPostId,
        metadata: { repostOf: target.id, source: 'strategy' },
      });

      const username = await this.getAccountUsername(accountId);
      logger.info(`Repost completed for account ${accountId}`, {
        originalPostId: target.id,
        originalAccountId: target.accountId,
      });

      await notifyContentGenerated({
        username,
        platform,
        contentType: 'text',
        text: `[RT] ${(target.text || '').substring(0, 80)}`,
      });
    }
  }

  private async handleReply(accountId: string, projectId: string, platform: Platform, strategy: AccountStrategy): Promise<void> {
    const candidatePosts = await this.findCandidatePosts(accountId, projectId, platform);
    if (candidatePosts.length === 0) {
      logger.info(`No replyable content found for account ${accountId}, skipping`);
      return;
    }

    const repliedIds = await this.getMetadataField(accountId, 'replyTo');
    const unreplied = candidatePosts.filter(p => !repliedIds.has(p.id));

    if (unreplied.length === 0) {
      logger.info(`All candidate posts already replied by account ${accountId}, skipping`);
      return;
    }

    const target = unreplied[Math.floor(Math.random() * unreplied.length)]!;

    const adapter = this.adapters.get(platform);
    if (!adapter?.reply) {
      logger.warn(`Platform ${platform} does not support reply`);
      return;
    }

    const replyPrompt = [
      strategy.promptTemplate,
      `Write a short, supportive reply to this post: "${(target.text || '').substring(0, 200)}"`,
      'Keep it to 1-2 sentences. Be genuine and natural. Do not use hashtags.',
    ].filter(Boolean).join('\n');

    const generated = await generateText({
      projectId,
      platform,
      contentType: ContentType.TEXT,
      tone: strategy.tone,
      prompt: replyPrompt,
      context: { language: strategy.language },
    });
    const replyText = generated.text;

    const safety = checkContentSafety({ text: replyText, hashtags: [] }, platform);
    if (!safety.safe) {
      logger.warn(`Generated reply failed safety check, skipping`, { reasons: safety.reasons });
      return;
    }

    const result = await adapter.reply(target.platformPostId!, replyText, accountId);

    if (result.success) {
      await db.insert(schema.posts).values({
        projectId,
        accountId,
        platform: platform as PlatformValue,
        contentType: 'text',
        text: replyText,
        hashtags: [],
        mediaUrls: [],
        status: 'published',
        publishedAt: new Date(),
        platformPostId: result.platformPostId,
        platformUrl: result.url,
        safetyScore: safety.score,
        metadata: { replyTo: target.id, source: 'strategy' },
      });

      const username = await this.getAccountUsername(accountId);
      logger.info(`Reply completed for account ${accountId}`, {
        originalPostId: target.id,
        replyPostId: result.platformPostId,
      });

      await notifyContentGenerated({
        username,
        platform,
        contentType: 'text',
        text: `[Reply] ${replyText.substring(0, 80)}`,
      });
    }
  }

  private async getAccountUsername(accountId: string): Promise<string> {
    const [acc] = await db
      .select({ username: schema.accounts.username })
      .from(schema.accounts)
      .where(eq(schema.accounts.id, accountId))
      .limit(1);
    return acc?.username ?? accountId;
  }

  private async handlePublishPost(job: Job): Promise<void> {
    const { payload } = job;
    const platform = payload['platform'] as Platform;
    const postId = payload['postId'] as string | undefined;
    const accountId = payload['accountId'] as string;
    const isFinalAttempt = job.attempts >= job.maxAttempts;

    let content: GeneratedContent;
    if (postId) {
      // Always publish what's in the database, so edits made after queueing are respected
      const [post] = await db.select().from(schema.posts).where(eq(schema.posts.id, postId)).limit(1);
      if (!post) {
        logger.warn(`Post ${postId} no longer exists, skipping publish`);
        return;
      }
      if (post.status === 'published') {
        logger.info(`Post ${postId} is already published, skipping`);
        return;
      }
      content = { text: post.text, hashtags: post.hashtags ?? [], mediaUrls: post.mediaUrls ?? [], metadata: post.metadata ?? {} };
    } else {
      content = payload['content'] as GeneratedContent;
    }

    const username = await this.getAccountUsername(accountId);

    const fail = async (message: string, final: boolean): Promise<void> => {
      if (postId) {
        await db
          .update(schema.posts)
          .set({ status: final ? 'failed' : 'publishing', errorMessage: message, updatedAt: new Date() })
          .where(eq(schema.posts.id, postId));
      }
      if (final) {
        await notifyPostFailed({ username, platform, text: content.text, error: message });
      }
    };

    const adapter = this.adapters.get(platform);
    if (!adapter) {
      const message = `No adapter for platform "${platform}" — configure its credentials in .env`;
      await fail(message, true);
      throw new NonRetryableError(message);
    }

    content = fitToPlatform(content, platform);
    const safety = checkContentSafety(content, platform);
    if (postId) {
      await db.update(schema.posts).set({ safetyScore: safety.score }).where(eq(schema.posts.id, postId));
    }
    if (!safety.safe) {
      const message = `Safety check failed: ${safety.reasons.join('; ')}`;
      await fail(message, true);
      throw new NonRetryableError(message);
    }

    let result;
    try {
      result = await adapter.post(content, accountId);
    } catch (err) {
      await fail(errorMessage(err), isFinalAttempt || !isRetryable(err));
      throw err;
    }

    if (!result.success) {
      const message = result.error ?? 'Post failed';
      await fail(message, isFinalAttempt);
      throw new Error(message);
    }

    const now = new Date();
    if (postId) {
      await db
        .update(schema.posts)
        .set({
          status: 'published',
          publishedAt: now,
          platformPostId: result.platformPostId ?? null,
          platformUrl: result.url ?? null,
          errorMessage: null,
          updatedAt: now,
        })
        .where(eq(schema.posts.id, postId));
    }
    await db.update(schema.accounts).set({ lastUsedAt: now }).where(eq(schema.accounts.id, accountId));

    logger.info(`Post published on ${platform}`, { postId, platformPostId: result.platformPostId });

    await notifyPostPublished({
      username,
      platform,
      text: content.text,
      hashtags: content.hashtags,
      platformUrl: result.url,
      platformPostId: result.platformPostId,
    });
  }

  private async sendDailyReport(): Promise<void> {
    try {
      const report = await generateReport(1);
      await notifyDailySummary(report);
      logger.info('Daily report sent successfully');
    } catch (err) {
      logger.error('Failed to send daily report', { error: errorMessage(err) });
    }
  }

  private async handleFetchAnalytics(payload: Record<string, unknown>): Promise<void> {
    const postId = payload['postId'] as string;

    if (!postId) {
      throw new NonRetryableError('handleFetchAnalytics requires postId in payload');
    }

    const result = await trackPostAnalytics(postId);
    if (result) {
      logger.info(`Analytics tracked for post ${postId}`, { ...result });
    } else {
      logger.warn(`Could not track analytics for post ${postId}`);
    }
  }
}

export const engine = new Engine();
