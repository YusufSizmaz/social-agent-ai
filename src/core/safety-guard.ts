import { CONTENT_LIMITS, SAFETY_MIN_SCORE, type Platform } from '../config/constants.js';
import type { GeneratedContent, SafetyCheckResult } from '../types/index.js';
import { logger } from '../config/logger.js';

const BANNED_WORDS = [
  'hack', 'crack', 'warez', 'illegal', 'yasadışı',
  'kumar', 'bahis', 'casino',
  'nefret', 'ırkçılık', 'terör',
];

export function checkContentSafety(
  content: GeneratedContent,
  platform: Platform,
): SafetyCheckResult {
  const reasons: string[] = [];
  let score = 100;

  const limits = CONTENT_LIMITS[platform];

  const fullText = `${content.text} ${content.hashtags.join(' ')}`;
  if (fullText.length > limits.maxTextLength) {
    reasons.push(`Text exceeds ${limits.maxTextLength} character limit (${fullText.length})`);
    score -= 30;
  }

  if (content.hashtags.length > limits.maxHashtags) {
    reasons.push(`Too many hashtags: ${content.hashtags.length}/${limits.maxHashtags}`);
    score -= 15;
  }

  const lowerText = fullText.toLowerCase();
  for (const word of BANNED_WORDS) {
    if (lowerText.includes(word)) {
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
