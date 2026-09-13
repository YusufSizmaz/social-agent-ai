import { CONTENT_LIMITS, ContentType, Platform, Tone } from '../config/constants.js';
import type { ContentRequest } from '../types/index.js';

const TONE_DESCRIPTIONS: Record<Tone, string> = {
  [Tone.EMOTIONAL]: 'emotional and heartfelt, creating a personal connection',
  [Tone.INFORMATIVE]: 'informative and clear, focused on useful facts',
  [Tone.URGENT]: 'urgent and action-oriented, encouraging people to act or share now',
  [Tone.HOPEFUL]: 'hopeful and uplifting',
  [Tone.FRIENDLY]: 'friendly, warm and conversational',
};

const LANGUAGE_NAMES: Record<string, string> = {
  tr: 'Turkish',
  en: 'English',
  de: 'German',
  es: 'Spanish',
  fr: 'French',
  it: 'Italian',
  pt: 'Portuguese',
  ar: 'Arabic',
};

const CONTENT_TYPE_HINTS: Partial<Record<ContentType, string>> = {
  [ContentType.VIDEO]: 'The text will be read aloud as a voiceover, so write natural spoken sentences without emojis or links.',
  [ContentType.SHORT]: 'The text will be read aloud as a voiceover for a vertical short video (under 60 seconds). Keep it under 120 words, no emojis or links.',
  [ContentType.REEL]: 'The text will be read aloud as a voiceover for a vertical reel (under 60 seconds). Keep it under 120 words, no emojis or links.',
  [ContentType.STORY]: 'Keep it very short — a single punchy sentence.',
};

export function languageName(code: string | undefined): string | undefined {
  if (!code) return undefined;
  return LANGUAGE_NAMES[code.toLowerCase()] ?? code;
}

/**
 * Wraps the user/strategy prompt with platform constraints so the model produces
 * content that actually fits the target platform (length, hashtag count, tone, language).
 */
export function buildGenerationPrompt(request: ContentRequest): string {
  const limits = CONTENT_LIMITS[request.platform as Platform];
  const language = languageName(request.context?.['language'] as string | undefined);
  const tone = TONE_DESCRIPTIONS[request.tone as Tone];

  const rules = [
    `Platform: ${request.platform}`,
    `Content type: ${request.contentType}`,
    tone ? `Tone: ${tone}` : undefined,
    limits
      ? `The "text" plus all hashtags joined with spaces must fit within ${limits.maxTextLength} characters.`
      : undefined,
    limits ? `Return at most ${limits.maxHashtags} hashtags in the "hashtags" array and do not repeat them inside "text".` : undefined,
    CONTENT_TYPE_HINTS[request.contentType as ContentType],
    language ? `Write the response in ${language}.` : undefined,
  ].filter(Boolean);

  return [
    'You are an expert social media copywriter.',
    '',
    'Task:',
    request.prompt.trim(),
    '',
    'Rules:',
    ...rules.map((r) => `- ${r}`),
  ].join('\n');
}
