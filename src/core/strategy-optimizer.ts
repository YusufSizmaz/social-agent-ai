import { eq, gte, sql, and, isNotNull } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { logger } from '../config/logger.js';
import { syncAccountCrons } from './account-scheduler.js';
import { sendAdminMessage } from '../notifications/whatsapp.js';
import type { AccountStrategy } from '../types/index.js';
import type { Tone } from '../config/constants.js';

const MIN_POSTS_FOR_OPTIMIZATION = 10;

interface PostWithAnalytics {
  accountId: string;
  tone: string | null;
  publishedAt: Date | null;
  likes: number;
  comments: number;
  shares: number;
  impressions: number;
  engagementRate: number;
  hashtags: string[];
}

export async function optimizeStrategies(): Promise<void> {
  logger.info('Starting strategy optimization...');

  const since = new Date();
  since.setDate(since.getDate() - 7);

  // Fetch posts with their best analytics from last 7 days
  const rows = await db
    .select({
      accountId: schema.posts.accountId,
      tone: schema.posts.tone,
      publishedAt: schema.posts.publishedAt,
      hashtags: schema.posts.hashtags,
      likes: sql<number>`MAX(${schema.postAnalytics.likes})`,
      comments: sql<number>`MAX(${schema.postAnalytics.comments})`,
      shares: sql<number>`MAX(${schema.postAnalytics.shares})`,
      impressions: sql<number>`MAX(${schema.postAnalytics.impressions})`,
      engagementRate: sql<number>`MAX(${schema.postAnalytics.engagementRate})`,
    })
    .from(schema.posts)
    .innerJoin(schema.postAnalytics, eq(schema.postAnalytics.postId, schema.posts.id))
    .where(and(gte(schema.posts.createdAt, since), eq(schema.posts.status, 'published')))
    .groupBy(schema.posts.id, schema.posts.accountId, schema.posts.tone, schema.posts.publishedAt, schema.posts.hashtags);

  if (rows.length < MIN_POSTS_FOR_OPTIMIZATION) {
    logger.info(`Not enough data for optimization (${rows.length}/${MIN_POSTS_FOR_OPTIMIZATION} posts). Skipping.`);
    return;
  }

  // Group by account
  const byAccount = new Map<string, PostWithAnalytics[]>();
  for (const row of rows) {
    const posts = byAccount.get(row.accountId) ?? [];
    posts.push({
      accountId: row.accountId,
      tone: row.tone,
      publishedAt: row.publishedAt,
      likes: row.likes ?? 0,
      comments: row.comments ?? 0,
      shares: row.shares ?? 0,
      impressions: row.impressions ?? 0,
      engagementRate: row.engagementRate ?? 0,
      hashtags: (row.hashtags as string[] | null) ?? [],
    });
    byAccount.set(row.accountId, posts);
  }

  // Get accounts with strategies
  const accounts = await db
    .select({
      id: schema.accounts.id,
      username: schema.accounts.username,
      platform: schema.accounts.platform,
      strategy: schema.accounts.strategy,
    })
    .from(schema.accounts)
    .where(and(eq(schema.accounts.active, true), isNotNull(schema.accounts.strategy)));

  const changes: string[] = [];

  for (const account of accounts) {
    const strategy = account.strategy as AccountStrategy | null;
    if (!strategy?.active) continue;

    const accountPosts = byAccount.get(account.id);
    if (!accountPosts || accountPosts.length < 3) continue;

    const updates: string[] = [];

    // 1. Find best performing tone
    const toneEngagement = new Map<string, { total: number; count: number }>();
    for (const post of accountPosts) {
      if (!post.tone) continue;
      const entry = toneEngagement.get(post.tone) ?? { total: 0, count: 0 };
      entry.total += post.engagementRate;
      entry.count++;
      toneEngagement.set(post.tone, entry);
    }

    let bestTone: string | null = null;
    let bestToneAvg = 0;
    for (const [tone, data] of toneEngagement) {
      const avg = data.total / data.count;
      if (avg > bestToneAvg) {
        bestToneAvg = avg;
        bestTone = tone;
      }
    }

    if (bestTone && bestTone !== strategy.tone) {
      const oldTone = strategy.tone;
      strategy.tone = bestTone as Tone;
      updates.push(`ton ${oldTone} -> ${bestTone}`);
    }

    // 2. Find best posting hours
    const hourEngagement = new Map<number, { total: number; count: number }>();
    for (const post of accountPosts) {
      if (!post.publishedAt) continue;
      const hour = post.publishedAt.getHours();
      const entry = hourEngagement.get(hour) ?? { total: 0, count: 0 };
      entry.total += post.engagementRate;
      entry.count++;
      hourEngagement.set(hour, entry);
    }

    if (hourEngagement.size >= 2) {
      const sortedHours = [...hourEngagement.entries()]
        .map(([hour, data]) => ({ hour, avg: data.total / data.count }))
        .sort((a, b) => b.avg - a.avg)
        .slice(0, 3)
        .map((h) => h.hour)
        .sort((a, b) => a - b);

      const newCron = `0 ${sortedHours.join(',')} * * *`;
      if (newCron !== strategy.cronExpression) {
        const oldCron = strategy.cronExpression;
        strategy.cronExpression = newCron;
        updates.push(`cron ${oldCron} -> ${newCron}`);
      }
    }

    // 3. Hashtag optimization: keep high-performing, drop low-performing
    if (strategy.hashtags && strategy.hashtags.length > 0) {
      const hashtagEngagement = new Map<string, { total: number; count: number }>();
      for (const post of accountPosts) {
        for (const tag of post.hashtags) {
          const normalized = tag.toLowerCase().replace(/^#/, '');
          const entry = hashtagEngagement.get(normalized) ?? { total: 0, count: 0 };
          entry.total += post.engagementRate;
          entry.count++;
          hashtagEngagement.set(normalized, entry);
        }
      }

      const sortedTags = [...hashtagEngagement.entries()]
        .map(([tag, data]) => ({ tag, avg: data.total / data.count, count: data.count }))
        .filter((t) => t.count >= 2)
        .sort((a, b) => b.avg - a.avg);

      if (sortedTags.length > 0) {
        const topTags = sortedTags.slice(0, 10).map((t) => `#${t.tag}`);
          strategy.hashtags = topTags;
        updates.push(`hashtagler guncellendi`);
      }
    }

    // Apply updates if any changes
    if (updates.length > 0) {
      await db
        .update(schema.accounts)
        .set({ strategy })
        .where(eq(schema.accounts.id, account.id));

      const changeDesc = `@${account.username}: ${updates.join(', ')}`;
      changes.push(changeDesc);
      logger.info(`Strategy optimized for ${account.username}`, { updates });
    }
  }

  // Sync crons with new strategies
  await syncAccountCrons();

  // Notify via WhatsApp
  if (changes.length > 0) {
    const msg =
      `🧠 *Haftalık Strateji Optimizasyonu*\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `📊 Analiz: Son 7 gün, ${rows.length} post\n\n` +
      changes.map((c) => `✅ ${c}`).join('\n') +
      `\n\n⏰ ${new Date().toLocaleString('tr-TR')}`;
    await sendAdminMessage(msg);
  } else {
    logger.info('No strategy changes needed this week');
  }

  logger.info('Strategy optimization completed', { changesCount: changes.length });
}
