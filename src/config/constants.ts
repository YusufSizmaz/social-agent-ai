export enum Platform {
  TWITTER = 'twitter',
  INSTAGRAM = 'instagram',
  YOUTUBE = 'youtube',
  TIKTOK = 'tiktok',
}

export enum ContentType {
  TEXT = 'text',
  IMAGE = 'image',
  VIDEO = 'video',
  STORY = 'story',
  REEL = 'reel',
  SHORT = 'short',
}

export enum PostStatus {
  PENDING = 'pending',
  GENERATING = 'generating',
  REVIEW = 'review',
  SCHEDULED = 'scheduled',
  PUBLISHING = 'publishing',
  PUBLISHED = 'published',
  FAILED = 'failed',
}

export enum Tone {
  EMOTIONAL = 'emotional',
  INFORMATIVE = 'informative',
  URGENT = 'urgent',
  HOPEFUL = 'hopeful',
  FRIENDLY = 'friendly',
}

export enum AccountRole {
  PRIMARY = 'primary',
  SECONDARY = 'secondary',
  BACKUP = 'backup',
}

export enum JobStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  RETRYING = 'retrying',
}

export enum JobType {
  GENERATE_CONTENT = 'generate_content',
  PUBLISH_POST = 'publish_post',
  FETCH_ANALYTICS = 'fetch_analytics',
  SEND_NOTIFICATION = 'send_notification',
  POLL_SOURCE = 'poll_source',
}

export enum LogLevel {
  ERROR = 'error',
  WARN = 'warn',
  INFO = 'info',
  DEBUG = 'debug',
}

export const RATE_LIMITS: Record<Platform, { maxPerHour: number; maxPerDay: number; minIntervalMs: number }> = {
  [Platform.TWITTER]: { maxPerHour: 25, maxPerDay: 300, minIntervalMs: 3000 },
  [Platform.INSTAGRAM]: { maxPerHour: 10, maxPerDay: 50, minIntervalMs: 60000 },
  [Platform.YOUTUBE]: { maxPerHour: 5, maxPerDay: 20, minIntervalMs: 120000 },
  [Platform.TIKTOK]: { maxPerHour: 10, maxPerDay: 50, minIntervalMs: 60000 },
};

export const CONTENT_LIMITS: Record<Platform, { maxTextLength: number; maxHashtags: number }> = {
  [Platform.TWITTER]: { maxTextLength: 280, maxHashtags: 5 },
  [Platform.INSTAGRAM]: { maxTextLength: 2200, maxHashtags: 30 },
  [Platform.YOUTUBE]: { maxTextLength: 5000, maxHashtags: 15 },
  [Platform.TIKTOK]: { maxTextLength: 2200, maxHashtags: 10 },
};

export const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
} as const;

export const QUEUE_POLL_INTERVAL_MS = 5000;
export const SAFETY_MIN_SCORE = 60;
