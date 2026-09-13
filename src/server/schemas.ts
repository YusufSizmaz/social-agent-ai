import { z } from 'zod';
import { AccountRole, ContentType, Platform, PostStatus, Tone } from '../config/constants.js';
import { isValidCron } from '../core/scheduler.js';

export const platformSchema = z.nativeEnum(Platform);
export const toneSchema = z.nativeEnum(Tone);
export const contentTypeSchema = z.nativeEnum(ContentType);
export const roleSchema = z.nativeEnum(AccountRole);
export const postStatusSchema = z.nativeEnum(PostStatus);

const uuid = z.string().uuid();
const percent = z.coerce.number().min(0).max(100);

export const strategySchema = z
  .object({
    active: z.boolean().default(false),
    tone: toneSchema.default(Tone.FRIENDLY),
    contentTypes: z.array(contentTypeSchema).min(1).default([ContentType.TEXT]),
    promptTemplate: z.string().max(5000).default(''),
    cronExpression: z
      .string()
      .trim()
      .refine(isValidCron, { message: 'Invalid cron expression' })
      .default('0 */4 * * *'),
    contentMix: z
      .object({ original: percent, repost: percent, reply: percent })
      .default({ original: 100, repost: 0, reply: 0 }),
    hashtags: z.array(z.string().trim().min(1).max(100)).max(30).default([]),
    language: z.string().trim().min(2).max(10).optional(),
  })
  .passthrough()
  .refine((s) => !s.active || s.promptTemplate.trim().length > 0, {
    message: 'An active strategy needs a prompt template',
    path: ['promptTemplate'],
  });

const credentialsSchema = z.record(z.string(), z.string().max(4000));

export const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().max(2000).optional(),
  active: z.boolean().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

export const updateProjectSchema = createProjectSchema.partial();

export const createAccountSchema = z.object({
  projectId: uuid,
  platform: platformSchema,
  role: roleSchema.optional(),
  username: z.string().trim().min(1).max(100),
  credentials: credentialsSchema.default({}),
  strategy: strategySchema.nullable().optional(),
  active: z.boolean().optional(),
});

export const updateAccountSchema = z.object({
  active: z.boolean().optional(),
  role: roleSchema.optional(),
  username: z.string().trim().min(1).max(100).optional(),
  platform: platformSchema.optional(),
  credentials: credentialsSchema.optional(),
  strategy: strategySchema.nullable().optional(),
});

export const generatePostSchema = z.object({
  projectId: uuid,
  platform: platformSchema,
  tone: toneSchema,
  contentType: contentTypeSchema,
  prompt: z.string().trim().min(1).max(5000),
  language: z.string().trim().min(2).max(10).optional(),
});

export const updatePostSchema = z.object({
  status: postStatusSchema.optional(),
  text: z.string().max(10000).optional(),
  hashtags: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
});
