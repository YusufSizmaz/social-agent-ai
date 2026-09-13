import { logger } from './config/logger.js';
import { env } from './config/env.js';
import { engine } from './core/engine.js';
import { startServer } from './server/index.js';
import { checkDatabaseConnection, closeDb, runMigrations } from './db/index.js';
import { errorMessage } from './core/errors.js';
import { TwitterAdapter } from './platforms/twitter/index.js';
import { InstagramAdapter } from './platforms/instagram/index.js';
import { YouTubeAdapter } from './platforms/youtube/index.js';
import { TikTokAdapter } from './platforms/tiktok/index.js';
import { CatpetPlugin } from './plugins/catpet/index.js';
import { initWhatsApp, destroyWhatsApp } from './notifications/whatsapp.js';

function registerAdapters(): void {
  // Twitter is always registered: accounts can carry their own credentials in the database
  engine.registerAdapter(new TwitterAdapter());

  if (env.INSTAGRAM_ACCESS_TOKEN) {
    engine.registerAdapter(new InstagramAdapter());
  }

  if (env.YOUTUBE_CLIENT_ID) {
    engine.registerAdapter(new YouTubeAdapter());
  }

  if (env.TIKTOK_ACCESS_TOKEN) {
    engine.registerAdapter(new TikTokAdapter());
  }
}

function registerPlugins(): void {
  if (env.PLUGIN_DATABASE_URL) {
    engine.registerPlugin(new CatpetPlugin());
  }
}

async function main(): Promise<void> {
  logger.info('Social Agent AI starting...');

  const dbReady = await checkDatabaseConnection();

  if (env.RUN_MIGRATIONS && dbReady) {
    logger.info('Applying database migrations...');
    await runMigrations();
  }

  const server = startServer();

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`Received ${signal}, shutting down gracefully...`);

    const forceExit = setTimeout(() => {
      logger.error('Graceful shutdown timed out, forcing exit');
      process.exit(1);
    }, 90_000);
    forceExit.unref();

    await new Promise<void>((resolve) => server.close(() => resolve()));
    await engine.stop().catch((err) => logger.error('Engine stop failed', { error: String(err) }));
    await destroyWhatsApp().catch(() => {});
    await closeDb().catch(() => {});
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', { error: reason instanceof Error ? reason.stack : String(reason) });
  });

  // Initialize WhatsApp (non-blocking — bot works without it)
  initWhatsApp().catch((err) => {
    logger.warn('WhatsApp initialization failed, notifications disabled', {
      error: err instanceof Error ? err.message : String(err),
    });
  });

  registerAdapters();
  registerPlugins();

  try {
    await engine.start();
    logger.info('Social Agent AI is running');
  } catch (err) {
    logger.error('Engine start failed, web panel is still available', { error: errorMessage(err) });
  }
}

main().catch((err) => {
  logger.error('Fatal error during startup', { error: err instanceof Error ? err.stack : String(err) });
  process.exit(1);
});
