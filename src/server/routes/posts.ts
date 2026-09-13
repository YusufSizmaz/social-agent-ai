import { Router } from 'express';
import { eq, and, desc, inArray } from 'drizzle-orm';
import * as fs from 'fs';
import { db, schema } from '../../db/index.js';
import { createContent } from '../../core/content-service.js';
import { enqueueJob } from '../../core/queue.js';
import { publicUrlToPath } from '../../core/media.js';
import { JobType } from '../../config/constants.js';
import { logger } from '../../config/logger.js';
import type { ContentRequest } from '../../types/index.js';
import { asyncHandler, isUuid, parseBody, requireUuidParam } from '../middleware.js';
import { generatePostSchema, platformSchema, postStatusSchema, updatePostSchema } from '../schemas.js';

export const postsRouter = Router();

postsRouter.param('id', (req, res, next) => requireUuidParam(req, res, next));

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

postsRouter.get('/', asyncHandler(async (req, res) => {
  const { projectId, platform, status } = req.query as Record<string, string | undefined>;

  const conditions = [];
  if (projectId) {
    if (!isUuid(projectId)) {
      res.status(400).json({ error: 'Invalid projectId' });
      return;
    }
    conditions.push(eq(schema.posts.projectId, projectId));
  }
  if (platform) {
    const parsed = platformSchema.safeParse(platform);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid platform' });
      return;
    }
    conditions.push(eq(schema.posts.platform, parsed.data));
  }
  if (status) {
    const parsed = postStatusSchema.safeParse(status);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid status' });
      return;
    }
    conditions.push(eq(schema.posts.status, parsed.data));
  }

  const posts = await db
    .select()
    .from(schema.posts)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(schema.posts.createdAt))
    .limit(clampInt(req.query['limit'], 50, 1, 200))
    .offset(clampInt(req.query['offset'], 0, 0, Number.MAX_SAFE_INTEGER));

  res.json(posts);
}));

postsRouter.post('/generate', asyncHandler(async (req, res) => {
  const body = parseBody(generatePostSchema, req, res);
  if (!body) return;

  const [project] = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, body.projectId))
    .limit(1);

  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  // Prefer an account on the target platform, fall back to any account in the project
  let [account] = await db
    .select({ id: schema.accounts.id })
    .from(schema.accounts)
    .where(and(eq(schema.accounts.projectId, body.projectId), eq(schema.accounts.platform, body.platform)))
    .limit(1);

  if (!account) {
    [account] = await db
      .select({ id: schema.accounts.id })
      .from(schema.accounts)
      .where(eq(schema.accounts.projectId, body.projectId))
      .limit(1);
  }

  if (!account) {
    res.status(400).json({ error: 'This project has no accounts yet. Add an account first.' });
    return;
  }

  const projectConfig = (project.config ?? {}) as Record<string, unknown>;

  const contentRequest: ContentRequest = {
    projectId: body.projectId,
    platform: body.platform,
    contentType: body.contentType,
    tone: body.tone,
    prompt: body.prompt,
    context: {
      projectConfig,
      projectName: project.name,
      language: body.language ?? projectConfig['language'],
    },
  };

  let content;
  try {
    content = await createContent(contentRequest);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Content generation failed', { error: message });
    res.status(502).json({ error: `Content generation failed: ${message}` });
    return;
  }

  const [post] = await db
    .insert(schema.posts)
    .values({
      projectId: body.projectId,
      accountId: account.id,
      platform: body.platform,
      contentType: body.contentType,
      text: content.text,
      hashtags: content.hashtags,
      mediaUrls: content.mediaUrls,
      status: 'review',
      tone: body.tone,
      qualityScore: content.qualityScore,
      metadata: {
        source: 'dashboard',
        ...(content.qualityFeedback ? { qualityFeedback: content.qualityFeedback } : {}),
      },
    })
    .returning();

  res.status(201).json({
    post,
    generated: { text: content.text, hashtags: content.hashtags, mediaUrls: content.mediaUrls },
  });
}));

postsRouter.get('/:id', asyncHandler(async (req, res) => {
  const id = req.params['id'] as string;
  const [post] = await db
    .select()
    .from(schema.posts)
    .where(eq(schema.posts.id, id))
    .limit(1);

  if (!post) {
    res.status(404).json({ error: 'Post not found' });
    return;
  }

  const [analytics] = await db
    .select()
    .from(schema.postAnalytics)
    .where(eq(schema.postAnalytics.postId, id))
    .orderBy(desc(schema.postAnalytics.fetchedAt))
    .limit(1);

  res.json({ ...post, analytics: analytics ?? null });
}));

postsRouter.post('/:id/publish', asyncHandler(async (req, res) => {
  const id = req.params['id'] as string;

  // Atomically claim the post so double clicks can't queue it twice
  const [post] = await db
    .update(schema.posts)
    .set({ status: 'publishing', errorMessage: null, updatedAt: new Date() })
    .where(and(
      eq(schema.posts.id, id),
      inArray(schema.posts.status, ['review', 'scheduled', 'failed']),
    ))
    .returning();

  if (!post) {
    const [existing] = await db
      .select({ status: schema.posts.status })
      .from(schema.posts)
      .where(eq(schema.posts.id, id))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: 'Post not found' });
    } else {
      res.status(409).json({ error: `A post with status "${existing.status}" cannot be published` });
    }
    return;
  }

  await enqueueJob(JobType.PUBLISH_POST, {
    postId: post.id,
    platform: post.platform,
    accountId: post.accountId,
  });

  res.json({ success: true, message: 'Queued for publishing' });
}));

postsRouter.patch('/:id', asyncHandler(async (req, res) => {
  const id = req.params['id'] as string;
  const body = parseBody(updatePostSchema, req, res);
  if (!body) return;

  const [updated] = await db
    .update(schema.posts)
    .set({
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.text !== undefined ? { text: body.text } : {}),
      ...(body.hashtags !== undefined ? { hashtags: body.hashtags } : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.posts.id, id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: 'Post not found' });
    return;
  }

  res.json(updated);
}));

postsRouter.delete('/:id', asyncHandler(async (req, res) => {
  const id = req.params['id'] as string;

  const deleted = await db.transaction(async (tx) => {
    await tx.delete(schema.postAnalytics).where(eq(schema.postAnalytics.postId, id));
    const [row] = await tx
      .delete(schema.posts)
      .where(eq(schema.posts.id, id))
      .returning({ id: schema.posts.id, mediaUrls: schema.posts.mediaUrls });
    return row;
  });

  if (!deleted) {
    res.status(404).json({ error: 'Post not found' });
    return;
  }

  // Remove generated media that only this post referenced
  for (const url of deleted.mediaUrls ?? []) {
    const filePath = url.startsWith('/public/videos/') ? publicUrlToPath(url) : null;
    if (filePath) {
      fs.promises.unlink(filePath).catch(() => {});
    }
  }

  res.json({ success: true });
}));
