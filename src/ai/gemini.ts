import { NonRetryableError } from '../core/errors.js';

/**
 * Flash models think by default and those tokens count against maxOutputTokens, which can cut
 * structured output short. Short social posts don't need it, so turn thinking off for Flash.
 * Pro models can't disable thinking (they reject a budget of 0), so leave them on their default.
 */
export function thinkingConfigFor(model: string): { thinkingBudget: number } | undefined {
  return /flash/i.test(model) ? { thinkingBudget: 0 } : undefined;
}

interface GeminiResponseLike {
  candidates?: Array<{ finishReason?: string }>;
}

/**
 * Throws a non-retryable error when Gemini stopped before finishing the answer. Retrying the same
 * request would fail the same way (and parsing the truncated JSON gives a confusing SyntaxError).
 */
export function assertCompleteResponse(response: GeminiResponseLike, label: string): void {
  const reason = response.candidates?.[0]?.finishReason;
  if (reason === 'MAX_TOKENS') {
    throw new NonRetryableError(
      `${label}: Gemini hit the output token limit before finishing — shorten the prompt or use a model without long thinking`,
    );
  }
  if (reason === 'SAFETY' || reason === 'PROHIBITED_CONTENT' || reason === 'BLOCKLIST' || reason === 'SPII') {
    throw new NonRetryableError(`${label}: Gemini blocked the response (${reason}) — rephrase the prompt`);
  }
}
