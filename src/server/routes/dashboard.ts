import { Router, type Response } from 'express';
import { eq, and, sql, desc } from 'drizzle-orm';
import { db, schema } from '../../db/index.js';
import { asyncHandler, isUuid } from '../middleware.js';

export const dashboardRouter = Router();

/** Validates the optional ?projectId filter; responds 400 and returns false when invalid */
function readProjectId(query: Record<string, unknown>, res: Response): string | undefined | false {
  const projectId = query['projectId'];
  if (projectId === undefined || projectId === '') return undefined;
  if (!isUuid(projectId)) {
    res.status(400).json({ error: 'Invalid projectId' });
    return false;
  }
  return projectId;
}

/**
 * Analytics are stored as periodic snapshots (every 6h), so aggregates must use only the
 * latest snapshot per post — summing all rows would count the same likes many times.
 */
const latestAnalytics = sql`
  SELECT DISTINCT ON (post_id) post_id, likes, comments, shares, impressions, reach, engagement_rate
  FROM post_analytics
  ORDER BY post_id, fetched_at DESC
`;

dashboardRouter.get('/stats', asyncHandler(async (req, res) => {
  const projectId = readProjectId(req.query, res);
  if (projectId === false) return;

  const [postStats] = await db
    .select({
      total: sql<number>`COUNT(*)::int`,
      published: sql<number>`COUNT(*) FILTER (WHERE ${schema.posts.status} = 'published')::int`,
      failed: sql<number>`COUNT(*) FILTER (WHERE ${schema.posts.status} = 'failed')::int`,
      pending: sql<number>`COUNT(*) FILTER (WHERE ${schema.posts.status} IN ('pending', 'review', 'scheduled'))::int`,
    })
    .from(schema.posts)
    .where(projectId ? eq(schema.posts.projectId, projectId) : undefined);

  const [jobStats] = await db
    .select({
      total: sql<number>`COUNT(*)::int`,
      processing: sql<number>`COUNT(*) FILTER (WHERE ${schema.jobQueue.status} = 'processing')::int`,
      pending: sql<number>`COUNT(*) FILTER (WHERE ${schema.jobQueue.status} IN ('pending', 'retrying'))::int`,
      failed: sql<number>`COUNT(*) FILTER (WHERE ${schema.jobQueue.status} = 'failed')::int`,
    })
    .from(schema.jobQueue);

  const [activeAccounts] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(schema.accounts)
    .where(and(
      eq(schema.accounts.active, true),
      projectId ? eq(schema.accounts.projectId, projectId) : undefined,
    ));

  res.json({
    posts: postStats ?? { total: 0, published: 0, failed: 0, pending: 0 },
    jobs: jobStats ?? { total: 0, processing: 0, pending: 0, failed: 0 },
    activeAccounts: activeAccounts?.count ?? 0,
  });
}));

dashboardRouter.get('/recent-posts', asyncHandler(async (req, res) => {
  const projectId = readProjectId(req.query, res);
  if (projectId === false) return;

  const recentPosts = await db
    .select()
    .from(schema.posts)
    .where(projectId ? eq(schema.posts.projectId, projectId) : undefined)
    .orderBy(desc(schema.posts.createdAt))
    .limit(20);

  res.json(recentPosts);
}));

dashboardRouter.get('/analytics-summary', asyncHandler(async (req, res) => {
  const projectId = readProjectId(req.query, res);
  if (projectId === false) return;

  const projectFilter = projectId ? sql`AND p.project_id = ${projectId}` : sql``;

  const [totals] = await db.execute<{
    totalLikes: number; totalComments: number; totalShares: number; totalImpressions: number;
  }>(sql`
    SELECT
      COALESCE(SUM(a.likes), 0)::int AS "totalLikes",
      COALESCE(SUM(a.comments), 0)::int AS "totalComments",
      COALESCE(SUM(a.shares), 0)::int AS "totalShares",
      COALESCE(SUM(a.impressions), 0)::int AS "totalImpressions"
    FROM posts p
    JOIN (${latestAnalytics}) a ON a.post_id = p.id
    WHERE p.created_at >= NOW() - INTERVAL '7 days' ${projectFilter}
  `);

  const platformBreakdown = await db.execute(sql`
    SELECT
      p.platform,
      COUNT(*)::int AS "postCount",
      COALESCE(SUM(a.likes), 0)::int AS "totalLikes",
      COALESCE(SUM(a.comments), 0)::int AS "totalComments",
      COALESCE(SUM(a.shares), 0)::int AS "totalShares",
      COALESCE(SUM(a.impressions), 0)::int AS "totalImpressions"
    FROM posts p
    LEFT JOIN (${latestAnalytics}) a ON a.post_id = p.id
    WHERE p.created_at >= NOW() - INTERVAL '7 days' ${projectFilter}
    GROUP BY p.platform
  `);

  const dailyTrend = await db.execute(sql`
    SELECT
      TO_CHAR(p.created_at, 'YYYY-MM-DD') AS date,
      COUNT(*)::int AS "postCount",
      COALESCE(SUM(a.likes), 0)::int AS "totalLikes",
      COALESCE(SUM(a.impressions), 0)::int AS "totalImpressions"
    FROM posts p
    LEFT JOIN (${latestAnalytics}) a ON a.post_id = p.id
    WHERE p.created_at >= NOW() - INTERVAL '7 days' ${projectFilter}
    GROUP BY 1
    ORDER BY 1
  `);

  res.json({
    totals: totals ?? { totalLikes: 0, totalComments: 0, totalShares: 0, totalImpressions: 0 },
    platformBreakdown: [...platformBreakdown],
    dailyTrend: [...dailyTrend],
  });
}));

dashboardRouter.get('/account-performance', asyncHandler(async (req, res) => {
  const projectId = readProjectId(req.query, res);
  if (projectId === false) return;

  const rows = await db.execute<{
    accountId: string;
    username: string;
    platform: string;
    active: boolean;
    hasStrategy: boolean;
    postCount: number;
    totalLikes: number;
    avgEngagementRate: number | null;
  }>(sql`
    SELECT
      acc.id AS "accountId",
      acc.username,
      acc.platform,
      acc.active,
      (acc.strategy IS NOT NULL AND COALESCE((acc.strategy->>'active')::boolean, false)) AS "hasStrategy",
      COUNT(p.id)::int AS "postCount",
      COALESCE(SUM(a.likes), 0)::int AS "totalLikes",
      AVG(a.engagement_rate)::float8 AS "avgEngagementRate"
    FROM accounts acc
    LEFT JOIN posts p ON p.account_id = acc.id AND p.created_at >= NOW() - INTERVAL '7 days'
    LEFT JOIN (${latestAnalytics}) a ON a.post_id = p.id
    WHERE TRUE ${projectId ? sql`AND acc.project_id = ${projectId}` : sql``}
    GROUP BY acc.id
    ORDER BY "totalLikes" DESC, "postCount" DESC
  `);

  res.json(rows.map((r) => ({
    ...r,
    avgEngagementRate: Number((r.avgEngagementRate ?? 0).toFixed(2)),
  })));
}));
