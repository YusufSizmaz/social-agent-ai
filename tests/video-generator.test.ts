import { describe, expect, it } from 'vitest';
import { buildSubtitleChunks, escapeAssText, escapeFilterValue } from '../src/ai/video-generator.js';

describe('buildSubtitleChunks', () => {
  it('keeps short sentences whole', () => {
    expect(buildSubtitleChunks('Hello there. How are you?')).toEqual(['Hello there.', 'How are you?']);
  });

  it('splits long sentences every 8 words', () => {
    const sentence = 'one two three four five six seven eight nine ten eleven twelve.';
    expect(buildSubtitleChunks(sentence)).toEqual([
      'one two three four five six seven eight',
      'nine ten eleven twelve.',
    ]);
  });

  it('ignores empty fragments', () => {
    expect(buildSubtitleChunks('Hi!  ...  ')).toEqual(['Hi!', '...']);
  });
});

describe('escapeAssText', () => {
  it('neutralizes override tags and line breaks', () => {
    expect(escapeAssText('{\\b1}bold\nline')).toBe('(/b1)bold line');
  });
});

describe('escapeFilterValue', () => {
  it('escapes colons, quotes and backslashes', () => {
    expect(escapeFilterValue("C:\\temp\\it's.ass")).toBe("C\\:/temp/it'\\''s.ass");
  });
});
