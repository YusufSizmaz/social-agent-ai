import { Platform } from '../../config/constants.js';
import { env } from '../../config/env.js';
import type { GeneratedContent, PlatformPostResult, PostAnalyticsData } from '../../types/index.js';
import { BasePlatformAdapter } from '../base.js';
import { logger } from '../../config/logger.js';
import { composePostText } from '../../core/safety-guard.js';
import { toAbsoluteUrl } from '../../core/media.js';

const GRAPH_URL = 'https://graph.facebook.com/v21.0';
const CONTAINER_POLL_INTERVAL_MS = 5000;
const CONTAINER_MAX_WAIT_MS = 5 * 60 * 1000;

interface IGIdResponse {
  id: string;
}

interface IGContainerStatus {
  status_code?: 'EXPIRED' | 'ERROR' | 'FINISHED' | 'IN_PROGRESS' | 'PUBLISHED';
  status?: string;
}

interface IGInsightsResponse {
  data: Array<{ name: string; values: Array<{ value: number }> }>;
}

export class InstagramAdapter extends BasePlatformAdapter {
  platform = Platform.INSTAGRAM as const;
  private accessToken: string | null = null;
  private accountId: string | null = null;

  async init(): Promise<void> {
    if (!env.INSTAGRAM_ACCESS_TOKEN || !env.INSTAGRAM_BUSINESS_ACCOUNT_ID) {
      logger.warn('Instagram credentials not configured, adapter will be inactive');
      return;
    }

    this.accessToken = env.INSTAGRAM_ACCESS_TOKEN;
    this.accountId = env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
    this.log('Adapter initialized');
  }

  async destroy(): Promise<void> {
    this.accessToken = null;
    this.accountId = null;
    this.log('Adapter destroyed');
  }

  private getCredentials(): { token: string; accountId: string } {
    if (!this.accessToken || !this.accountId) {
      throw new Error('Instagram adapter not initialized');
    }
    return { token: this.accessToken, accountId: this.accountId };
  }

  protected async doPost(content: GeneratedContent, _accountId: string): Promise<PlatformPostResult> {
    const { token, accountId } = this.getCredentials();
    const caption = composePostText(content);

    const mediaUrl = content.mediaUrls?.[0];
    if (!mediaUrl) {
      return { success: false, error: 'Instagram requires an image or video' };
    }

    const publicUrl = toAbsoluteUrl(mediaUrl, env.PUBLIC_BASE_URL);
    if (!publicUrl) {
      return {
        success: false,
        error: 'Instagram fetches media by URL — set PUBLIC_BASE_URL so locally generated media is reachable',
      };
    }

    const isVideo = /\.(mp4|mov)(\?|$)/i.test(publicUrl);

    // Step 1: Create media container
    const createRes = await fetch(`${GRAPH_URL}/${accountId}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(isVideo ? { media_type: 'REELS', video_url: publicUrl } : { image_url: publicUrl }),
        caption,
        access_token: token,
      }),
    });

    if (!createRes.ok) {
      const err = await createRes.text();
      return { success: false, error: `Instagram create media failed: ${err}` };
    }

    const { id: containerId } = (await createRes.json()) as IGIdResponse;

    // Videos are processed asynchronously — wait until the container is ready
    if (isVideo) {
      const ready = await this.waitForContainer(containerId, token);
      if (!ready.ok) {
        return { success: false, error: `Instagram video processing failed: ${ready.reason}` };
      }
    }

    // Step 2: Publish
    const publishRes = await fetch(`${GRAPH_URL}/${accountId}/media_publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        creation_id: containerId,
        access_token: token,
      }),
    });

    if (!publishRes.ok) {
      const err = await publishRes.text();
      return { success: false, error: `Instagram publish failed: ${err}` };
    }

    const { id: postId } = (await publishRes.json()) as IGIdResponse;

    this.log('Post published', { postId });
    return {
      success: true,
      platformPostId: postId,
      url: await this.getPermalink(postId, token),
    };
  }

  private async waitForContainer(containerId: string, token: string): Promise<{ ok: boolean; reason?: string }> {
    const deadline = Date.now() + CONTAINER_MAX_WAIT_MS;
    while (Date.now() < deadline) {
      const res = await fetch(`${GRAPH_URL}/${containerId}?fields=status_code,status&access_token=${encodeURIComponent(token)}`);
      if (res.ok) {
        const data = (await res.json()) as IGContainerStatus;
        if (data.status_code === 'FINISHED') return { ok: true };
        if (data.status_code === 'ERROR' || data.status_code === 'EXPIRED') {
          return { ok: false, reason: data.status ?? data.status_code };
        }
      }
      await new Promise((resolve) => setTimeout(resolve, CONTAINER_POLL_INTERVAL_MS));
    }
    return { ok: false, reason: 'timed out waiting for media processing' };
  }

  private async getPermalink(mediaId: string, token: string): Promise<string | undefined> {
    try {
      const res = await fetch(`${GRAPH_URL}/${mediaId}?fields=permalink&access_token=${encodeURIComponent(token)}`);
      if (!res.ok) return undefined;
      const data = (await res.json()) as { permalink?: string };
      return data.permalink;
    } catch {
      return undefined;
    }
  }

  protected async doDelete(platformPostId: string, _accountId: string): Promise<boolean> {
    const { token } = this.getCredentials();

    const res = await fetch(
      `${GRAPH_URL}/${platformPostId}?access_token=${encodeURIComponent(token)}`,
      { method: 'DELETE' },
    );

    return res.ok;
  }

  protected async doGetAnalytics(platformPostId: string, _accountId: string): Promise<PostAnalyticsData> {
    const { token } = this.getCredentials();

    const res = await fetch(
      `${GRAPH_URL}/${platformPostId}/insights?metric=impressions,reach,likes,comments,shares&access_token=${encodeURIComponent(token)}`,
    );

    if (!res.ok) {
      return { likes: 0, comments: 0, shares: 0, impressions: 0, reach: 0, engagementRate: 0 };
    }

    const data = (await res.json()) as IGInsightsResponse;
    const metrics: Record<string, number> = {};

    for (const metric of data.data) {
      metrics[metric.name] = metric.values[0]?.value ?? 0;
    }

    const impressions = metrics['impressions'] ?? 0;
    const engagement = (metrics['likes'] ?? 0) + (metrics['comments'] ?? 0) + (metrics['shares'] ?? 0);

    return {
      likes: metrics['likes'] ?? 0,
      comments: metrics['comments'] ?? 0,
      shares: metrics['shares'] ?? 0,
      impressions,
      reach: metrics['reach'] ?? 0,
      engagementRate: impressions > 0 ? (engagement / impressions) * 100 : 0,
    };
  }
}
