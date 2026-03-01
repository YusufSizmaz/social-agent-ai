import { GoogleGenAI } from '@google/genai';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { withRetry } from '../core/retry.js';
import type { ContentRequest, GeneratedContent } from '../types/index.js';

const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

export async function generateText(request: ContentRequest): Promise<GeneratedContent> {
  return withRetry(async () => {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: request.prompt,
      config: {
        temperature: 0.8,
        topP: 0.9,
        maxOutputTokens: 1024,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'object' as const,
          properties: {
            text: { type: 'string' as const, description: 'Ana metin icerigi' },
            hashtags: {
              type: 'array' as const,
              items: { type: 'string' as const },
              description: 'Ilgili hashtagler',
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

    const parsed = JSON.parse(raw) as { text: string; hashtags: string[] };

    logger.debug('Text generated', { platform: request.platform, length: parsed.text.length });

    return {
      text: parsed.text,
      hashtags: parsed.hashtags,
      mediaUrls: request.mediaUrls,
      metadata: request.context,
    };
  }, 'generateText');
}
