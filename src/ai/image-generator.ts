import { createClient } from 'pexels';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { withRetry } from '../core/retry.js';
import * as fs from 'fs';
import * as path from 'path';

const POLLINATIONS_BASE = 'https://image.pollinations.ai/prompt';
const TEMP_DIR = path.resolve('temp');

async function ensureTempDir(): Promise<void> {
  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  }
}

export async function generateImage(prompt: string, width = 1024, height = 1024): Promise<string> {
  await ensureTempDir();

  return withRetry(async () => {
    const encodedPrompt = encodeURIComponent(prompt);
    const url = `${POLLINATIONS_BASE}/${encodedPrompt}?width=${width}&height=${height}&nologo=true`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Pollinations API error: ${response.status}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const filename = `pollinations_${Date.now()}.png`;
    const filePath = path.join(TEMP_DIR, filename);
    fs.writeFileSync(filePath, buffer);

    logger.debug('Image generated via Pollinations', { filePath, size: buffer.length });
    return filePath;
  }, 'generateImage');
}

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

    await ensureTempDir();
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
