import { Router } from 'express';
import { eq, inArray, sql } from 'drizzle-orm';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { db, schema } from '../../db/index.js';
import { syncAccountCrons } from '../../core/account-scheduler.js';
import { PUBLIC_DIR, ensureDir, publicUrlToPath } from '../../core/media.js';
import { asyncHandler, parseBody, requireUuidParam } from '../middleware.js';
import { createProjectSchema, updateProjectSchema } from '../schemas.js';

const LOGOS_DIR = path.join(PUBLIC_DIR, 'logos');
const LOGO_EXTENSIONS: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
};

const logoUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      ensureDir(LOGOS_DIR);
      cb(null, LOGOS_DIR);
    },
    // Never trust the client's filename or extension
    filename: (_req, file, cb) => cb(null, `logo_${randomUUID()}${LOGO_EXTENSIONS[file.mimetype] ?? '.png'}`),
  }),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, file.mimetype in LOGO_EXTENSIONS),
});

function removePublicFile(url: unknown): void {
  if (typeof url !== 'string') return;
  const filePath = publicUrlToPath(url);
  if (filePath && fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

export const projectsRouter = Router();

projectsRouter.param('id', (req, res, next) => requireUuidParam(req, res, next));

projectsRouter.get('/', asyncHandler(async (_req, res) => {
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

  res.json(projects.map(p => ({
    id: p.id,
    name: p.name,
    description: p.description,
    active: p.active,
    config: p.config,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    accountCount: p.account_count,
    postCount: p.post_count,
  })));
}));

projectsRouter.post('/', asyncHandler(async (req, res) => {
  const body = parseBody(createProjectSchema, req, res);
  if (!body) return;

  const [existing] = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(eq(schema.projects.name, body.name))
    .limit(1);

  if (existing) {
    res.status(409).json({ error: `A project named "${body.name}" already exists` });
    return;
  }

  const [project] = await db
    .insert(schema.projects)
    .values({ name: body.name, description: body.description, active: body.active ?? true, config: body.config ?? {} })
    .returning();

  res.status(201).json(project);
}));

projectsRouter.get('/:id', asyncHandler(async (req, res) => {
  const [project] = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, req.params['id'] as string))
    .limit(1);

  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  res.json(project);
}));

projectsRouter.patch('/:id', asyncHandler(async (req, res) => {
  const id = req.params['id'] as string;
  const body = parseBody(updateProjectSchema, req, res);
  if (!body) return;

  const [existing] = await db
    .select({ config: schema.projects.config })
    .from(schema.projects)
    .where(eq(schema.projects.id, id))
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  // Merge config so fields managed elsewhere (e.g. logoUrl from the upload endpoint) are preserved
  const mergedConfig = body.config !== undefined
    ? { ...(existing.config ?? {}), ...body.config }
    : undefined;

  if (body.config && 'logoUrl' in body.config && !body.config['logoUrl'] && existing.config?.['logoUrl']) {
    removePublicFile(existing.config['logoUrl']);
  }

  const [updated] = await db
    .update(schema.projects)
    .set({
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.active !== undefined ? { active: body.active } : {}),
      ...(mergedConfig !== undefined ? { config: mergedConfig } : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.projects.id, id))
    .returning();

  res.json(updated);
}));

projectsRouter.post('/:id/logo', logoUpload.single('logo'), asyncHandler(async (req, res) => {
  const id = req.params['id'] as string;
  if (!req.file) {
    res.status(400).json({ error: 'No valid image file (png/jpeg/webp, max 2MB)' });
    return;
  }

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

  const oldConfig = (project.config ?? {}) as Record<string, unknown>;
  removePublicFile(oldConfig['logoUrl']);

  const logoUrl = `/public/logos/${req.file.filename}`;

  const [updated] = await db
    .update(schema.projects)
    .set({ config: { ...oldConfig, logoUrl }, updatedAt: new Date() })
    .where(eq(schema.projects.id, id))
    .returning();

  res.json({ logoUrl, project: updated });
}));

projectsRouter.delete('/:id', asyncHandler(async (req, res) => {
  const id = req.params['id'] as string;
  const force = req.query['force'] === 'true';

  const [project] = await db
    .select({ id: schema.projects.id, config: schema.projects.config })
    .from(schema.projects)
    .where(eq(schema.projects.id, id))
    .limit(1);

  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const [counts] = await db.execute<{ accounts: number; posts: number }>(sql`
    SELECT
      (SELECT COUNT(*)::int FROM accounts WHERE project_id = ${id}) AS accounts,
      (SELECT COUNT(*)::int FROM posts WHERE project_id = ${id}) AS posts
  `);

  const accountCount = counts?.accounts ?? 0;
  const postCount = counts?.posts ?? 0;

  if ((accountCount > 0 || postCount > 0) && !force) {
    res.status(409).json({
      error: `This project has ${accountCount} account(s) and ${postCount} post(s). Delete with ?force=true to remove them as well.`,
      accountCount,
      postCount,
    });
    return;
  }

  await db.transaction(async (tx) => {
    const postIds = tx.select({ id: schema.posts.id }).from(schema.posts).where(eq(schema.posts.projectId, id));
    await tx.delete(schema.postAnalytics).where(inArray(schema.postAnalytics.postId, postIds));
    await tx.delete(schema.posts).where(eq(schema.posts.projectId, id));
    await tx.delete(schema.accounts).where(eq(schema.accounts.projectId, id));
    await tx.delete(schema.projects).where(eq(schema.projects.id, id));
  });

  removePublicFile(project.config?.['logoUrl']);
  await syncAccountCrons();

  res.json({ success: true });
}));
