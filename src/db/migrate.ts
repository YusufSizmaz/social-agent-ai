import { logger } from '../config/logger.js';
import { checkDatabaseConnection, closeDb, runMigrations } from './index.js';

if (!(await checkDatabaseConnection())) {
  await closeDb();
  process.exit(1);
}

try {
  logger.info('Applying database migrations...');
  await runMigrations();
  logger.info('Database is up to date');
  await closeDb();
} catch (err) {
  logger.error('Migration failed', { error: err instanceof Error ? err.message : String(err) });
  await closeDb();
  process.exit(1);
}
