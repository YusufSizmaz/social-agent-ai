import type { ContentType, Platform, Tone, PostStatus } from '../config/constants.js';

export interface AccountStrategy {
  tone: Tone;
  contentTypes: ContentType[];
  promptTemplate: string;
  cronExpression: string;
  contentMix: {
    original: number;
    repost: number;
    reply: number;
  };
  active: boolean;
  hashtags?: string[];
  language?: string;
}

export interface ContentRequest {
  projectId: string;
  platform: Platform;
  contentType: ContentType;
  tone: Tone;
  prompt: string;
  context?: Record<string, unknown>;
  mediaUrls?: string[];
}

export interface GeneratedContent {
  text: string;
  hashtags: string[];
  mediaUrls?: string[];
  metadata?: Record<string, unknown>;
}

export interface PlatformPostResult {
  success: boolean;
  platformPostId?: string;
  url?: string;
  error?: string;
}

export interface PostAnalyticsData {
  likes: number;
  comments: number;
  shares: number;
  impressions: number;
  reach: number;
  engagementRate: number;
}

export interface SafetyCheckResult {
  safe: boolean;
  score: number;
  reasons: string[];
}

export interface PlatformAdapter {
  platform: Platform;
  init(): Promise<void>;
  post(content: GeneratedContent, accountId: string): Promise<PlatformPostResult>;
  delete(platformPostId: string, accountId: string): Promise<boolean>;
  getAnalytics(platformPostId: string, accountId: string): Promise<PostAnalyticsData>;
  uploadMedia?(filePath: string, accountId: string): Promise<string>;
  reply?(platformPostId: string, text: string, accountId: string): Promise<PlatformPostResult>;
  repost?(platformPostId: string, accountId: string): Promise<PlatformPostResult>;
  /** Called when an account's credentials change so cached clients can be dropped */
  invalidateAccount?(accountId: string): void;
  destroy(): Promise<void>;
}

export interface ProjectPlugin {
  name: string;
  init(): Promise<void>;
  /**
   * Returns new content requests. `projectId` may be a project UUID or a project name
   * (matched case-insensitively); an active account for the platform is picked automatically.
   */
  poll(): Promise<ContentRequest[]>;
  transform?(content: GeneratedContent): GeneratedContent;
  /** Builds the prompt when a request's `prompt` is empty */
  getPrompt(request: ContentRequest): string;
  destroy(): Promise<void>;
}

export interface PostRecord {
  id: string;
  projectId: string;
  platform: Platform;
  accountId: string;
  contentType: ContentType;
  text: string;
  hashtags: string[];
  mediaUrls: string[];
  status: PostStatus;
  platformPostId?: string;
  platformUrl?: string;
  scheduledAt?: Date;
  publishedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
