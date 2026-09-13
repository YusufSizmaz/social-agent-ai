import { describe, expect, it } from 'vitest';
import { ContentType, Platform, Tone } from '../src/config/constants.js';
import { buildGenerationPrompt, languageName } from '../src/ai/prompt-builder.js';

const base = {
  projectId: 'p',
  platform: Platform.TWITTER,
  contentType: ContentType.TEXT,
  tone: Tone.FRIENDLY,
  prompt: 'Announce our new seasonal menu',
};

describe('buildGenerationPrompt', () => {
  it('includes the task and platform limits', () => {
    const prompt = buildGenerationPrompt(base);
    expect(prompt).toContain('Announce our new seasonal menu');
    expect(prompt).toContain('280 characters');
    expect(prompt).toContain('at most 5 hashtags');
    expect(prompt).toContain('friendly');
  });

  it('adds a language instruction when requested', () => {
    expect(buildGenerationPrompt({ ...base, context: { language: 'tr' } })).toContain('Write the response in Turkish.');
  });

  it('adds voiceover guidance for video content', () => {
    expect(buildGenerationPrompt({ ...base, platform: Platform.YOUTUBE, contentType: ContentType.SHORT })).toContain('voiceover');
  });
});

describe('languageName', () => {
  it('maps known codes and passes through unknown ones', () => {
    expect(languageName('EN')).toBe('English');
    expect(languageName('nl')).toBe('nl');
    expect(languageName(undefined)).toBeUndefined();
  });
});
