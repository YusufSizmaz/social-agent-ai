import { Router } from 'express';
import { eq, and, sql } from 'drizzle-orm';
import { db, schema } from '../../db/index.js';
import { generateText } from '../../ai/text-generator.js';
import type { ContentRequest } from '../../types/index.js';

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

    const contentRequest: ContentRequest = {
      projectId,
      platform: platform as ContentRequest['platform'],
      contentType: contentType as ContentRequest['contentType'],
      tone: tone as ContentRequest['tone'],
      prompt,
    };

    const generated = await generateText(contentRequest);

    const [post] = await db
      .insert(schema.posts)
      .values({
        projectId,
        accountId: '00000000-0000-0000-0000-000000000000',
        platform: platform as 'twitter' | 'instagram' | 'youtube' | 'tiktok',
        contentType: contentType as 'text' | 'image' | 'video' | 'story' | 'reel' | 'short',
        text: generated.text,
        hashtags: generated.hashtags,
        mediaUrls: generated.mediaUrls ?? [],
        status: 'review',
        tone: tone as 'emotional' | 'informative' | 'urgent' | 'hopeful' | 'friendly',
      })
      .returning();

    res.status(201).json({ post, generated });
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
