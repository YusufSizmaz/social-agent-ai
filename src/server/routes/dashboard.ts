import { Router } from 'express';
import { eq, and, sql } from 'drizzle-orm';
import { db, schema } from '../../db/index.js';

export const dashboardRouter = Router();

dashboardRouter.get('/stats', async (req, res) => {
  try {
    const { projectId } = req.query as { projectId?: string };

    const [postStats] = await db.execute<{
      total: number;
      published: number;
      failed: number;
      pending: number;
    }>(sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'published')::int AS published,
        COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
        COUNT(*) FILTER (WHERE status = 'pending')::int AS pending
      FROM posts
      ${projectId ? sql`WHERE project_id = ${projectId}` : sql``}
    `);

    const [jobStats] = await db
      .select({
        total: sql<number>`COUNT(*)`,
        processing: sql<number>`COUNT(*) FILTER (WHERE ${schema.jobQueue.status} = 'processing')`,
        pending: sql<number>`COUNT(*) FILTER (WHERE ${schema.jobQueue.status} = 'pending')`,
        failed: sql<number>`COUNT(*) FILTER (WHERE ${schema.jobQueue.status} = 'failed')`,
      })
      .from(schema.jobQueue);

    const accountQuery = db
      .select({ count: sql<number>`COUNT(*)` })
      .from(schema.accounts)
      .$dynamic();

    const conditions = [eq(schema.accounts.active, true)];
    if (projectId) {
      conditions.push(eq(schema.accounts.projectId, projectId));
    }

    const activeAccounts = await accountQuery.where(and(...conditions));

    res.json({
      posts: postStats ?? { total: 0, published: 0, failed: 0, pending: 0 },
      jobs: jobStats,
      activeAccounts: activeAccounts[0]?.count ?? 0,
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
