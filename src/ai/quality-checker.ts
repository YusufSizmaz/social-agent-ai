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
      model: 'gemini-2.5-flash',
      contents: `Sen bir Turkce sosyal medya icerik kalite degerlendirmecisisin.
Asagidaki ${platform} icin yazilmis icerigi degerlendir.

Icerik:
"""
${text}
"""

Puanlama kriterleri:
- Dil bilgisi ve yazim (0-25)
- Ilgi cekicilik ve etkilesim potansiyeli (0-25)
- Platforma uygunluk (0-25)
- Mesaj netligi ve tutarliligi (0-25)

Toplam puani (0-100) ve kisa bir geri bildirim ver.
SADECE JSON formatinda cevap ver, baska hicbir sey yazma: {"score": <sayi>, "feedback": "<metin>"}`,
      config: {
        temperature: 0.3,
        maxOutputTokens: 512,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    const raw = response.text;
    if (!raw) {
      throw new Error('Empty response from Gemini quality check');
    }

    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = raw.match(/\{[\s\S]*"score"[\s\S]*"feedback"[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error(`Could not parse quality check response: ${raw.slice(0, 200)}`);
    }

    const result = JSON.parse(jsonMatch[0]) as QualityResult;

    logger.debug('Quality check completed', { platform, score: result.score });

    return result;
  }, 'checkQuality');
}
