import { describe, expect, it } from 'vitest';
import { assertCompleteResponse, thinkingConfigFor } from '../src/ai/gemini.js';
import { NonRetryableError, isRetryable } from '../src/core/errors.js';
import { PlatformHttpError } from '../src/platforms/http-error.js';
import { extractPublicPostId } from '../src/platforms/tiktok/index.js';

describe('thinkingConfigFor', () => {
  it('disables thinking for Flash models', () => {
    expect(thinkingConfigFor('gemini-2.5-flash')).toEqual({ thinkingBudget: 0 });
    expect(thinkingConfigFor('gemini-2.5-flash-lite')).toEqual({ thinkingBudget: 0 });
  });

  it('leaves models that cannot disable thinking on their default', () => {
    expect(thinkingConfigFor('gemini-2.5-pro')).toBeUndefined();
  });
});

describe('assertCompleteResponse', () => {
  it('accepts a normally finished response', () => {
    expect(() => assertCompleteResponse({ candidates: [{ finishReason: 'STOP' }] }, 'test')).not.toThrow();
    expect(() => assertCompleteResponse({}, 'test')).not.toThrow();
  });

  it('rejects truncated output without retrying', () => {
    expect(() => assertCompleteResponse({ candidates: [{ finishReason: 'MAX_TOKENS' }] }, 'test'))
      .toThrow(NonRetryableError);
  });

  it('rejects blocked output without retrying', () => {
    expect(() => assertCompleteResponse({ candidates: [{ finishReason: 'SAFETY' }] }, 'test'))
      .toThrow(/blocked/);
  });
});

describe('PlatformHttpError', () => {
  it('lets retry logic tell client errors from server errors', () => {
    expect(isRetryable(new PlatformHttpError('bad token', 400))).toBe(false);
    expect(isRetryable(new PlatformHttpError('server error', 503))).toBe(true);
    expect(isRetryable(new PlatformHttpError('rate limited', 429))).toBe(true);
  });
});

describe('extractPublicPostId', () => {
  it('keeps int64 post ids exact', () => {
    const raw = '{"data":{"status":"PUBLISH_COMPLETE","publicaly_available_post_id":[7412345678901234567]}}';
    expect(extractPublicPostId(raw)).toBe('7412345678901234567');
    // Parsing as a JS number would have lost precision
    expect(String(JSON.parse(raw).data.publicaly_available_post_id[0])).not.toBe('7412345678901234567');
  });

  it('accepts ids sent as strings', () => {
    expect(extractPublicPostId('{"publicaly_available_post_id": ["123"]}')).toBe('123');
  });

  it('returns undefined for private posts', () => {
    expect(extractPublicPostId('{"data":{"status":"PUBLISH_COMPLETE","publicaly_available_post_id":[]}}')).toBeUndefined();
  });
});
