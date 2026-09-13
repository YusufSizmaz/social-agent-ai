import { GoogleGenAI } from '@google/genai';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { withRetry } from '../core/retry.js';
import type { Platform } from '../config/constants.js';

const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

export interface QualityResult {
  score: number;
  feedback: string;
}

export async function checkQuality(text: string, platform: Platform): Promise<QualityResult> {
  return withRetry(async () => {
    const response = await ai.models.generateContent({
      model: env.GEMINI_MODEL,
      contents: `You are a social media content quality reviewer.
Evaluate the following post written for ${platform}. The post may be in any language — judge it in its own language.

Post:
"""
${text}
"""

Scoring criteria:
- Grammar and spelling (0-25)
- Engagement potential (0-25)
- Platform fit (0-25)
- Clarity and consistency of the message (0-25)

Give the total score (0-100) and short feedback in the same language as the post.`,
      config: {
        temperature: 0.3,
        maxOutputTokens: 512,
        thinkingConfig: { thinkingBudget: 0 },
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'object' as const,
          properties: {
            score: { type: 'integer' as const },
            feedback: { type: 'string' as const },
          },
          required: ['score', 'feedback'],
        },
      },
    });

    const raw = response.text;
    if (!raw) {
      throw new Error('Empty response from Gemini quality check');
    }

    const parsed = JSON.parse(raw) as { score?: unknown; feedback?: unknown };
    const score = Number(parsed.score);
    if (!Number.isFinite(score)) {
      throw new Error(`Could not parse quality check response: ${raw.slice(0, 200)}`);
    }

    const result: QualityResult = {
      score: Math.max(0, Math.min(100, Math.round(score))),
      feedback: typeof parsed.feedback === 'string' ? parsed.feedback : '',
    };

    logger.debug('Quality check completed', { platform, score: result.score });

    return result;
  }, 'checkQuality');
}
