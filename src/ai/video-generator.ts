import ffmpeg from 'fluent-ffmpeg';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../config/logger.js';

const TEMP_DIR = path.resolve('temp');

function ensureTempDir(): void {
  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  }
}

interface VideoOptions {
  imagePath: string;
  audioPath: string;
  outputFilename?: string;
  textOverlay?: string;
  duration?: number;
  width?: number;
  height?: number;
}

export function generateVideo(options: VideoOptions): Promise<string> {
  ensureTempDir();

  const {
    imagePath,
    audioPath,
    outputFilename = `video_${Date.now()}.mp4`,
    textOverlay,
    width = 1080,
    height = 1920,
  } = options;

  const outputPath = path.join(TEMP_DIR, outputFilename);

  return new Promise((resolve, reject) => {
    let command = ffmpeg()
      .input(imagePath)
      .loop()
      .input(audioPath)
      .outputOptions([
        '-c:v libx264',
        '-tune stillimage',
        '-c:a aac',
        '-b:a 192k',
        '-pix_fmt yuv420p',
        '-shortest',
        `-vf scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black${
          textOverlay
            ? `,drawtext=text='${textOverlay.replace(/'/g, "\\'")}':fontcolor=white:fontsize=36:x=(w-text_w)/2:y=h-100:box=1:boxcolor=black@0.6:boxborderw=10`
            : ''
        }`,
      ]);

    if (options.duration) {
      command = command.duration(options.duration);
    }

    command
      .output(outputPath)
      .on('end', () => {
        logger.debug('Video generated', { outputPath });
        resolve(outputPath);
      })
      .on('error', (err) => {
        logger.error('Video generation failed', { error: err.message });
        reject(err);
      })
      .run();
  });
}
