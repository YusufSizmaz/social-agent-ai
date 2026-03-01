import { Router } from 'express';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '../../db/index.js';

export const projectsRouter = Router();

projectsRouter.get('/', async (_req, res) => {
  try {
    const projects = await db.execute<{
      id: string;
      name: string;
      description: string | null;
      active: boolean;
      config: Record<string, unknown>;
      created_at: string;
      updated_at: string;
      account_count: number;
      post_count: number;
    }>(sql`
      SELECT
        p.*,
        COALESCE(a.cnt, 0)::int AS account_count,
        COALESCE(po.cnt, 0)::int AS post_count
      FROM projects p
      LEFT JOIN (SELECT project_id, COUNT(*) AS cnt FROM accounts GROUP BY project_id) a ON a.project_id = p.id
      LEFT JOIN (SELECT project_id, COUNT(*) AS cnt FROM posts GROUP BY project_id) po ON po.project_id = p.id
      ORDER BY p.created_at DESC
    `);

    const result = projects.map(p => ({
      id: p.id,
      name: p.name,
      description: p.description,
      active: p.active,
      config: p.config,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
      accountCount: p.account_count,
      postCount: p.post_count,
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' });
  }
});

projectsRouter.post('/', async (req, res) => {
  try {
    const { name, description, config } = req.body as {
      name: string;
      description?: string;
      config?: Record<string, unknown>;
    };

    const [project] = await db
      .insert(schema.projects)
      .values({ name, description, config: config ?? {} })
      .returning();

    res.status(201).json(project);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' });
  }
});

projectsRouter.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [project] = await db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, id!))
      .limit(1);

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    res.json(project);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' });
  }
});

projectsRouter.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, active, config } = req.body as {
      name?: string;
      description?: string;
      active?: boolean;
      config?: Record<string, unknown>;
    };

    const [updated] = await db
      .update(schema.projects)
      .set({
        ...(name !== undefined ? { name } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(active !== undefined ? { active } : {}),
        ...(config !== undefined ? { config } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.projects.id, id!))
      .returning();

    if (!updated) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' });
  }
});

projectsRouter.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { force } = req.query as { force?: string };

    const [accountCount] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(schema.accounts)
      .where(eq(schema.accounts.projectId, id!));

    const [postCount] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(schema.posts)
      .where(eq(schema.posts.projectId, id!));

    const totalAccounts = accountCount?.count ?? 0;
    const totalPosts = postCount?.count ?? 0;

    if ((totalAccounts > 0 || totalPosts > 0) && force !== 'true') {
      res.status(409).json({
        error: `Bu projeye bagli ${totalAccounts} hesap ve ${totalPosts} post var. Yine de silmek icin onaylayin.`,
        accountCount: totalAccounts,
        postCount: totalPosts,
      });
      return;
    }

    // Cascade: once bagli postlari, sonra hesaplari sil
    if (totalPosts > 0) {
      await db.delete(schema.posts).where(eq(schema.posts.projectId, id!));
    }
    if (totalAccounts > 0) {
      await db.delete(schema.accounts).where(eq(schema.accounts.projectId, id!));
    }

    const [deleted] = await db
      .delete(schema.projects)
      .where(eq(schema.projects.id, id!))
      .returning({ id: schema.projects.id });

    if (!deleted) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' });
  }
});
