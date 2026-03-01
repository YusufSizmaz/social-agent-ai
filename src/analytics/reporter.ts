import { eq, gte, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { logger } from '../config/logger.js';

export interface AnalyticsReport {
  period: string;
  totalPosts: number;
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
  }>;
}

export async function generateReport(days: number): Promise<AnalyticsReport> {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const posts = await db
    .select()
    .from(schema.posts)
    .where(gte(schema.posts.createdAt, since));

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

  const topAnalytics = [...analyticsRows].sort((a, b) => (b.likes ?? 0) - (a.likes ?? 0)).slice(0, 5);

  const topPosts = topAnalytics.map((a) => {
    const post = posts.find((p) => p.id === a.postId);
    return {
      postId: a.postId,
      text: post?.text.slice(0, 100) ?? '',
      likes: a.likes ?? 0,
      platform: post?.platform ?? 'unknown',
    };
  });

  const report: AnalyticsReport = {
    period: `Son ${days} gun`,
    totalPosts: posts.length,
    totalLikes: totals.likes,
    totalComments: totals.comments,
    totalShares: totals.shares,
    totalImpressions: totals.impressions,
    avgEngagementRate: analyticsRows.length > 0 ? totals.engagementSum / analyticsRows.length : 0,
    topPosts,
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
      text += `  • [${post.platform}] ${post.text}... (${post.likes} ❤️)\n`;
    }
  }

  return text;
}
