import { logger } from './config/logger.js';
import { engine } from './core/engine.js';
import { startServer } from './server/index.js';

async function main(): Promise<void> {
  logger.info('Social Media Bot starting...');

  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down gracefully...`);
    await engine.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  try {
    await engine.start();
    startServer();
    logger.info('Social Media Bot is running ');
  } catch (err) {
    logger.error('Failed to start', { error: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
