import { logger } from './config/logger.js';
import { env } from './config/env.js';
import { engine } from './core/engine.js';
import { startServer } from './server/index.js';
import { TwitterAdapter } from './platforms/twitter/index.js';
import { InstagramAdapter } from './platforms/instagram/index.js';
import { YouTubeAdapter } from './platforms/youtube/index.js';
import { TikTokAdapter } from './platforms/tiktok/index.js';
import { CatpetPlugin } from './plugins/catpet/index.js';
import { initWhatsApp, destroyWhatsApp } from './notifications/whatsapp.js';

function registerAdapters(): void {
  if (env.TWITTER_API_KEY) {
    engine.registerAdapter(new TwitterAdapter());
  }

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
  if (env.CATPET_DATABASE_URL) {
    engine.registerPlugin(new CatpetPlugin());
  }
}

async function main(): Promise<void> {
  logger.info('Social Media Bot starting...');

  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down gracefully...`);
    await engine.stop();
    await destroyWhatsApp();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  // Initialize WhatsApp (non-blocking — bot works without it)
  initWhatsApp().catch((err) => {
    logger.warn('WhatsApp initialization failed, notifications disabled', {
      error: err instanceof Error ? err.message : String(err),
    });
  });

  registerAdapters();
  registerPlugins();

  startServer();

  try {
    await engine.start();
    logger.info('Social Media Bot is running');
  } catch (err) {
    logger.error('Engine start failed, web panel is still available', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
