import { eq, gte, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { logger } from '../config/logger.js';
import { PostStatus } from '../config/constants.js';

export interface AccountBreakdown {
  accountId: string;
  username: string;
  platform: string;
  postCount: number;
  totalLikes: number;
}

export interface AnalyticsReport {
  period: string;
  totalPosts: number;
  postsPublished: number;
  postsFailed: number;
  totalLikes: number;
  totalComments: number;
  totalShares: number;
  totalImpressions: number;
  avgEngagementRate: number;
  topPosts: Array<{
    postId: string;
    text: string;
    likes: number;
    platform: string;
    username: string;
  }>;
  accountBreakdowns: AccountBreakdown[];
}

export async function generateReport(days: number): Promise<AnalyticsReport> {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const posts = await db
    .select()
    .from(schema.posts)
    .where(gte(schema.posts.createdAt, since));

  const postsPublished = posts.filter((p) => p.status === PostStatus.PUBLISHED).length;
  const postsFailed = posts.filter((p) => p.status === PostStatus.FAILED).length;

  const analyticsRows = await db
    .select({
      postId: schema.postAnalytics.postId,
      likes: sql<number>`MAX(${schema.postAnalytics.likes})`,
      comments: sql<number>`MAX(${schema.postAnalytics.comments})`,
      shares: sql<number>`MAX(${schema.postAnalytics.shares})`,
      impressions: sql<number>`MAX(${schema.postAnalytics.impressions})`,
      engagementRate: sql<number>`MAX(${schema.postAnalytics.engagementRate})`,
    })
    .from(schema.postAnalytics)
    .innerJoin(schema.posts, eq(schema.postAnalytics.postId, schema.posts.id))
    .where(gte(schema.posts.createdAt, since))
    .groupBy(schema.postAnalytics.postId);

  const totals = analyticsRows.reduce(
    (acc, row) => ({
      likes: acc.likes + (row.likes ?? 0),
      comments: acc.comments + (row.comments ?? 0),
      shares: acc.shares + (row.shares ?? 0),
      impressions: acc.impressions + (row.impressions ?? 0),
      engagementSum: acc.engagementSum + (row.engagementRate ?? 0),
    }),
    { likes: 0, comments: 0, shares: 0, impressions: 0, engagementSum: 0 },
  );

  // Account breakdown
  const accountIds = [...new Set(posts.map((p) => p.accountId))];
  const accounts = accountIds.length > 0
    ? await db
        .select({ id: schema.accounts.id, username: schema.accounts.username, platform: schema.accounts.platform })
        .from(schema.accounts)
    : [];

  const accountMap = new Map(accounts.map((a) => [a.id, a]));

  const accountBreakdowns: AccountBreakdown[] = [];
  for (const accountId of accountIds) {
    const acc = accountMap.get(accountId);
    if (!acc) continue;

    const accountPosts = posts.filter((p) => p.accountId === accountId);
    const accountPostIds = new Set(accountPosts.map((p) => p.id));
    const accountAnalytics = analyticsRows.filter((a) => accountPostIds.has(a.postId));
    const accountLikes = accountAnalytics.reduce((sum, a) => sum + (a.likes ?? 0), 0);

    accountBreakdowns.push({
      accountId,
      username: acc.username,
      platform: acc.platform,
      postCount: accountPosts.length,
      totalLikes: accountLikes,
    });
  }

  accountBreakdowns.sort((a, b) => b.totalLikes - a.totalLikes);

  // Top posts with username
  const topAnalytics = [...analyticsRows].sort((a, b) => (b.likes ?? 0) - (a.likes ?? 0)).slice(0, 5);

  const topPosts = topAnalytics.map((a) => {
    const post = posts.find((p) => p.id === a.postId);
    const acc = post ? accountMap.get(post.accountId) : undefined;
    return {
      postId: a.postId,
      text: post?.text.slice(0, 50) ?? '',
      likes: a.likes ?? 0,
      platform: post?.platform ?? 'unknown',
      username: acc?.username ?? 'unknown',
    };
  });

  const report: AnalyticsReport = {
    period: `Son ${days} gun`,
    totalPosts: posts.length,
    postsPublished,
    postsFailed,
    totalLikes: totals.likes,
    totalComments: totals.comments,
    totalShares: totals.shares,
    totalImpressions: totals.impressions,
    avgEngagementRate: analyticsRows.length > 0 ? totals.engagementSum / analyticsRows.length : 0,
    topPosts,
    accountBreakdowns,
  };

  logger.info('Report generated', { period: report.period, totalPosts: report.totalPosts });
  return report;
}

export function formatReportText(report: AnalyticsReport): string {
  let text = `📊 *${report.period} Raporu*\n\n`;
  text += `📝 Toplam Post: ${report.totalPosts}\n`;
  text += `❤️ Toplam Beğeni: ${report.totalLikes}\n`;
  text += `💬 Toplam Yorum: ${report.totalComments}\n`;
  text += `🔄 Toplam Paylaşım: ${report.totalShares}\n`;
  text += `👁️ Toplam Gösterim: ${report.totalImpressions}\n`;
  text += `📈 Ort. Etkileşim: ${report.avgEngagementRate.toFixed(2)}%\n`;

  if (report.topPosts.length > 0) {
    text += `\n🏆 *En İyi Postlar*\n`;
    for (const post of report.topPosts) {
      text += `  • [${post.platform}] @${post.username} — ${post.text}... (${post.likes} ❤️)\n`;
    }
  }

  if (report.accountBreakdowns.length > 0) {
    text += `\n📊 *Hesap Performansı*\n`;
    for (const ab of report.accountBreakdowns) {
      text += `  • @${ab.username} (${ab.platform}): ${ab.postCount} post, ${ab.totalLikes} ❤️\n`;
    }
  }

  return text;
}
