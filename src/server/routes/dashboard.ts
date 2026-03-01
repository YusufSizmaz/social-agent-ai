import { Router } from 'express';
import { eq, and, sql, gte } from 'drizzle-orm';
import { db, schema } from '../../db/index.js';

export const dashboardRouter = Router();

dashboardRouter.get('/stats', async (req, res) => {
  try {
    const { projectId } = req.query as { projectId?: string };

    const postConditions = [];
    if (projectId) {
      postConditions.push(eq(schema.posts.projectId, projectId));
    }

    let postQuery = db
      .select({
        total: sql<number>`COUNT(*)::int`,
        published: sql<number>`COUNT(*) FILTER (WHERE ${schema.posts.status} = 'published')::int`,
        failed: sql<number>`COUNT(*) FILTER (WHERE ${schema.posts.status} = 'failed')::int`,
        pending: sql<number>`COUNT(*) FILTER (WHERE ${schema.posts.status} = 'pending')::int`,
      })
      .from(schema.posts)
      .$dynamic();

    if (projectId) {
      postQuery = postQuery.where(eq(schema.posts.projectId, projectId));
    }

    const [postStats] = await postQuery;

    const [jobStats] = await db
      .select({
        total: sql<number>`COUNT(*)::int`,
        processing: sql<number>`COUNT(*) FILTER (WHERE ${schema.jobQueue.status} = 'processing')::int`,
        pending: sql<number>`COUNT(*) FILTER (WHERE ${schema.jobQueue.status} = 'pending')::int`,
        failed: sql<number>`COUNT(*) FILTER (WHERE ${schema.jobQueue.status} = 'failed')::int`,
      })
      .from(schema.jobQueue);

    const accountConditions = [eq(schema.accounts.active, true)];
    if (projectId) {
      accountConditions.push(eq(schema.accounts.projectId, projectId));
    }

    const [activeAccounts] = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(schema.accounts)
      .where(and(...accountConditions));

    res.json({
      posts: postStats ?? { total: 0, published: 0, failed: 0, pending: 0 },
      jobs: jobStats ?? { total: 0, processing: 0, pending: 0, failed: 0 },
      activeAccounts: activeAccounts?.count ?? 0,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' });
  }
});

dashboardRouter.get('/recent-posts', async (req, res) => {
  try {
    const { projectId } = req.query as { projectId?: string };

    let query = db.select().from(schema.posts).$dynamic();

    if (projectId) {
      query = query.where(eq(schema.posts.projectId, projectId));
    }

    const recentPosts = await query
      .orderBy(sql`${schema.posts.createdAt} DESC`)
      .limit(20);

    res.json(recentPosts);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' });
  }
});

dashboardRouter.get('/analytics-summary', async (_req, res) => {
  try {
    const since = new Date();
    since.setDate(since.getDate() - 7);

    // Total engagement metrics
    const [totals] = await db
      .select({
        totalLikes: sql<number>`COALESCE(SUM(${schema.postAnalytics.likes}), 0)::int`,
        totalComments: sql<number>`COALESCE(SUM(${schema.postAnalytics.comments}), 0)::int`,
        totalShares: sql<number>`COALESCE(SUM(${schema.postAnalytics.shares}), 0)::int`,
        totalImpressions: sql<number>`COALESCE(SUM(${schema.postAnalytics.impressions}), 0)::int`,
      })
      .from(schema.postAnalytics)
      .innerJoin(schema.posts, eq(schema.postAnalytics.postId, schema.posts.id))
      .where(gte(schema.posts.createdAt, since));

    // Platform breakdown with engagement
    const platformBreakdown = await db
      .select({
        platform: schema.posts.platform,
        postCount: sql<number>`COUNT(DISTINCT ${schema.posts.id})::int`,
        totalLikes: sql<number>`COALESCE(SUM(${schema.postAnalytics.likes}), 0)::int`,
        totalComments: sql<number>`COALESCE(SUM(${schema.postAnalytics.comments}), 0)::int`,
        totalShares: sql<number>`COALESCE(SUM(${schema.postAnalytics.shares}), 0)::int`,
        totalImpressions: sql<number>`COALESCE(SUM(${schema.postAnalytics.impressions}), 0)::int`,
      })
      .from(schema.posts)
      .leftJoin(schema.postAnalytics, eq(schema.postAnalytics.postId, schema.posts.id))
      .where(gte(schema.posts.createdAt, since))
      .groupBy(schema.posts.platform);

    // Daily trend (last 7 days)
    const dailyTrend = await db
      .select({
        date: sql<string>`TO_CHAR(${schema.posts.createdAt}, 'YYYY-MM-DD')`,
        postCount: sql<number>`COUNT(DISTINCT ${schema.posts.id})::int`,
        totalLikes: sql<number>`COALESCE(SUM(${schema.postAnalytics.likes}), 0)::int`,
        totalImpressions: sql<number>`COALESCE(SUM(${schema.postAnalytics.impressions}), 0)::int`,
      })
      .from(schema.posts)
      .leftJoin(schema.postAnalytics, eq(schema.postAnalytics.postId, schema.posts.id))
      .where(gte(schema.posts.createdAt, since))
      .groupBy(sql`TO_CHAR(${schema.posts.createdAt}, 'YYYY-MM-DD')`)
      .orderBy(sql`TO_CHAR(${schema.posts.createdAt}, 'YYYY-MM-DD')`);

    res.json({
      totals: totals ?? { totalLikes: 0, totalComments: 0, totalShares: 0, totalImpressions: 0 },
      platformBreakdown,
      dailyTrend,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' });
  }
});

dashboardRouter.get('/account-performance', async (_req, res) => {
  try {
    const since = new Date();
    since.setDate(since.getDate() - 7);

    const rows = await db
      .select({
        accountId: schema.accounts.id,
        username: schema.accounts.username,
        platform: schema.accounts.platform,
        active: schema.accounts.active,
        strategy: schema.accounts.strategy,
        postCount: sql<number>`COUNT(DISTINCT ${schema.posts.id})::int`,
        totalLikes: sql<number>`COALESCE(SUM(${schema.postAnalytics.likes}), 0)::int`,
        avgEngagementRate: sql<number>`COALESCE(AVG(${schema.postAnalytics.engagementRate}), 0)`,
      })
      .from(schema.accounts)
      .leftJoin(
        schema.posts,
        and(eq(schema.posts.accountId, schema.accounts.id), gte(schema.posts.createdAt, since)),
      )
      .leftJoin(schema.postAnalytics, eq(schema.postAnalytics.postId, schema.posts.id))
      .groupBy(schema.accounts.id, schema.accounts.username, schema.accounts.platform, schema.accounts.active, schema.accounts.strategy)
      .orderBy(sql`COALESCE(SUM(${schema.postAnalytics.likes}), 0) DESC`);

    const result = rows.map((r) => ({
      accountId: r.accountId,
      username: r.username,
      platform: r.platform,
      active: r.active,
      hasStrategy: !!(r.strategy as Record<string, unknown> | null),
      postCount: r.postCount,
      totalLikes: r.totalLikes,
      avgEngagementRate: Number(r.avgEngagementRate.toFixed(2)),
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' });
  }
});
