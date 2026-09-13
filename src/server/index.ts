import express from 'express';
import type { Server } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { sql } from 'drizzle-orm';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { db } from '../db/index.js';
import { engine } from '../core/engine.js';
import { PUBLIC_DIR } from '../core/media.js';
import { dashboardRouter } from './routes/dashboard.js';
import { accountsRouter } from './routes/accounts.js';
import { postsRouter } from './routes/posts.js';
import { projectsRouter } from './routes/projects.js';
import { twitterAuthRouter } from './routes/twitter-auth.js';
import { basicAuth, errorHandler } from './middleware.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createServer(): express.Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });

  // Health check stays public so Docker / load balancers can probe it
  app.get('/api/health', async (_req, res) => {
    try {
      await db.execute(sql`SELECT 1`);
      res.json({ status: 'ok', engine: engine.isRunning() ? 'running' : 'stopped' });
    } catch {
      res.status(503).json({ status: 'error', database: 'unreachable' });
    }
  });

  app.use(basicAuth({
    username: env.DASHBOARD_USERNAME,
    password: env.DASHBOARD_PASSWORD,
    // The OAuth callback is opened by Twitter's redirect and is protected by the one-time oauth_token
    publicPaths: ['/api/twitter/callback'],
  }));

  app.use(express.json({ limit: '1mb' }));
  app.use(express.static(path.join(__dirname, 'views')));
  app.use('/public', express.static(PUBLIC_DIR));

  app.use('/api/projects', projectsRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/accounts', accountsRouter);
  app.use('/api/posts', postsRouter);
  app.use('/api/twitter', twitterAuthRouter);

  app.get('/', (_req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'index.html'));
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  app.use(errorHandler);

  return app;
}

export function startServer(): Server {
  if (!env.DASHBOARD_PASSWORD) {
    const msg = 'DASHBOARD_PASSWORD is not set — the dashboard and API are accessible without authentication';
    if (env.NODE_ENV === 'production') {
      logger.warn(`${msg}. Set it before exposing this server to a network.`);
    } else {
      logger.info(msg);
    }
  }

  const app = createServer();
  return app.listen(env.PORT, () => {
    logger.info(`Web UI running on http://localhost:${env.PORT}`);
  });
}
