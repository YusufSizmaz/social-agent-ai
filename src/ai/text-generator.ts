import { GoogleGenAI } from '@google/genai';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { withRetry } from '../core/retry.js';
import type { ContentRequest, GeneratedContent } from '../types/index.js';
import { buildGenerationPrompt } from './prompt-builder.js';

const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

export async function generateText(request: ContentRequest): Promise<GeneratedContent> {
  if (!request.prompt?.trim()) {
    throw new Error('Cannot generate content from an empty prompt');
  }

  return withRetry(async () => {
    const response = await ai.models.generateContent({
      model: env.GEMINI_MODEL,
      contents: buildGenerationPrompt(request),
      config: {
        temperature: 0.8,
        topP: 0.9,
        maxOutputTokens: 2048,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'object' as const,
          properties: {
            text: { type: 'string' as const, description: 'Main post text' },
            hashtags: {
              type: 'array' as const,
              items: { type: 'string' as const },
              description: 'Relevant hashtags',
            },
          },
          required: ['text', 'hashtags'],
        },
      },
    });

    const raw = response.text;
    if (!raw) {
      throw new Error('Empty response from Gemini');
    }

    const parsed = JSON.parse(raw) as { text?: unknown; hashtags?: unknown };
    if (typeof parsed.text !== 'string' || parsed.text.trim().length === 0) {
      throw new Error('Gemini response did not contain any text');
    }

    const hashtags = Array.isArray(parsed.hashtags)
      ? parsed.hashtags.filter((h): h is string => typeof h === 'string' && h.trim().length > 0)
      : [];

    logger.debug('Text generated', { platform: request.platform, length: parsed.text.length });

    return {
      text: parsed.text.trim(),
      hashtags,
      mediaUrls: request.mediaUrls,
      metadata: request.context,
    };
  }, 'generateText');
}
