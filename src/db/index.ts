import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import postgres from 'postgres';
import path from 'path';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { errorMessage, isConnectionRefused } from '../core/errors.js';
import * as schema from './schema/index.js';

const client = postgres(env.DATABASE_URL, { onnotice: () => {} });
export const db = drizzle(client, { schema });
export { schema };

export const MIGRATIONS_DIR = path.resolve('drizzle');

/**
 * Databases created with `drizzle-kit push` already contain the initial schema but have no
 * migration history. Record the first migration as applied so `migrate` doesn't try to
 * recreate existing tables; later migrations are written to be idempotent.
 */
async function baselinePushedDatabase(): Promise<void> {
  const [state] = await client<{ has_projects: boolean; has_history: boolean }[]>`
    SELECT
      to_regclass('public.projects') IS NOT NULL AS has_projects,
      to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS has_history
  `;

  if (!state?.has_projects || state.has_history) return;

  const [initial] = readMigrationFiles({ migrationsFolder: MIGRATIONS_DIR });
  if (!initial) return;

  logger.info('Existing schema without migration history detected — recording baseline migration');
  await client.begin(async (tx) => {
    await tx.unsafe('CREATE SCHEMA IF NOT EXISTS drizzle');
    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )
    `);
    await tx.unsafe(
      'INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)',
      [initial.hash, initial.folderMillis],
    );
  });
}

/** Applies pending SQL migrations from the drizzle/ folder */
export async function runMigrations(): Promise<void> {
  await baselinePushedDatabase();
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
}

/** Checks the database is reachable, logging an actionable hint if it isn't */
export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    await client`SELECT 1`;
    return true;
  } catch (err) {
    const url = new URL(env.DATABASE_URL);
    logger.error(`Cannot connect to PostgreSQL at ${url.hostname}:${url.port || 5432} — ${errorMessage(err)}`);
    if (isConnectionRefused(err)) {
      logger.error('Is PostgreSQL running? Start one with `docker compose up -d db`, or check DATABASE_URL in .env');
    }
    return false;
  }
}

export async function closeDb(): Promise<void> {
  await client.end({ timeout: 5 });
}
