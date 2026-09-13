import { describe, expect, it } from 'vitest';
import { Platform } from '../src/config/constants.js';
import { checkContentSafety, composePostText, fitToPlatform, normalizeHashtag } from '../src/core/safety-guard.js';

describe('normalizeHashtag', () => {
  it('adds a leading # and strips whitespace', () => {
    expect(normalizeHashtag('coffee')).toBe('#coffee');
    expect(normalizeHashtag(' #good morning ')).toBe('#goodmorning');
  });
});

describe('composePostText', () => {
  it('joins text and hashtags', () => {
    expect(composePostText({ text: 'Hello', hashtags: ['a', '#b'] })).toBe('Hello #a #b');
  });
});

describe('fitToPlatform', () => {
  it('limits the number of hashtags', () => {
    const hashtags = Array.from({ length: 10 }, (_, i) => `tag${i}`);
    const fitted = fitToPlatform({ text: 'Hi', hashtags }, Platform.TWITTER);
    expect(fitted.hashtags).toHaveLength(5);
  });

  it('drops trailing hashtags until the post fits the length limit', () => {
    // 272 + " #one" = 277 fits, adding " #two" would make 282
    const text = 'x'.repeat(272);
    const fitted = fitToPlatform({ text, hashtags: ['#one', '#two', '#three'] }, Platform.TWITTER);
    expect(composePostText(fitted).length).toBeLessThanOrEqual(280);
    expect(fitted.hashtags).toEqual(['#one']);
  });

  it('removes duplicate hashtags case-insensitively', () => {
    const fitted = fitToPlatform({ text: 'Hi', hashtags: ['#Coffee', 'coffee', '#tea'] }, Platform.INSTAGRAM);
    expect(fitted.hashtags).toEqual(['#Coffee', '#tea']);
  });

  it('never changes the main text', () => {
    const text = 'y'.repeat(400);
    expect(fitToPlatform({ text, hashtags: [] }, Platform.TWITTER).text).toBe(text);
  });
});

describe('checkContentSafety', () => {
  it('accepts normal content', () => {
    const result = checkContentSafety({ text: 'A lovely day for coffee', hashtags: ['#coffee'] }, Platform.TWITTER);
    expect(result).toMatchObject({ safe: true, score: 100, reasons: [] });
  });

  it('rejects content over the platform limit', () => {
    const result = checkContentSafety({ text: 'x'.repeat(300), hashtags: [] }, Platform.TWITTER);
    expect(result.safe).toBe(false);
  });

  it('rejects empty content', () => {
    expect(checkContentSafety({ text: '   ', hashtags: [] }, Platform.TWITTER).safe).toBe(false);
  });

  it('flags banned words including Turkish suffixes', () => {
    const result = checkContentSafety({ text: 'terörist saldırı', hashtags: [] }, Platform.INSTAGRAM);
    expect(result.reasons).toContain('Banned word detected: "terör"');
  });

  it('does not flag banned words embedded inside other words', () => {
    const result = checkContentSafety({ text: 'Our minicasinoless event', hashtags: [] }, Platform.INSTAGRAM);
    expect(result.reasons).toEqual([]);
  });
});
