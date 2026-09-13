import 'dotenv/config';
import { z } from 'zod';

// Treat empty strings (e.g. `FOO=` in .env or `${FOO:-}` in docker-compose) as unset
const optionalString = () => z.preprocess((v) => (v === '' ? undefined : v), z.string().optional());
const optionalUrl = () => z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional());
const booleanFlag = (defaultValue: boolean) =>
  z.preprocess(
    (v) => (v === '' || v === undefined ? String(defaultValue) : String(v).toLowerCase()),
    z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1'),
  );

export const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  GEMINI_API_KEY: z.string().min(1),
  GEMINI_MODEL: z.string().default('gemini-2.5-flash'),
  GEMINI_IMAGE_MODEL: z.string().default('imagen-4.0-generate-001'),

  TWITTER_API_KEY: optionalString(),
  TWITTER_API_SECRET: optionalString(),
  TWITTER_ACCESS_TOKEN: optionalString(),
  TWITTER_ACCESS_SECRET: optionalString(),
  TWITTER_CALLBACK_URL: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().url().default('http://localhost:3000/api/twitter/callback'),
  ),

  INSTAGRAM_ACCESS_TOKEN: optionalString(),
  INSTAGRAM_BUSINESS_ACCOUNT_ID: optionalString(),

  YOUTUBE_CLIENT_ID: optionalString(),
  YOUTUBE_CLIENT_SECRET: optionalString(),
  YOUTUBE_REFRESH_TOKEN: optionalString(),

  TIKTOK_ACCESS_TOKEN: optionalString(),

  PEXELS_API_KEY: optionalString(),

  WHATSAPP_ADMIN_NUMBER: optionalString(),

  PLUGIN_DATABASE_URL: optionalUrl(),

  /** Protects the dashboard and REST API with HTTP Basic Auth when set */
  DASHBOARD_USERNAME: z.preprocess((v) => (v === '' ? undefined : v), z.string().default('admin')),
  DASHBOARD_PASSWORD: optionalString(),

  /** Public URL of this server — needed for platforms that fetch media by URL (Instagram) */
  PUBLIC_BASE_URL: optionalUrl(),

  /** Apply pending database migrations on startup */
  RUN_MIGRATIONS: booleanFlag(false),

  /** Score generated content with Gemini before publishing (one extra API call per post) */
  QUALITY_CHECK_ENABLED: booleanFlag(false),
  QUALITY_MIN_SCORE: z.coerce.number().int().min(0).max(100).default(60),

  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('Environment validation failed:');
    for (const issue of result.error.issues) {
      console.error(`  ${issue.path.join('.')}: ${issue.message}`);
    }
    console.error('\nCopy .env.example to .env and fill in the required values.');
    process.exit(1);
  }
  return result.data;
}

export const env = loadEnv();
