import { TwitterApi, type TweetV2PostTweetResult } from 'twitter-api-v2';
import { eq } from 'drizzle-orm';
import { Platform } from '../../config/constants.js';
import { env } from '../../config/env.js';
import type { GeneratedContent, PlatformPostResult, PostAnalyticsData } from '../../types/index.js';
import { BasePlatformAdapter } from '../base.js';
import { logger } from '../../config/logger.js';
import { db, schema } from '../../db/index.js';

type TwitterAccount = {
  username: string;
  credentials: Record<string, string>;
};

type XquikTweetResponse = {
  tweetId?: unknown;
  writeActionId?: unknown;
  error?: unknown;
  message?: unknown;
};

export class TwitterAdapter extends BasePlatformAdapter {
  platform = Platform.TWITTER as const;
  private fallbackClient: TwitterApi | null = null;
  private clientCache = new Map<string, TwitterApi>();

  async init(): Promise<void> {
    if (env.TWITTER_BACKEND === 'xquik') {
      if (!env.XQUIK_API_KEY) {
        logger.warn('Xquik backend selected but XQUIK_API_KEY is not configured');
        return;
      }

      this.log('Adapter initialized with Xquik backend');
      return;
    }

    if (!env.TWITTER_API_KEY || !env.TWITTER_API_SECRET || !env.TWITTER_ACCESS_TOKEN || !env.TWITTER_ACCESS_SECRET) {
      logger.warn('Twitter env credentials not configured, will use per-account credentials from DB');
      return;
    }

    this.fallbackClient = new TwitterApi({
      appKey: env.TWITTER_API_KEY,
      appSecret: env.TWITTER_API_SECRET,
      accessToken: env.TWITTER_ACCESS_TOKEN,
      accessSecret: env.TWITTER_ACCESS_SECRET,
    });

    this.log('Adapter initialized with env fallback client');
  }

  async destroy(): Promise<void> {
    this.fallbackClient = null;
    this.clientCache.clear();
    this.log('Adapter destroyed');
  }

  private async getAccount(accountId: string): Promise<TwitterAccount | null> {
    const [account] = await db
      .select({
        username: schema.accounts.username,
        credentials: schema.accounts.credentials,
      })
      .from(schema.accounts)
      .where(eq(schema.accounts.id, accountId))
      .limit(1);

    if (!account) {
      return null;
    }

    return {
      username: account.username,
      credentials: account.credentials as Record<string, string>,
    };
  }

  private async getClientForAccount(accountId: string): Promise<TwitterApi> {
    const cached = this.clientCache.get(accountId);
    if (cached) return cached;

    const account = await this.getAccount(accountId);
    const creds = account?.credentials;

    if (creds?.apiKey && creds?.apiSecret && creds?.accessToken && creds?.accessSecret) {
      const client = new TwitterApi({
        appKey: creds.apiKey,
        appSecret: creds.apiSecret,
        accessToken: creds.accessToken,
        accessSecret: creds.accessSecret,
      });
      this.clientCache.set(accountId, client);
      this.log('Created client from DB credentials', { accountId });
      return client;
    }

    if (this.fallbackClient) {
      this.log('Using fallback env client', { accountId });
      return this.fallbackClient;
    }

    throw new Error(`No Twitter credentials found for account ${accountId} and no fallback configured`);
  }

  private formatText(content: GeneratedContent): string {
    return [content.text, ...content.hashtags.map((h) => (h.startsWith('#') ? h : `#${h}`))].join(' ');
  }

  private tweetUrl(tweetId: string): string {
    return `https://twitter.com/i/status/${tweetId}`;
  }

  private async getXquikAccount(accountId: string): Promise<string> {
    const account = await this.getAccount(accountId);
    return account?.credentials.xquikAccount ?? env.XQUIK_ACCOUNT ?? account?.username ?? accountId;
  }

  private async createTweetWithXquik(params: {
    accountId: string;
    text: string;
    mediaUrls?: string[];
    replyToTweetId?: string;
  }): Promise<PlatformPostResult> {
    if (!env.XQUIK_API_KEY) {
      return { success: false, error: 'XQUIK_API_KEY is required when TWITTER_BACKEND=xquik' };
    }

    const account = await this.getXquikAccount(params.accountId);
    const payload: Record<string, unknown> = {
      account,
      text: params.text.slice(0, 280),
    };

    if (params.replyToTweetId) {
      payload.reply_to_tweet_id = params.replyToTweetId;
    }

    if (params.mediaUrls?.length) {
      payload.media = params.mediaUrls.slice(0, 4);
    }

    const response = await fetch(`${env.XQUIK_BASE_URL.replace(/\/+$/, '')}/api/v1/x/tweets`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': env.XQUIK_API_KEY,
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json() as XquikTweetResponse;
    const tweetId = typeof data.tweetId === 'string' ? data.tweetId : '';

    if (tweetId) {
      this.log('Tweet posted with Xquik', { tweetId, accountId: params.accountId });
      return {
        success: true,
        platformPostId: tweetId,
        url: this.tweetUrl(tweetId),
      };
    }

    const writeActionId = typeof data.writeActionId === 'string' ? data.writeActionId : '';
    if (writeActionId) {
      return {
        success: false,
        error: `Xquik write pending confirmation: ${writeActionId}`,
      };
    }

    const message = typeof data.message === 'string' ? data.message : undefined;
    const error = typeof data.error === 'string' ? data.error : undefined;
    return {
      success: false,
      error: message ?? error ?? `Xquik request failed with HTTP ${response.status}`,
    };
  }

  protected async doPost(content: GeneratedContent, accountId: string): Promise<PlatformPostResult> {
    const fullText = this.formatText(content);

    if (env.TWITTER_BACKEND === 'xquik') {
      return this.createTweetWithXquik({
        accountId,
        text: fullText,
        mediaUrls: content.mediaUrls,
      });
    }

    const client = await this.getClientForAccount(accountId);

    type MediaIdsTuple = [string] | [string, string] | [string, string, string] | [string, string, string, string];
    let mediaIds: MediaIdsTuple | undefined;
    if (content.mediaUrls?.length) {
      const ids: string[] = [];
      for (const url of content.mediaUrls.slice(0, 4)) {
        const mediaId = await client.v1.uploadMedia(url);
        ids.push(mediaId);
      }
      if (ids.length > 0) {
        mediaIds = ids as MediaIdsTuple;
      }
    }

    const tweet: TweetV2PostTweetResult = await client.v2.tweet({
      text: fullText,
      ...(mediaIds ? { media: { media_ids: mediaIds } } : {}),
    });

    const tweetId = tweet.data.id;
    this.log('Tweet posted', { tweetId, accountId });

    return {
      success: true,
      platformPostId: tweetId,
      url: this.tweetUrl(tweetId),
    };
  }

  protected async doDelete(platformPostId: string, accountId: string): Promise<boolean> {
    const client = await this.getClientForAccount(accountId);
    await client.v2.deleteTweet(platformPostId);
    this.log('Tweet deleted', { platformPostId, accountId });
    return true;
  }

  protected async doGetAnalytics(platformPostId: string, accountId: string): Promise<PostAnalyticsData> {
    const client = await this.getClientForAccount(accountId);

    const tweet = await client.v2.singleTweet(platformPostId, {
      'tweet.fields': ['public_metrics'],
    });

    const metrics = tweet.data.public_metrics;

    const likes = metrics?.like_count ?? 0;
    const comments = metrics?.reply_count ?? 0;
    const retweets = metrics?.retweet_count ?? 0;
    const quotes = metrics?.quote_count ?? 0;
    const impressions = metrics?.impression_count ?? 0;
    const engagement = likes + comments + retweets + quotes;

    return {
      likes,
      comments,
      shares: retweets + quotes,
      impressions,
      reach: impressions,
      engagementRate: impressions > 0 ? (engagement / impressions) * 100 : 0,
    };
  }

  async reply(platformPostId: string, text: string, accountId: string): Promise<PlatformPostResult> {
    if (env.TWITTER_BACKEND === 'xquik') {
      return this.createTweetWithXquik({
        accountId,
        text,
        replyToTweetId: platformPostId,
      });
    }

    const client = await this.getClientForAccount(accountId);
    const tweet = await client.v2.tweet({
      text,
      reply: { in_reply_to_tweet_id: platformPostId },
    });

    return {
      success: true,
      platformPostId: tweet.data.id,
      url: this.tweetUrl(tweet.data.id),
    };
  }

  async repost(platformPostId: string, accountId: string): Promise<PlatformPostResult> {
    const client = await this.getClientForAccount(accountId);
    const me = await client.v2.me();
    await client.v2.retweet(me.data.id, platformPostId);

    return { success: true, platformPostId };
  }

  async uploadMedia(filePath: string, accountId: string): Promise<string> {
    const client = await this.getClientForAccount(accountId);
    const mediaId = await client.v1.uploadMedia(filePath);
    return mediaId;
  }
}
