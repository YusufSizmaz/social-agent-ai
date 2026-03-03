import { Router } from 'express';
import { eq, and, sql } from 'drizzle-orm';
import { db, schema } from '../../db/index.js';
import { generateText } from '../../ai/text-generator.js';
import { createVideoContent } from '../../ai/video-orchestrator.js';
import { enqueueJob } from '../../core/queue.js';
import { JobType } from '../../config/constants.js';
import type { ContentRequest } from '../../types/index.js';
import fsCopy from 'fs';
import pathUtil from 'path';

const VIDEO_TYPES = new Set(['video', 'short', 'reel']);
const VIDEOS_DIR = pathUtil.resolve('public/videos');
if (!fsCopy.existsSync(VIDEOS_DIR)) fsCopy.mkdirSync(VIDEOS_DIR, { recursive: true });

export const postsRouter = Router();

postsRouter.get('/', async (req, res) => {
  try {
    const { projectId, platform, status, limit = '50', offset = '0' } = req.query as Record<string, string>;

    const conditions = [];
    if (projectId) {
      conditions.push(eq(schema.posts.projectId, projectId));
    }
    if (platform) {
      conditions.push(eq(schema.posts.platform, platform as 'twitter' | 'instagram' | 'youtube' | 'tiktok'));
    }
    if (status) {
      conditions.push(
        eq(schema.posts.status, status as 'pending' | 'generating' | 'review' | 'scheduled' | 'publishing' | 'published' | 'failed'),
      );
    }

    let query = db.select().from(schema.posts).$dynamic();

    if (conditions.length > 0) {
      query = query.where(conditions.length === 1 ? conditions[0]! : and(...conditions));
    }

    const posts = await query
      .orderBy(sql`${schema.posts.createdAt} DESC`)
      .limit(parseInt(limit))
      .offset(parseInt(offset));

    res.json(posts);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' });
  }
});

postsRouter.post('/generate', async (req, res) => {
  try {
    const { projectId, platform, tone, contentType, prompt } = req.body as {
      projectId: string;
      platform: string;
      tone: string;
      contentType: string;
      prompt: string;
    };

    // Find account matching project + platform, fallback to any project account
    let [account] = await db
      .select({ id: schema.accounts.id })
      .from(schema.accounts)
      .where(and(eq(schema.accounts.projectId, projectId), eq(schema.accounts.platform, platform as 'twitter' | 'instagram' | 'youtube' | 'tiktok')))
      .limit(1);

    if (!account) {
      [account] = await db
        .select({ id: schema.accounts.id })
        .from(schema.accounts)
        .where(eq(schema.accounts.projectId, projectId))
        .limit(1);
    }

    if (!account) {
      res.status(400).json({ error: 'Bu projeye bagli hesap yok. Once bir hesap ekleyin.' });
      return;
    }

    // Fetch project config for video pipeline context
    const [project] = await db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, projectId))
      .limit(1);

    const projectConfig = (project?.config ?? {}) as Record<string, unknown>;

    const contentRequest: ContentRequest = {
      projectId,
      platform: platform as ContentRequest['platform'],
      contentType: contentType as ContentRequest['contentType'],
      tone: tone as ContentRequest['tone'],
      prompt,
      context: {
        projectConfig,
        projectName: project?.name,
      },
    };

    let text: string;
    let hashtags: string[];
    let mediaUrls: string[] = [];

    if (VIDEO_TYPES.has(contentType)) {
      // Full video pipeline: text → TTS → image → video
      const result = await createVideoContent(contentRequest);

      // Move video to public dir for serving
      const filename = `video_${Date.now()}.mp4`;
      const publicPath = pathUtil.join(VIDEOS_DIR, filename);
      fsCopy.copyFileSync(result.videoPath, publicPath);

      text = result.text;
      hashtags = result.hashtags;
      mediaUrls = [`/public/videos/${filename}`];

      // Cleanup temp files
      for (const f of [result.videoPath, result.audioPath, result.imagePath]) {
        try { if (fsCopy.existsSync(f)) fsCopy.unlinkSync(f); } catch {}
      }
    } else {
      const generated = await generateText(contentRequest);
      text = generated.text;
      hashtags = generated.hashtags;
      mediaUrls = generated.mediaUrls ?? [];
    }

    const [post] = await db
      .insert(schema.posts)
      .values({
        projectId,
        accountId: account.id,
        platform: platform as 'twitter' | 'instagram' | 'youtube' | 'tiktok',
        contentType: contentType as 'text' | 'image' | 'video' | 'story' | 'reel' | 'short',
        text,
        hashtags,
        mediaUrls,
        status: 'review',
        tone: tone as 'emotional' | 'informative' | 'urgent' | 'hopeful' | 'friendly',
      })
      .returning();

    res.status(201).json({ post, generated: { text, hashtags, mediaUrls } });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' });
  }
});

postsRouter.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [post] = await db
      .select()
      .from(schema.posts)
      .where(eq(schema.posts.id, id!))
      .limit(1);

    if (!post) {
      res.status(404).json({ error: 'Post not found' });
      return;
    }

    const analytics = await db
      .select()
      .from(schema.postAnalytics)
      .where(eq(schema.postAnalytics.postId, id!))
      .orderBy(sql`${schema.postAnalytics.fetchedAt} DESC`)
      .limit(1);

    res.json({ ...post, analytics: analytics[0] ?? null });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' });
  }
});

postsRouter.post('/:id/publish', async (req, res) => {
  try {
    const { id } = req.params;

    const [post] = await db
      .select()
      .from(schema.posts)
      .where(eq(schema.posts.id, id!))
      .limit(1);

    if (!post) {
      res.status(404).json({ error: 'Post not found' });
      return;
    }

    if (!['review', 'scheduled', 'failed'].includes(post.status)) {
      res.status(400).json({ error: `Post durumu "${post.status}" — yayinlanamaz` });
      return;
    }

    // Update status to publishing
    await db
      .update(schema.posts)
      .set({ status: 'publishing', updatedAt: new Date() })
      .where(eq(schema.posts.id, id!));

    // Enqueue publish job
    const content = {
      text: post.text ?? '',
      hashtags: post.hashtags ?? [],
      mediaUrls: post.mediaUrls ?? [],
      metadata: {},
    };

    await enqueueJob(JobType.PUBLISH_POST, {
      postId: post.id,
      platform: post.platform,
      accountId: post.accountId,
      content,
    });

    res.json({ success: true, message: 'Yayinlama kuyruğuna eklendi' });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' });
  }
});

postsRouter.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, text, hashtags } = req.body as {
      status?: string;
      text?: string;
      hashtags?: string[];
    };

    const [updated] = await db
      .update(schema.posts)
      .set({
        ...(status !== undefined ? { status: status as 'pending' | 'generating' | 'review' | 'scheduled' | 'publishing' | 'published' | 'failed' } : {}),
        ...(text !== undefined ? { text } : {}),
        ...(hashtags !== undefined ? { hashtags } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.posts.id, id!))
      .returning();

    if (!updated) {
      res.status(404).json({ error: 'Post not found' });
      return;
    }

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' });
  }
});

postsRouter.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [deleted] = await db
      .delete(schema.posts)
      .where(eq(schema.posts.id, id!))
      .returning({ id: schema.posts.id });

    if (!deleted) {
      res.status(404).json({ error: 'Post not found' });
      return;
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' });
  }
});
