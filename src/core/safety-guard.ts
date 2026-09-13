import { CONTENT_LIMITS, SAFETY_MIN_SCORE, type Platform } from '../config/constants.js';
import type { GeneratedContent, SafetyCheckResult } from '../types/index.js';
import { logger } from '../config/logger.js';

const BANNED_WORDS = [
  'warez', 'illegal', 'yasadışı',
  'kumar', 'bahis', 'casino',
  'nefret', 'ırkçılık', 'terör',
];

// Match at the start of a word only, so Turkish suffixes still match ("terörist")
// but words that merely contain a banned word ("sosyalillegal") do not.
const BANNED_PATTERNS = BANNED_WORDS.map(
  (word) => [word, new RegExp(`(?<![\\p{L}\\p{N}])${word}`, 'iu')] as const,
);

export function normalizeHashtag(tag: string): string {
  const trimmed = tag.trim().replace(/\s+/g, '');
  return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
}

export function composePostText(content: GeneratedContent): string {
  return [content.text, ...content.hashtags.map(normalizeHashtag)].join(' ').trim();
}

/**
 * Trims hashtags so content respects the platform's hashtag count and length limit.
 * The main text is never modified — if it alone is too long the safety check will reject it.
 */
export function fitToPlatform(content: GeneratedContent, platform: Platform): GeneratedContent {
  const limits = CONTENT_LIMITS[platform];
  const seen = new Set<string>();
  let hashtags = content.hashtags
    .map(normalizeHashtag)
    .filter((h) => h.length > 1 && !seen.has(h.toLowerCase()) && seen.add(h.toLowerCase()))
    .slice(0, limits.maxHashtags);

  while (hashtags.length > 0 && composePostText({ ...content, hashtags }).length > limits.maxTextLength) {
    hashtags = hashtags.slice(0, -1);
  }

  return { ...content, hashtags };
}

export function checkContentSafety(
  content: GeneratedContent,
  platform: Platform,
): SafetyCheckResult {
  const reasons: string[] = [];
  let score = 100;

  const limits = CONTENT_LIMITS[platform];

  const fullText = composePostText(content);
  if (fullText.length > limits.maxTextLength) {
    reasons.push(`Text exceeds ${limits.maxTextLength} character limit (${fullText.length})`);
    score -= 50;
  }

  if (content.hashtags.length > limits.maxHashtags) {
    reasons.push(`Too many hashtags: ${content.hashtags.length}/${limits.maxHashtags}`);
    score -= 15;
  }

  for (const [word, pattern] of BANNED_PATTERNS) {
    if (pattern.test(fullText)) {
      reasons.push(`Banned word detected: "${word}"`);
      score -= 25;
    }
  }

  if (content.text.trim().length === 0) {
    reasons.push('Empty content');
    score -= 50;
  }

  score = Math.max(0, score);
  const safe = score >= SAFETY_MIN_SCORE;

  if (!safe) {
    logger.warn('Content failed safety check', { score, reasons });
  }

  return { safe, score, reasons };
}
