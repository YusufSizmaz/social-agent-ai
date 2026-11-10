import { describe, expect, it } from 'vitest';
import { retimeCron } from '../src/core/strategy-optimizer.js';
import { DeferJobError, isRetryable, rateLimitBackoffMs } from '../src/core/errors.js';
import { updatePostSchema } from '../src/server/schemas.js';

describe('retimeCron', () => {
  it('keeps minute, weekday fields and posts per day', () => {
    expect(retimeCron('30 9,15 * * 1-5', [20, 8, 12])).toBe('30 8,20 * * 1-5');
  });

  it('leaves interval schedules alone so posting frequency is unchanged', () => {
    expect(retimeCron('*/30 * * * *', [9, 13, 18])).toBeNull();
    expect(retimeCron('0 */4 * * *', [9, 13, 18])).toBeNull();
    expect(retimeCron('0 9-17 * * *', [9, 13, 18])).toBeNull();
  });

  it('needs at least as many candidate hours as the schedule has', () => {
    expect(retimeCron('0 9,13,18 * * *', [10, 11])).toBeNull();
  });

  it('ignores duplicate and out-of-range hours', () => {
    expect(retimeCron('0 9 * * *', [25, 14, 14])).toBe('0 14 * * *');
  });
});

describe('rateLimitBackoffMs', () => {
  const now = 1_700_000_000_000;

  it('is zero for errors that are not rate limits', () => {
    expect(rateLimitBackoffMs(Object.assign(new Error('x'), { status: 500 }), now)).toBe(0);
    expect(rateLimitBackoffMs(new Error('network'), now)).toBe(0);
  });

  it('waits until the reset time a platform reports', () => {
    const err = Object.assign(new Error('Too Many Requests'), { code: 429, rateLimit: { reset: now / 1000 + 600 } });
    expect(rateLimitBackoffMs(err, now)).toBe(605_000);
  });

  it('honours Retry-After and falls back to 15 minutes', () => {
    expect(rateLimitBackoffMs({ status: 429, headers: { 'retry-after': '120' } }, now)).toBe(120_000);
    expect(rateLimitBackoffMs({ status: 429 }, now)).toBe(15 * 60_000);
  });
});

describe('DeferJobError', () => {
  it('carries the time the job should run again', () => {
    const runAt = new Date('2030-01-01T00:00:00Z');
    const err = new DeferJobError('limit reached', runAt);
    expect(err.runAt).toBe(runAt);
    expect(isRetryable(err)).toBe(true);
  });
});

describe('updatePostSchema', () => {
  it('only lets clients move posts between review and scheduled', () => {
    expect(updatePostSchema.safeParse({ status: 'scheduled' }).success).toBe(true);
    expect(updatePostSchema.safeParse({ status: 'review' }).success).toBe(true);
    expect(updatePostSchema.safeParse({ status: 'published' }).success).toBe(false);
    expect(updatePostSchema.safeParse({ status: 'publishing' }).success).toBe(false);
  });

  it('accepts a publish time or null', () => {
    const parsed = updatePostSchema.parse({ scheduledAt: '2030-01-01T09:00:00.000Z' });
    expect(parsed.scheduledAt).toEqual(new Date('2030-01-01T09:00:00.000Z'));
    expect(updatePostSchema.parse({ scheduledAt: null }).scheduledAt).toBeNull();
    expect(updatePostSchema.safeParse({ scheduledAt: 'not a date' }).success).toBe(false);
  });
});
