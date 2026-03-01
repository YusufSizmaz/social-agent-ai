import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  timestamp,
  integer,
  real,
  jsonb,
  boolean,
} from 'drizzle-orm/pg-core';
import type { AccountStrategy } from '../../types/index.js';

export const platformEnum = pgEnum('platform', ['twitter', 'instagram', 'youtube', 'tiktok']);
export const contentTypeEnum = pgEnum('content_type', ['text', 'image', 'video', 'story', 'reel', 'short']);
export const postStatusEnum = pgEnum('post_status', [
  'pending', 'generating', 'review', 'scheduled', 'publishing', 'published', 'failed',
]);
export const toneEnum = pgEnum('tone', ['emotional', 'informative', 'urgent', 'hopeful', 'friendly']);
export const accountRoleEnum = pgEnum('account_role', ['primary', 'secondary', 'backup']);
export const jobStatusEnum = pgEnum('job_status', ['pending', 'processing', 'completed', 'failed', 'retrying']);
export const jobTypeEnum = pgEnum('job_type', [
  'generate_content', 'publish_post', 'fetch_analytics', 'send_notification', 'poll_source',
]);
export const logLevelEnum = pgEnum('log_level', ['error', 'warn', 'info', 'debug']);

export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 100 }).notNull().unique(),
  description: text('description'),
  active: boolean('active').notNull().default(true),
  config: jsonb('config').$type<Record<string, unknown>>().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id),
  platform: platformEnum('platform').notNull(),
  role: accountRoleEnum('role').notNull().default('primary'),
  username: varchar('username', { length: 100 }).notNull(),
  credentials: jsonb('credentials').$type<Record<string, string>>().notNull(),
  active: boolean('active').notNull().default(true),
  strategy: jsonb('strategy').$type<AccountStrategy>(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const posts = pgTable('posts', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id),
  accountId: uuid('account_id').notNull().references(() => accounts.id),
  platform: platformEnum('platform').notNull(),
  contentType: contentTypeEnum('content_type').notNull(),
  text: text('text').notNull(),
  hashtags: jsonb('hashtags').$type<string[]>().default([]),
  mediaUrls: jsonb('media_urls').$type<string[]>().default([]),
  status: postStatusEnum('status').notNull().default('pending'),
  tone: toneEnum('tone'),
  platformPostId: varchar('platform_post_id', { length: 255 }),
  platformUrl: text('platform_url'),
  safetyScore: integer('safety_score'),
  qualityScore: integer('quality_score'),
  errorMessage: text('error_message'),
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const postAnalytics = pgTable('post_analytics', {
  id: uuid('id').primaryKey().defaultRandom(),
  postId: uuid('post_id').notNull().references(() => posts.id),
  likes: integer('likes').notNull().default(0),
  comments: integer('comments').notNull().default(0),
  shares: integer('shares').notNull().default(0),
  impressions: integer('impressions').notNull().default(0),
  reach: integer('reach').notNull().default(0),
  engagementRate: real('engagement_rate').notNull().default(0),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
});

export const jobQueue = pgTable('job_queue', {
  id: uuid('id').primaryKey().defaultRandom(),
  type: jobTypeEnum('type').notNull(),
  status: jobStatusEnum('status').notNull().default('pending'),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  result: jsonb('result').$type<Record<string, unknown>>(),
  priority: integer('priority').notNull().default(0),
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(3),
  errorMessage: text('error_message'),
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const logs = pgTable('logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  level: logLevelEnum('level').notNull(),
  message: text('message').notNull(),
  context: jsonb('context').$type<Record<string, unknown>>(),
  source: varchar('source', { length: 100 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
