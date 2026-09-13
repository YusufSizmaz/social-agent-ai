import type { AccountStrategy } from '../types/index.js';

export type ContentAction = 'original' | 'repost' | 'reply';

/**
 * Picks what an account should do this run based on its content mix.
 * Weights are normalized, so a mix that doesn't add up to 100 still behaves proportionally.
 * `random` must be in [0, 1).
 */
export function pickContentAction(mix: AccountStrategy['contentMix'] | undefined, random: number): ContentAction {
  const original = Math.max(0, Number(mix?.original) || 0);
  const repost = Math.max(0, Number(mix?.repost) || 0);
  const reply = Math.max(0, Number(mix?.reply) || 0);
  const total = original + repost + reply;

  if (total === 0) return 'original';

  const roll = random * total;
  if (roll < original) return 'original';
  if (roll < original + repost) return 'repost';
  return 'reply';
}

/** Strategy hashtags come first so they survive when the list is trimmed to the platform limit */
export function mergeHashtags(preferred: string[] | undefined, generated: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const tag of [...(preferred ?? []), ...generated]) {
    const key = tag.trim().replace(/^#/, '').toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(tag.trim());
  }
  return result;
}
