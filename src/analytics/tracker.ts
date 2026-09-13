import { and, eq, gte, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { PostStatus, type Platform } from '../config/constants.js';
import { logger } from '../config/logger.js';
import { engine } from '../core/engine.js';
import type { PostAnalyticsData } from '../types/index.js';

export async function trackPostAnalytics(postId: string): Promise<PostAnalyticsData | null> {
  const [post] = await db
    .select()
    .from(schema.posts)
    .where(eq(schema.posts.id, postId))
    .limit(1);

  if (!post || post.status !== PostStatus.PUBLISHED || !post.platformPostId) {
    return null;
  }

  const adapter = engine.getAdapter(post.platform as Platform);
  if (!adapter) {
    logger.warn(`No adapter for platform ${post.platform}`);
    return null;
  }

  try {
    const analytics = await adapter.getAnalytics(post.platformPostId, post.accountId);

    await db.insert(schema.postAnalytics).values({
      postId: post.id,
      likes: analytics.likes,
      comments: analytics.comments,
      shares: analytics.shares,
      impressions: analytics.impressions,
      reach: analytics.reach,
      engagementRate: analytics.engagementRate,
    });

    logger.debug('Analytics tracked', { postId, likes: analytics.likes });
    return analytics;
  } catch (err) {
    logger.error('Failed to track analytics', {
      postId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** Posts older than this stop being tracked — engagement has settled and API quota is finite */
const TRACKING_WINDOW_DAYS = 30;

export async function trackAllPublishedPosts(): Promise<number> {
  const since = new Date(Date.now() - TRACKING_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const publishedPosts = await db
    .select({ id: schema.posts.id })
    .from(schema.posts)
    .where(and(
      eq(schema.posts.status, PostStatus.PUBLISHED),
      gte(schema.posts.publishedAt, since),
      // Reposts share the original's platform id, so tracking them would duplicate its metrics
      sql`NOT (COALESCE(${schema.posts.metadata}, '{}'::jsonb) ? 'repostOf')`,
    ));

  let tracked = 0;
  for (const post of publishedPosts) {
    const result = await trackPostAnalytics(post.id);
    if (result) tracked++;
  }

  logger.info(`Tracked analytics for ${tracked}/${publishedPosts.length} posts`);
  return tracked;
}
