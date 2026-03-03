import { GoogleGenAI } from '@google/genai';
import { createClient } from 'pexels';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { withRetry } from '../core/retry.js';
import * as fs from 'fs';
import * as path from 'path';

const TEMP_DIR = path.resolve('temp');

const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

function ensureTempDir(): void {
  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  }
}

/**
 * Generate an image using Google Imagen via Gemini API.
 * Primary image generation method — no extra API key needed.
 */
export async function generateImage(prompt: string, _width = 1024, _height = 1024): Promise<string> {
  ensureTempDir();

  return withRetry(async () => {
    // Determine aspect ratio from dimensions
    const ratio = _width / _height;
    let aspectRatio = '1:1';
    if (ratio > 1.3) aspectRatio = '16:9';
    else if (ratio < 0.7) aspectRatio = '9:16';

    const response = await ai.models.generateImages({
      model: 'imagen-4.0-generate-001',
      prompt,
      config: {
        numberOfImages: 1,
        aspectRatio,
        includeRaiReason: true,
      },
    });

    const imageData = response?.generatedImages?.[0]?.image?.imageBytes;
    if (!imageData) {
      const reason = response?.generatedImages?.[0]?.raiFilteredReason;
      throw new Error(reason ? `Image blocked by safety filter: ${reason}` : 'No image data returned from Imagen');
    }

    const filename = `imagen_${Date.now()}.png`;
    const filePath = path.join(TEMP_DIR, filename);
    fs.writeFileSync(filePath, Buffer.from(imageData, 'base64'));

    logger.debug('Image generated via Imagen', { filePath, size: imageData.length });
    return filePath;
  }, 'generateImage');
}

/**
 * Search and download stock photos from Pexels.
 * Used as fallback when AI image generation fails.
 */
export async function searchPexelsImage(query: string, count = 1): Promise<string[]> {
  if (!env.PEXELS_API_KEY) {
    logger.warn('Pexels API key not configured');
    return [];
  }

  const client = createClient(env.PEXELS_API_KEY);

  return withRetry(async () => {
    const result = await client.photos.search({ query, per_page: count, locale: 'tr-TR' });

    if ('error' in result) {
      throw new Error(`Pexels error: ${String(result.error)}`);
    }

    ensureTempDir();
    const filePaths: string[] = [];

    for (const photo of result.photos) {
      const imageUrl = photo.src.large;
      const response = await fetch(imageUrl);
      if (!response.ok) continue;

      const buffer = Buffer.from(await response.arrayBuffer());
      const filename = `pexels_${photo.id}_${Date.now()}.jpg`;
      const filePath = path.join(TEMP_DIR, filename);
      fs.writeFileSync(filePath, buffer);
      filePaths.push(filePath);
    }

    logger.debug('Pexels images downloaded', { query, count: filePaths.length });
    return filePaths;
  }, 'searchPexelsImage');
}
