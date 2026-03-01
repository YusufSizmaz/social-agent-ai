import type { ContentType, Platform, Tone, PostStatus } from '../config/constants.js';

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
  destroy(): Promise<void>;
}

export interface ProjectPlugin {
  name: string;
  init(): Promise<void>;
  poll(): Promise<ContentRequest[]>;
  transform?(content: GeneratedContent): GeneratedContent;
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
