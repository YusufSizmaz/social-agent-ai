import { Communicate } from 'edge-tts-universal';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { logger } from '../config/logger.js';
import { withRetry } from '../core/retry.js';
import { TEMP_DIR, ensureDir } from '../core/media.js';

/** Default Edge TTS neural voice per language — override with `ttsVoice` in project config */
const VOICES: Record<string, string> = {
  tr: 'tr-TR-EmelNeural',
  en: 'en-US-AriaNeural',
  de: 'de-DE-KatjaNeural',
  es: 'es-ES-ElviraNeural',
  fr: 'fr-FR-DeniseNeural',
  it: 'it-IT-ElsaNeural',
  pt: 'pt-BR-FranciscaNeural',
  ar: 'ar-SA-ZariyahNeural',
};

export const DEFAULT_VOICE = VOICES['tr']!;

export function voiceForLanguage(language: string | undefined): string {
  if (!language) return DEFAULT_VOICE;
  return VOICES[language.toLowerCase()] ?? DEFAULT_VOICE;
}

export async function textToSpeech(
  text: string,
  voice: string = DEFAULT_VOICE,
  rate = '+0%',
): Promise<string> {
  ensureDir(TEMP_DIR);

  return withRetry(async () => {
    const communicate = new Communicate(text, { voice, rate });

    const filePath = path.join(TEMP_DIR, `tts_${randomUUID()}.mp3`);

    const chunks: Buffer[] = [];
    for await (const chunk of communicate.stream()) {
      if (chunk.type === 'audio' && chunk.data) {
        chunks.push(chunk.data);
      }
    }

    if (chunks.length === 0) {
      throw new Error('No audio data received from TTS');
    }

    const audioBuffer = Buffer.concat(chunks);
    fs.writeFileSync(filePath, audioBuffer);

    logger.debug('TTS audio generated', { voice, filePath, size: audioBuffer.length });
    return filePath;
  }, 'textToSpeech');
}
