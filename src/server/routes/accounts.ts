import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db, schema } from '../../db/index.js';

export const accountsRouter = Router();

accountsRouter.get('/', async (req, res) => {
  try {
    const { projectId } = req.query as { projectId?: string };

    let query = db.select({
      id: schema.accounts.id,
      projectId: schema.accounts.projectId,
      platform: schema.accounts.platform,
      role: schema.accounts.role,
      username: schema.accounts.username,
      active: schema.accounts.active,
      strategy: schema.accounts.strategy,
      lastUsedAt: schema.accounts.lastUsedAt,
      createdAt: schema.accounts.createdAt,
    }).from(schema.accounts).$dynamic();

    if (projectId) {
      query = query.where(eq(schema.accounts.projectId, projectId));
    }

    const accounts = await query;
    res.json(accounts);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' });
  }
});

accountsRouter.post('/', async (req, res) => {
  try {
    const { projectId, platform, role, username, credentials, strategy } = req.body as {
      projectId: string;
      platform: string;
      role?: string;
      username: string;
      credentials: Record<string, string>;
      strategy?: Record<string, unknown>;
    };

    const [account] = await db
      .insert(schema.accounts)
      .values({
        projectId,
        platform: platform as 'twitter' | 'instagram' | 'youtube' | 'tiktok',
        role: (role ?? 'primary') as 'primary' | 'secondary' | 'backup',
        username,
        credentials,
        ...(strategy ? { strategy: strategy as any } : {}),
      })
      .returning();

    res.status(201).json(account);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' });
  }
});

accountsRouter.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body as {
      active?: boolean;
      role?: string;
      username?: string;
      platform?: string;
      credentials?: Record<string, string>;
      strategy?: Record<string, unknown> | null;
    };

    const [updated] = await db
      .update(schema.accounts)
      .set({
        ...(updates.active !== undefined ? { active: updates.active } : {}),
        ...(updates.role ? { role: updates.role as 'primary' | 'secondary' | 'backup' } : {}),
        ...(updates.username ? { username: updates.username } : {}),
        ...(updates.platform ? { platform: updates.platform as 'twitter' | 'instagram' | 'youtube' | 'tiktok' } : {}),
        ...(updates.credentials ? { credentials: updates.credentials } : {}),
        ...(updates.strategy !== undefined ? { strategy: updates.strategy as any } : {}),
      })
      .where(eq(schema.accounts.id, id!))
      .returning();

    if (!updated) {
      res.status(404).json({ error: 'Account not found' });
      return;
    }

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' });
  }
});

accountsRouter.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [deleted] = await db
      .delete(schema.accounts)
      .where(eq(schema.accounts.id, id!))
      .returning({ id: schema.accounts.id });

    if (!deleted) {
      res.status(404).json({ error: 'Account not found' });
      return;
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' });
  }
});
