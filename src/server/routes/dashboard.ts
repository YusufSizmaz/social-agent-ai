import { Router } from 'express';
import { eq, and, sql } from 'drizzle-orm';
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
