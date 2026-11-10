import * as fs from 'fs';
import { Platform } from '../../config/constants.js';
import { env } from '../../config/env.js';
import type { GeneratedContent, PlatformPostResult, PostAnalyticsData } from '../../types/index.js';
import { BasePlatformAdapter } from '../base.js';
import { logger } from '../../config/logger.js';
import { composePostText } from '../../core/safety-guard.js';
import { resolveMediaFile } from '../../core/media.js';
import { httpError } from '../http-error.js';
import { NonRetryableError } from '../../core/errors.js';

const STATUS_POLL_INTERVAL_MS = 5000;
const STATUS_MAX_WAIT_MS = 3 * 60 * 1000;

interface TikTokEnvelope<T> {
  data?: T;
  error?: { code?: string; message?: string };
}

/** TikTok post ids are int64 — read them from the raw JSON so they don't lose precision as JS numbers */
export function extractPublicPostId(rawJson: string): string | undefined {
  return /"publicaly_available_post_id"\s*:\s*\[\s*"?(\d+)/.exec(rawJson)?.[1];
}

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
    const mediaUrl = content.mediaUrls?.[0];

    if (!mediaUrl) {
      return { success: false, error: 'TikTok requires a video file' };
    }

    let media: Awaited<ReturnType<typeof resolveMediaFile>>;
    try {
      media = await resolveMediaFile(mediaUrl);
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }

    try {
      return await this.uploadVideo(token, media.filePath, composePostText(content));
    } finally {
      media.cleanup();
    }
  }

  private headers(token: string): Record<string, string> {
    return { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8' };
  }

  /**
   * Unaudited apps may only post privately (SELF_ONLY); posting publicly is rejected outright.
   * Ask TikTok which privacy levels this creator/app combination allows.
   */
  private async pickPrivacyLevel(token: string): Promise<string> {
    const res = await fetch(`${this.baseUrl}/post/publish/creator_info/query/`, {
      method: 'POST',
      headers: this.headers(token),
    });
    if (!res.ok) {
      throw await httpError('TikTok creator info request failed', res);
    }
    const body = (await res.json()) as TikTokEnvelope<{ privacy_level_options?: string[] }>;
    const options = body.data?.privacy_level_options ?? [];
    if (options.includes('PUBLIC_TO_EVERYONE')) return 'PUBLIC_TO_EVERYONE';

    const fallback = options[0] ?? 'SELF_ONLY';
    logger.warn(`[tiktok] Public posting not allowed for this app/account — posting as ${fallback}. `
      + 'Unaudited TikTok apps can only post privately; submit the app for audit to post publicly.');
    return fallback;
  }

  /** Waits until TikTok has processed the upload; uploads can still fail after being accepted */
  private async waitForPublish(token: string, publishId: string): Promise<PlatformPostResult> {
    const deadline = Date.now() + STATUS_MAX_WAIT_MS;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, STATUS_POLL_INTERVAL_MS));

      const res = await fetch(`${this.baseUrl}/post/publish/status/fetch/`, {
        method: 'POST',
        headers: this.headers(token),
        body: JSON.stringify({ publish_id: publishId }),
      });
      if (!res.ok) {
        if (res.status >= 400 && res.status < 500 && res.status !== 429) {
          throw await httpError('TikTok publish status request failed', res);
        }
        continue;
      }

      const raw = await res.text();
      const body = JSON.parse(raw) as TikTokEnvelope<{ status?: string; fail_reason?: string }>;
      const status = body.data?.status;

      if (status === 'FAILED') {
        return { success: false, error: `TikTok rejected the video: ${body.data?.fail_reason ?? 'unknown reason'}` };
      }
      if (status === 'PUBLISH_COMPLETE') {
        // Private (SELF_ONLY) posts have no public id; keep the publish id so the post is still traceable
        return { success: true, platformPostId: extractPublicPostId(raw) ?? publishId };
      }
    }

    logger.warn(`[tiktok] Still processing after ${STATUS_MAX_WAIT_MS / 1000}s, treating upload as accepted`, { publishId });
    return { success: true, platformPostId: publishId };
  }

  private async uploadVideo(token: string, videoPath: string, caption: string): Promise<PlatformPostResult> {
    const videoSize = fs.statSync(videoPath).size;
    const privacyLevel = await this.pickPrivacyLevel(token);

    // Step 1: Initialize upload (single chunk — TikTok allows up to 64MB per chunk)
    const initRes = await fetch(`${this.baseUrl}/post/publish/video/init/`, {
      method: 'POST',
      headers: this.headers(token),
      body: JSON.stringify({
        post_info: {
          title: caption.slice(0, 150),
          privacy_level: privacyLevel,
          disable_duet: false,
          disable_comment: false,
          disable_stitch: false,
        },
        source_info: {
          source: 'FILE_UPLOAD',
          video_size: videoSize,
          chunk_size: videoSize,
          total_chunk_count: 1,
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

    this.log('Video uploaded, waiting for TikTok to process it', { publish_id });

    const result = await this.waitForPublish(token, publish_id);
    if (result.success) {
      this.log('Video published', { publish_id, platformPostId: result.platformPostId });
    }
    return result;
  }

  protected async doDelete(_platformPostId: string, _accountId: string): Promise<boolean> {
    logger.warn('TikTok API does not support programmatic deletion');
    return false;
  }

  protected async doGetAnalytics(platformPostId: string, _accountId: string): Promise<PostAnalyticsData> {
    const token = this.getToken();

    // Private posts (and uploads still processing) only have a publish id, which video/query can't look up
    if (!/^\d+$/.test(platformPostId)) {
      throw new NonRetryableError(`TikTok post ${platformPostId} has no public video id, metrics unavailable`);
    }

    // `fields` must be a query parameter; only the filters go in the body
    const fields = 'like_count,comment_count,share_count,view_count';
    const res = await fetch(`${this.baseUrl}/video/query/?fields=${fields}`, {
      method: 'POST',
      headers: this.headers(token),
      body: JSON.stringify({ filters: { video_ids: [platformPostId] } }),
    });

    // Throw rather than return zeros, so a transient error doesn't overwrite real numbers
    if (!res.ok) {
      throw await httpError('TikTok video query failed', res);
    }

    const data = (await res.json()) as TikTokEnvelope<{
      videos?: Array<{ like_count?: number; comment_count?: number; share_count?: number; view_count?: number }>;
    }>;

    const raw = data.data?.videos?.[0];
    if (!raw) {
      throw new NonRetryableError(`TikTok video ${platformPostId} not found (deleted or not visible to this token)`);
    }
    const video = {
      like_count: raw.like_count ?? 0,
      comment_count: raw.comment_count ?? 0,
      share_count: raw.share_count ?? 0,
      view_count: raw.view_count ?? 0,
    };

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
