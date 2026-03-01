import { Platform } from '../../config/constants.js';
import { env } from '../../config/env.js';
import type { GeneratedContent, PlatformPostResult, PostAnalyticsData } from '../../types/index.js';
import { BasePlatformAdapter } from '../base.js';
import { logger } from '../../config/logger.js';

interface IGMediaResponse {
  id: string;
}

interface IGPublishResponse {
  id: string;
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
    const caption = [content.text, ...content.hashtags.map((h) => (h.startsWith('#') ? h : `#${h}`))].join(' ');

    const imageUrl = content.mediaUrls?.[0];
    if (!imageUrl) {
      return { success: false, error: 'Instagram requires at least one image' };
    }

    // Step 1: Create media container
    const createRes = await fetch(
      `https://graph.facebook.com/v21.0/${accountId}/media`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_url: imageUrl,
          caption,
          access_token: token,
        }),
      },
    );

    if (!createRes.ok) {
      const err = await createRes.text();
      return { success: false, error: `Instagram create media failed: ${err}` };
    }

    const { id: containerId } = (await createRes.json()) as IGMediaResponse;

    // Step 2: Publish
    const publishRes = await fetch(
      `https://graph.facebook.com/v21.0/${accountId}/media_publish`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creation_id: containerId,
          access_token: token,
        }),
      },
    );

    if (!publishRes.ok) {
      const err = await publishRes.text();
      return { success: false, error: `Instagram publish failed: ${err}` };
    }

    const { id: postId } = (await publishRes.json()) as IGPublishResponse;

    this.log('Post published', { postId });
    return {
      success: true,
      platformPostId: postId,
      url: `https://www.instagram.com/p/${postId}/`,
    };
  }

  protected async doDelete(platformPostId: string, _accountId: string): Promise<boolean> {
    const { token } = this.getCredentials();

    const res = await fetch(
      `https://graph.facebook.com/v21.0/${platformPostId}?access_token=${token}`,
      { method: 'DELETE' },
    );

    return res.ok;
  }

  protected async doGetAnalytics(platformPostId: string, _accountId: string): Promise<PostAnalyticsData> {
    const { token } = this.getCredentials();

    const res = await fetch(
      `https://graph.facebook.com/v21.0/${platformPostId}/insights?metric=impressions,reach,likes,comments,shares&access_token=${token}`,
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
