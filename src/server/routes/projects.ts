import { Router } from 'express';
import { eq, sql } from 'drizzle-orm';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { db, schema } from '../../db/index.js';

const LOGOS_DIR = path.resolve('public/logos');
if (!fs.existsSync(LOGOS_DIR)) fs.mkdirSync(LOGOS_DIR, { recursive: true });

const logoUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, LOGOS_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || '.png';
      cb(null, `logo_${req.params['id']}_${Date.now()}${ext}`);
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/png', 'image/jpeg', 'image/webp'];
    cb(null, allowed.includes(file.mimetype));
  },
});

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

    // Merge config: preserve logoUrl if not explicitly provided
    let mergedConfig = config;
    if (config !== undefined) {
      const [existing] = await db
        .select({ config: schema.projects.config })
        .from(schema.projects)
        .where(eq(schema.projects.id, id!))
        .limit(1);
      const oldCfg = (existing?.config ?? {}) as Record<string, unknown>;
      mergedConfig = { ...oldCfg, ...config };
      // Keep logoUrl from DB unless explicitly set in new config
      if (!('logoUrl' in config) && oldCfg.logoUrl) {
        mergedConfig.logoUrl = oldCfg.logoUrl;
      }
    }

    const [updated] = await db
      .update(schema.projects)
      .set({
        ...(name !== undefined ? { name } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(active !== undefined ? { active } : {}),
        ...(mergedConfig !== undefined ? { config: mergedConfig } : {}),
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

projectsRouter.post('/:id/logo', logoUpload.single('logo'), async (req, res) => {
  try {
    const id = req.params['id'] as string;
    if (!req.file) {
      res.status(400).json({ error: 'No valid image file (png/jpeg/webp, max 2MB)' });
      return;
    }

    // Get existing project to delete old logo
    const [project] = await db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, id))
      .limit(1);

    if (!project) {
      fs.unlinkSync(req.file.path);
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    // Delete old logo file if exists
    const oldConfig = (project.config ?? {}) as Record<string, unknown>;
    if (oldConfig.logoUrl && typeof oldConfig.logoUrl === 'string') {
      const oldPath = path.resolve('public', oldConfig.logoUrl.replace(/^\/public\//, ''));
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }

    const logoUrl = `/public/logos/${req.file.filename}`;
    const newConfig = { ...oldConfig, logoUrl };

    const [updated] = await db
      .update(schema.projects)
      .set({ config: newConfig, updatedAt: new Date() })
      .where(eq(schema.projects.id, id))
      .returning();

    res.json({ logoUrl, project: updated });
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
