import * as fs from 'fs';
import { Platform } from '../../config/constants.js';
import { env } from '../../config/env.js';
import type { GeneratedContent, PlatformPostResult, PostAnalyticsData } from '../../types/index.js';
import { BasePlatformAdapter } from '../base.js';
import { logger } from '../../config/logger.js';

export class TikTokAdapter extends BasePlatformAdapter {
  platform = Platform.TIKTOK as const;
  private accessToken: string | null = null;
  private readonly baseUrl = 'https://open.tiktokapis.com/v2';

  async init(): Promise<void> {
    if (!env.TIKTOK_ACCESS_TOKEN) {
      logger.warn('TikTok access token not configured, adapter will be inactive');
      return;
    }

    this.accessToken = env.TIKTOK_ACCESS_TOKEN;
    this.log('Adapter initialized');
  }

  async destroy(): Promise<void> {
    this.accessToken = null;
    this.log('Adapter destroyed');
  }

  private getToken(): string {
    if (!this.accessToken) throw new Error('TikTok adapter not initialized');
    return this.accessToken;
  }

  protected async doPost(content: GeneratedContent, _accountId: string): Promise<PlatformPostResult> {
    const token = this.getToken();
    const videoPath = content.mediaUrls?.[0];

    if (!videoPath) {
      return { success: false, error: 'TikTok requires a video file' };
    }

    const caption = [content.text, ...content.hashtags.map((h) => (h.startsWith('#') ? h : `#${h}`))].join(' ');

    // Step 1: Initialize upload
    const initRes = await fetch(`${this.baseUrl}/post/publish/video/init/`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        post_info: {
          title: caption.slice(0, 150),
          privacy_level: 'PUBLIC_TO_EVERYONE',
          disable_duet: false,
          disable_comment: false,
          disable_stitch: false,
        },
        source_info: {
          source: 'FILE_UPLOAD',
          video_size: fs.statSync(videoPath).size,
        },
      }),
    });

    if (!initRes.ok) {
      const err = await initRes.text();
      return { success: false, error: `TikTok init failed: ${err}` };
    }

    const initData = (await initRes.json()) as { data: { upload_url: string; publish_id: string } };
    const { upload_url, publish_id } = initData.data;

    // Step 2: Upload video
    const videoBuffer = fs.readFileSync(videoPath);
    const uploadRes = await fetch(upload_url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Range': `bytes 0-${videoBuffer.length - 1}/${videoBuffer.length}`,
      },
      body: videoBuffer,
    });

    if (!uploadRes.ok) {
      return { success: false, error: 'TikTok video upload failed' };
    }

    this.log('Video uploaded', { publish_id });

    return {
      success: true,
      platformPostId: publish_id,
    };
  }

  protected async doDelete(_platformPostId: string, _accountId: string): Promise<boolean> {
    logger.warn('TikTok API does not support programmatic deletion');
    return false;
  }

  protected async doGetAnalytics(platformPostId: string, _accountId: string): Promise<PostAnalyticsData> {
    const token = this.getToken();

    const res = await fetch(`${this.baseUrl}/video/query/`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        filters: { video_ids: [platformPostId] },
        fields: ['like_count', 'comment_count', 'share_count', 'view_count'],
      }),
    });

    if (!res.ok) {
      return { likes: 0, comments: 0, shares: 0, impressions: 0, reach: 0, engagementRate: 0 };
    }

    const data = (await res.json()) as {
      data: { videos: Array<{ like_count: number; comment_count: number; share_count: number; view_count: number }> };
    };

    const video = data.data.videos[0];
    if (!video) {
      return { likes: 0, comments: 0, shares: 0, impressions: 0, reach: 0, engagementRate: 0 };
    }

    const engagement = video.like_count + video.comment_count + video.share_count;

    return {
      likes: video.like_count,
      comments: video.comment_count,
      shares: video.share_count,
      impressions: video.view_count,
      reach: video.view_count,
      engagementRate: video.view_count > 0 ? (engagement / video.view_count) * 100 : 0,
    };
  }
}
