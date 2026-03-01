import { Communicate } from 'edge-tts-universal';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../config/logger.js';
import { withRetry } from '../core/retry.js';

const TEMP_DIR = path.resolve('temp');

export type TurkishVoice = 'tr-TR-EmelNeural' | 'tr-TR-AhmetNeural';

function ensureTempDir(): void {
  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  }
}

export async function textToSpeech(
  text: string,
  voice: TurkishVoice = 'tr-TR-EmelNeural',
  rate = '+0%',
): Promise<string> {
  ensureTempDir();

  return withRetry(async () => {
    const communicate = new Communicate(text, { voice, rate });

    const filename = `tts_${Date.now()}.mp3`;
    const filePath = path.join(TEMP_DIR, filename);

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
