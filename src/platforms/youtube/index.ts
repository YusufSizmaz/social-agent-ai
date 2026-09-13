import { google, type youtube_v3 } from 'googleapis';
import * as fs from 'fs';
import { Platform } from '../../config/constants.js';
import { env } from '../../config/env.js';
import type { GeneratedContent, PlatformPostResult, PostAnalyticsData } from '../../types/index.js';
import { BasePlatformAdapter } from '../base.js';
import { logger } from '../../config/logger.js';
import { normalizeHashtag } from '../../core/safety-guard.js';
import { resolveMediaFile } from '../../core/media.js';

function firstSentence(text: string): string {
  const match = text.trim().match(/^[^.!?\n]+[.!?]?/);
  return (match?.[0] ?? text).trim();
}

export class YouTubeAdapter extends BasePlatformAdapter {
  platform = Platform.YOUTUBE as const;
  private youtube: youtube_v3.Youtube | null = null;

  async init(): Promise<void> {
    if (!env.YOUTUBE_CLIENT_ID || !env.YOUTUBE_CLIENT_SECRET || !env.YOUTUBE_REFRESH_TOKEN) {
      logger.warn('YouTube credentials not configured, adapter will be inactive');
      return;
    }

    const oauth2Client = new google.auth.OAuth2(
      env.YOUTUBE_CLIENT_ID,
      env.YOUTUBE_CLIENT_SECRET,
    );

    oauth2Client.setCredentials({ refresh_token: env.YOUTUBE_REFRESH_TOKEN });

    this.youtube = google.youtube({ version: 'v3', auth: oauth2Client });
    this.log('Adapter initialized');
  }

  async destroy(): Promise<void> {
    this.youtube = null;
    this.log('Adapter destroyed');
  }

  private getClient(): youtube_v3.Youtube {
    if (!this.youtube) throw new Error('YouTube adapter not initialized');
    return this.youtube;
  }

  protected async doPost(content: GeneratedContent, _accountId: string): Promise<PlatformPostResult> {
    const youtube = this.getClient();
    const mediaUrl = content.mediaUrls?.[0];

    if (!mediaUrl) {
      return { success: false, error: 'YouTube requires a video file' };
    }

    let media: Awaited<ReturnType<typeof resolveMediaFile>>;
    try {
      media = await resolveMediaFile(mediaUrl);
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }

    const hashtags = content.hashtags.map(normalizeHashtag);
    const description = [content.text, '', hashtags.join(' ')].join('\n').slice(0, 5000);
    // YouTube rejects titles over 100 chars or containing angle brackets
    const title = firstSentence(content.text).replace(/[<>]/g, '').slice(0, 100) || 'Untitled';
    const language = content.metadata?.['language'];

    let res;
    try {
      res = await youtube.videos.insert({
        part: ['snippet', 'status'],
        requestBody: {
          snippet: {
            title,
            description,
            tags: hashtags.map((h) => h.slice(1)),
            categoryId: '22', // People & Blogs
            ...(typeof language === 'string' ? { defaultLanguage: language } : {}),
          },
          status: {
            privacyStatus: 'public',
            selfDeclaredMadeForKids: false,
          },
        },
        media: {
          body: fs.createReadStream(media.filePath),
        },
      });
    } finally {
      media.cleanup();
    }

    const videoId = res.data.id;
    if (!videoId) {
      return { success: false, error: 'YouTube upload returned no video ID' };
    }

    this.log('Video uploaded', { videoId });
    return {
      success: true,
      platformPostId: videoId,
      url: `https://www.youtube.com/watch?v=${videoId}`,
    };
  }

  protected async doDelete(platformPostId: string, _accountId: string): Promise<boolean> {
    const youtube = this.getClient();
    await youtube.videos.delete({ id: platformPostId });
    this.log('Video deleted', { platformPostId });
    return true;
  }

  protected async doGetAnalytics(platformPostId: string, _accountId: string): Promise<PostAnalyticsData> {
    const youtube = this.getClient();

    const res = await youtube.videos.list({
      part: ['statistics'],
      id: [platformPostId],
    });

    const stats = res.data.items?.[0]?.statistics;

    const views = parseInt(stats?.viewCount ?? '0');
    const likes = parseInt(stats?.likeCount ?? '0');
    const comments = parseInt(stats?.commentCount ?? '0');

    return {
      likes,
      comments,
      shares: 0,
      impressions: views,
      reach: views,
      engagementRate: views > 0 ? ((likes + comments) / views) * 100 : 0,
    };
  }
}
