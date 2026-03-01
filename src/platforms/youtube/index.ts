import { google, type youtube_v3 } from 'googleapis';
import * as fs from 'fs';
import { Platform } from '../../config/constants.js';
import { env } from '../../config/env.js';
import type { GeneratedContent, PlatformPostResult, PostAnalyticsData } from '../../types/index.js';
import { BasePlatformAdapter } from '../base.js';
import { logger } from '../../config/logger.js';

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
    const videoPath = content.mediaUrls?.[0];

    if (!videoPath) {
      return { success: false, error: 'YouTube requires a video file' };
    }

    const description = [content.text, '', ...content.hashtags.map((h) => (h.startsWith('#') ? h : `#${h}`))].join('\n');
    const title = content.text.slice(0, 100);

    const res = await youtube.videos.insert({
      part: ['snippet', 'status'],
      requestBody: {
        snippet: {
          title,
          description,
          tags: content.hashtags.map((h) => h.replace('#', '')),
          categoryId: '22', // People & Blogs
          defaultLanguage: 'tr',
        },
        status: {
          privacyStatus: 'public',
          selfDeclaredMadeForKids: false,
        },
      },
      media: {
        body: fs.createReadStream(videoPath),
      },
    });

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
