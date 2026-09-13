import { Router } from 'express';
import { eq, inArray } from 'drizzle-orm';
import { db, schema } from '../../db/index.js';
import { engine } from '../../core/engine.js';
import { syncAccountCrons } from '../../core/account-scheduler.js';
import { logger } from '../../config/logger.js';
import type { AccountStrategy } from '../../types/index.js';
import { asyncHandler, isUuid, parseBody, requireUuidParam } from '../middleware.js';
import { createAccountSchema, updateAccountSchema } from '../schemas.js';

export const accountsRouter = Router();

accountsRouter.param('id', (req, res, next) => requireUuidParam(req, res, next));

type AccountRow = typeof schema.accounts.$inferSelect;

/** Never send stored credentials back to the browser — only whether they exist */
function sanitize({ credentials, ...rest }: AccountRow) {
  const creds = (credentials ?? {}) as Record<string, string>;
  return {
    ...rest,
    hasCredentials: Object.values(creds).some((v) => typeof v === 'string' && v.length > 0),
  };
}

/** Keeps cron jobs and cached API clients in step with account changes */
async function afterAccountChange(accountId: string): Promise<void> {
  engine.invalidateAccount(accountId);
  try {
    await syncAccountCrons();
  } catch (err) {
    logger.error('Failed to resync account crons', { error: err instanceof Error ? err.message : String(err) });
  }
}

accountsRouter.get('/', asyncHandler(async (req, res) => {
  const { projectId } = req.query as { projectId?: string };

  if (projectId !== undefined && !isUuid(projectId)) {
    res.status(400).json({ error: 'Invalid projectId' });
    return;
  }

  const accounts = await db
    .select()
    .from(schema.accounts)
    .where(projectId ? eq(schema.accounts.projectId, projectId) : undefined)
    .orderBy(schema.accounts.createdAt);

  res.json(accounts.map(sanitize));
}));

accountsRouter.post('/', asyncHandler(async (req, res) => {
  const body = parseBody(createAccountSchema, req, res);
  if (!body) return;

  const [project] = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(eq(schema.projects.id, body.projectId))
    .limit(1);

  if (!project) {
    res.status(400).json({ error: 'Project not found' });
    return;
  }

  const [account] = await db
    .insert(schema.accounts)
    .values({
      projectId: body.projectId,
      platform: body.platform,
      role: body.role ?? 'primary',
      username: body.username,
      credentials: body.credentials,
      active: body.active ?? true,
      ...(body.strategy ? { strategy: body.strategy as AccountStrategy } : {}),
    })
    .returning();

  await afterAccountChange(account!.id);
  res.status(201).json(sanitize(account!));
}));

accountsRouter.patch('/:id', asyncHandler(async (req, res) => {
  const id = req.params['id'] as string;
  const updates = parseBody(updateAccountSchema, req, res);
  if (!updates) return;

  const [updated] = await db
    .update(schema.accounts)
    .set({
      ...(updates.active !== undefined ? { active: updates.active } : {}),
      ...(updates.role ? { role: updates.role } : {}),
      ...(updates.username ? { username: updates.username } : {}),
      ...(updates.platform ? { platform: updates.platform } : {}),
      ...(updates.credentials ? { credentials: updates.credentials } : {}),
      ...(updates.strategy !== undefined ? { strategy: updates.strategy as AccountStrategy | null } : {}),
    })
    .where(eq(schema.accounts.id, id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }

  await afterAccountChange(id);
  res.json(sanitize(updated));
}));

accountsRouter.delete('/:id', asyncHandler(async (req, res) => {
  const id = req.params['id'] as string;
  const force = req.query['force'] === 'true';

  const posts = await db
    .select({ id: schema.posts.id })
    .from(schema.posts)
    .where(eq(schema.posts.accountId, id));

  if (posts.length > 0 && !force) {
    res.status(409).json({
      error: `This account has ${posts.length} post(s). Delete with ?force=true to remove them as well.`,
      postCount: posts.length,
    });
    return;
  }

  const deleted = await db.transaction(async (tx) => {
    if (posts.length > 0) {
      const postIds = posts.map((p) => p.id);
      await tx.delete(schema.postAnalytics).where(inArray(schema.postAnalytics.postId, postIds));
      await tx.delete(schema.posts).where(inArray(schema.posts.id, postIds));
    }
    const [row] = await tx
      .delete(schema.accounts)
      .where(eq(schema.accounts.id, id))
      .returning({ id: schema.accounts.id });
    return row;
  });

  if (!deleted) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }

  await afterAccountChange(id);
  res.json({ success: true });
}));
