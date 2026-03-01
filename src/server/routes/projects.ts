import { Router } from 'express';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '../../db/index.js';

export const projectsRouter = Router();

projectsRouter.get('/', async (_req, res) => {
  try {
    const projects = await db
      .select({
        id: schema.projects.id,
        name: schema.projects.name,
        description: schema.projects.description,
        active: schema.projects.active,
        config: schema.projects.config,
        createdAt: schema.projects.createdAt,
        updatedAt: schema.projects.updatedAt,
      })
      .from(schema.projects)
      .orderBy(sql`${schema.projects.createdAt} DESC`);

    const enriched = await Promise.all(
      projects.map(async (p) => {
        const [accountCount] = await db
          .select({ count: sql<number>`COUNT(*)` })
          .from(schema.accounts)
          .where(eq(schema.accounts.projectId, p.id));

        const [postCount] = await db
          .select({ count: sql<number>`COUNT(*)` })
          .from(schema.posts)
          .where(eq(schema.posts.projectId, p.id));

        return {
          ...p,
          accountCount: accountCount?.count ?? 0,
          postCount: postCount?.count ?? 0,
        };
      }),
    );

    res.json(enriched);
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

    const [accountCount] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(schema.accounts)
      .where(eq(schema.accounts.projectId, id!));

    const [postCount] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(schema.posts)
      .where(eq(schema.posts.projectId, id!));

    const total = (accountCount?.count ?? 0) + (postCount?.count ?? 0);
    if (total > 0) {
      res.status(409).json({
        error: `Bu projeye bagli ${accountCount?.count ?? 0} hesap ve ${postCount?.count ?? 0} post var. Once bunlari silin.`,
      });
      return;
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
