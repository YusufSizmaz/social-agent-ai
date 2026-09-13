import { describe, expect, it } from 'vitest';
import { mergeHashtags, pickContentAction } from '../src/core/content-mix.js';

describe('pickContentAction', () => {
  const mix = { original: 80, repost: 15, reply: 5 };

  it('maps the roll onto the configured percentages', () => {
    expect(pickContentAction(mix, 0)).toBe('original');
    expect(pickContentAction(mix, 0.79)).toBe('original');
    expect(pickContentAction(mix, 0.8)).toBe('repost');
    expect(pickContentAction(mix, 0.94)).toBe('repost');
    expect(pickContentAction(mix, 0.96)).toBe('reply');
  });

  it('normalizes mixes that do not add up to 100', () => {
    const half = { original: 1, repost: 1, reply: 0 };
    expect(pickContentAction(half, 0.49)).toBe('original');
    expect(pickContentAction(half, 0.51)).toBe('repost');
  });

  it('falls back to original posts for an empty or missing mix', () => {
    expect(pickContentAction({ original: 0, repost: 0, reply: 0 }, 0.5)).toBe('original');
    expect(pickContentAction(undefined, 0.5)).toBe('original');
  });
});

describe('mergeHashtags', () => {
  it('puts preferred hashtags first and removes duplicates', () => {
    expect(mergeHashtags(['#Adopt', 'rescue'], ['#adopt', '#cats', '#rescue'])).toEqual(['#Adopt', 'rescue', '#cats']);
  });

  it('handles missing preferred hashtags', () => {
    expect(mergeHashtags(undefined, ['#a'])).toEqual(['#a']);
  });
});
