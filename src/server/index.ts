import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { dashboardRouter } from './routes/dashboard.js';
import { accountsRouter } from './routes/accounts.js';
import { postsRouter } from './routes/posts.js';
import { projectsRouter } from './routes/projects.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createServer(): express.Express {
  const app = express();

  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'views')));

  app.use('/api/projects', projectsRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/accounts', accountsRouter);
  app.use('/api/posts', postsRouter);

  app.get('/', (_req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'index.html'));
  });

  return app;
}

export function startServer(): void {
  const app = createServer();
  app.listen(env.PORT, () => {
    logger.info(`Web UI running on http://localhost:${env.PORT}`);
  });
}
