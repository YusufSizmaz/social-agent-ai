import { TwitterApi, type TweetV2PostTweetResult } from 'twitter-api-v2';
import { eq } from 'drizzle-orm';
import { Platform } from '../../config/constants.js';
import { env } from '../../config/env.js';
import type { GeneratedContent, PlatformPostResult, PostAnalyticsData } from '../../types/index.js';
import { BasePlatformAdapter } from '../base.js';
import { logger } from '../../config/logger.js';
import { db, schema } from '../../db/index.js';

export class TwitterAdapter extends BasePlatformAdapter {
  platform = Platform.TWITTER as const;
  private fallbackClient: TwitterApi | null = null;
  private clientCache = new Map<string, TwitterApi>();

  async init(): Promise<void> {
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

  private async getClientForAccount(accountId: string): Promise<TwitterApi> {
    const cached = this.clientCache.get(accountId);
    if (cached) return cached;

    const [account] = await db
      .select({ credentials: schema.accounts.credentials })
      .from(schema.accounts)
      .where(eq(schema.accounts.id, accountId))
      .limit(1);

    const creds = account?.credentials as Record<string, string> | undefined;

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

  protected async doPost(content: GeneratedContent, accountId: string): Promise<PlatformPostResult> {
    const client = await this.getClientForAccount(accountId);
    const fullText = [content.text, ...content.hashtags.map((h) => (h.startsWith('#') ? h : `#${h}`))].join(' ');

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
      url: `https://twitter.com/i/status/${tweetId}`,
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
    const client = await this.getClientForAccount(accountId);
    const tweet = await client.v2.tweet({
      text,
      reply: { in_reply_to_tweet_id: platformPostId },
    });

    return {
      success: true,
      platformPostId: tweet.data.id,
      url: `https://twitter.com/i/status/${tweet.data.id}`,
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
