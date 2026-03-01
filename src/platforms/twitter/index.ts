import { TwitterApi, type TweetV2PostTweetResult } from 'twitter-api-v2';
import { Platform } from '../../config/constants.js';
import { env } from '../../config/env.js';
import type { GeneratedContent, PlatformPostResult, PostAnalyticsData } from '../../types/index.js';
import { BasePlatformAdapter } from '../base.js';
import { logger } from '../../config/logger.js';

export class TwitterAdapter extends BasePlatformAdapter {
  platform = Platform.TWITTER as const;
  private client: TwitterApi | null = null;

  async init(): Promise<void> {
    if (!env.TWITTER_API_KEY || !env.TWITTER_API_SECRET || !env.TWITTER_ACCESS_TOKEN || !env.TWITTER_ACCESS_SECRET) {
      logger.warn('Twitter credentials not configured, adapter will be inactive');
      return;
    }

    this.client = new TwitterApi({
      appKey: env.TWITTER_API_KEY,
      appSecret: env.TWITTER_API_SECRET,
      accessToken: env.TWITTER_ACCESS_TOKEN,
      accessSecret: env.TWITTER_ACCESS_SECRET,
    });

    this.log('Adapter initialized');
  }

  async destroy(): Promise<void> {
    this.client = null;
    this.log('Adapter destroyed');
  }

  private getClient(): TwitterApi {
    if (!this.client) throw new Error('Twitter adapter not initialized');
    return this.client;
  }

  protected async doPost(content: GeneratedContent, _accountId: string): Promise<PlatformPostResult> {
    const client = this.getClient();
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
    this.log('Tweet posted', { tweetId });

    return {
      success: true,
      platformPostId: tweetId,
      url: `https://twitter.com/i/status/${tweetId}`,
    };
  }

  protected async doDelete(platformPostId: string, _accountId: string): Promise<boolean> {
    const client = this.getClient();
    await client.v2.deleteTweet(platformPostId);
    this.log('Tweet deleted', { platformPostId });
    return true;
  }

  protected async doGetAnalytics(platformPostId: string, _accountId: string): Promise<PostAnalyticsData> {
    const client = this.getClient();

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

  async reply(platformPostId: string, text: string, _accountId: string): Promise<PlatformPostResult> {
    const client = this.getClient();
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

  async repost(platformPostId: string, _accountId: string): Promise<PlatformPostResult> {
    const client = this.getClient();
    const me = await client.v2.me();
    await client.v2.retweet(me.data.id, platformPostId);

    return { success: true, platformPostId };
  }

  async uploadMedia(filePath: string, _accountId: string): Promise<string> {
    const client = this.getClient();
    const mediaId = await client.v1.uploadMedia(filePath);
    return mediaId;
  }
}
