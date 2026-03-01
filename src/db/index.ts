import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '../config/env.js';
import * as schema from './schema/index.js';

const client = postgres(env.DATABASE_URL);
export const db = drizzle(client, { schema });
export { schema };
