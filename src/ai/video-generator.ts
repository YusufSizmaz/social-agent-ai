import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../config/logger.js';
import ffmpegLib from 'fluent-ffmpeg';

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
  /** Text used for TTS (may contain phonetic spellings like "Ket Pet") */
  text?: string;
  /** Text shown in subtitles (display version). Falls back to text if not provided. */
  subtitleText?: string;
  duration?: number;
  width?: number;
  height?: number;
  logoPath?: string;
  /** Project name displayed below the logo */
  projectName?: string;
  bgMusicPath?: string;
  /** Background music volume (0.0–1.0). Default: 0.6 */
  bgMusicVolume?: number;
}

/**
 * Get audio duration using ffprobe.
 */
function getAudioDuration(audioPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpegLib.ffprobe(audioPath, (err, metadata) => {
      if (err) return reject(err);
      resolve(metadata.format.duration ?? 30);
    });
  });
}

/**
 * Generate an ASS subtitle file with embedded styles.
 * ASS format bakes the style into the file itself, avoiding
 * FFmpeg force_style escaping issues.
 */
function generateASS(text: string, totalDuration: number, outputPath: string, width: number, height: number): void {
  const sentences = text.match(/[^.!?]+[.!?]*/g) ?? [text];
  const chunks: string[] = [];

  for (const sentence of sentences) {
    const words = sentence.trim().split(/\s+/);
    if (words.length <= 10) {
      chunks.push(sentence.trim());
    } else {
      for (let i = 0; i < words.length; i += 8) {
        chunks.push(words.slice(i, i + 8).join(' '));
      }
    }
  }

  // Duration proportional to word count for natural pacing
  const totalWords = chunks.reduce((sum, c) => sum + c.split(/\s+/).length, 0);
  const secPerWord = totalDuration / totalWords;
  const marginV = Math.round(height * 0.12);
  const fontSize = Math.round(width * 0.058);

  let ass = `[Script Info]
Title: Subtitles
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial Black,${fontSize},&H00FFFFFF,&H000000FF,&H00000000,&HC0000000,-1,0,0,0,100,100,0,0,3,3,1,2,40,40,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  let cursor = 0;
  for (let i = 0; i < chunks.length; i++) {
    const wordCount = chunks[i]!.split(/\s+/).length;
    const dur = wordCount * secPerWord;
    const start = cursor;
    const end = cursor + dur;
    cursor = end;
    ass += `Dialogue: 0,${assTime(start)},${assTime(end)},Default,,0,0,0,,${chunks[i]!}\n`;
  }

  fs.writeFileSync(outputPath, ass, 'utf-8');
}

function assTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const cs = Math.floor((sec % 1) * 100);
  return `${h}:${p2(m)}:${p2(s)}.${p2(cs)}`;
}

function p2(n: number): string { return n.toString().padStart(2, '0'); }

/**
 * Run ffmpeg as a child process with explicit args array.
 * This avoids all shell escaping issues from fluent-ffmpeg.
 */
function runFFmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', args, { maxBuffer: 50 * 1024 * 1024 }, (error, _stdout, stderr) => {
      if (error) {
        logger.error('FFmpeg stderr', { stderr: stderr.slice(-500) });
        reject(new Error(`ffmpeg failed: ${stderr.slice(-200)}`));
      } else {
        resolve();
      }
    });
  });
}

export async function generateVideo(options: VideoOptions): Promise<string> {
  ensureTempDir();

  const {
    imagePath,
    audioPath,
    outputFilename = `video_${Date.now()}.mp4`,
    text,
    width = 1080,
    height = 1920,
  } = options;

  const outputPath = path.join(TEMP_DIR, outputFilename);
  const audioDuration = await getAudioDuration(audioPath);
  const totalDuration = options.duration ?? audioDuration + 1;

  const fps = 30;
  const totalFrames = Math.ceil(totalDuration * fps);
  const maxZoom = 1.15;
  const zoomSpeed = (maxZoom - 1.0) / totalFrames;

  // Ken Burns zoom filter — 4x scale for sub-pixel headroom, deterministic frame-based zoom
  const kenBurns =
    `loop=loop=-1:size=1:start=0,` +
    `scale=${width * 4}:${height * 4},` +
    `zoompan=z='min(1.0+${zoomSpeed}*on,${maxZoom})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${totalFrames}:s=${width}x${height}:fps=${fps},` +
    `setsar=1,trim=duration=${totalDuration},setpts=PTS-STARTPTS,format=yuv420p`;

  // Mix background music with TTS if provided
  const hasBgMusic = !!(options.bgMusicPath && fs.existsSync(options.bgMusicPath));
  let finalAudioPath = audioPath;

  if (hasBgMusic) {
    const bgVol = options.bgMusicVolume ?? 0.6;
    finalAudioPath = path.join(TEMP_DIR, `mix_${Date.now()}.m4a`);
    logger.debug('Mixing background music', { bgMusicPath: options.bgMusicPath, volume: bgVol });

    const fadeOutStart = Math.max(0, audioDuration - 2);
    await runFFmpeg([
      '-y',
      '-i', audioPath,
      '-stream_loop', '-1', '-i', options.bgMusicPath!,
      '-filter_complex',
      `[0:a]aformat=sample_rates=44100:channel_layouts=stereo,volume=1.0[voice];` +
      `[1:a]aformat=sample_rates=44100:channel_layouts=stereo,volume=${bgVol},afade=t=out:st=${fadeOutStart}:d=2[music];` +
      `[voice][music]amix=inputs=2:duration=first:dropout_transition=2[out]`,
      '-map', '[out]',
      '-c:a', 'aac', '-b:a', '192k',
      '-t', String(audioDuration),
      finalAudioPath,
    ]);
  }

  // Step 1: Ken Burns + audio → MP4
  const displayText = options.subtitleText || text;
  const hasSubtitles = !!(displayText && displayText.length > 0);
  const hasLogo = !!(options.logoPath && fs.existsSync(options.logoPath));
  const needsStep2 = hasSubtitles || hasLogo;
  const step1Output = needsStep2 ? path.join(TEMP_DIR, `kb_${Date.now()}.mp4`) : outputPath;

  logger.debug('FFmpeg step 1: Ken Burns', { duration: totalDuration, frames: totalFrames });

  await runFFmpeg([
    '-y',
    '-loop', '1', '-i', imagePath,
    '-i', finalAudioPath,
    '-vf', kenBurns,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '23',
    '-c:a', 'aac', '-b:a', '192k',
    '-shortest',
    '-movflags', '+faststart',
    step1Output,
  ]);

  // Step 2: Burn subtitles + logo overlay via filter_complex
  if (needsStep2) {
    const tempFiles: string[] = [step1Output];
    const inputs = ['-i', step1Output];

    let filterComplex = '';
    let lastLabel = '0:v';

    // Subtitles (use displayText for correct on-screen text)
    if (hasSubtitles) {
      const assPath = path.join(TEMP_DIR, `subs_${Date.now()}.ass`);
      generateASS(displayText!, audioDuration, assPath, width, height);
      tempFiles.push(assPath);
      const escapedAss = assPath.replace(/\\/g, '/').replace(/:/g, '\\:');
      filterComplex += `[${lastLabel}]ass=${escapedAss}[sub];`;
      lastLabel = 'sub';
    }

    // Logo overlay + project name
    if (hasLogo) {
      inputs.push('-i', options.logoPath!);
      const logoInputIdx = 1;
      const logoSize = Math.round(width * 0.18);
      const logoPad = Math.round(width * 0.03);
      filterComplex += `[${logoInputIdx}:v]scale=${logoSize}:-1[logo];[${lastLabel}][logo]overlay=${logoPad}:${logoPad}[withlogo]`;

      if (options.projectName) {
        const nameSize = Math.round(width * 0.028);
        const nameY = logoPad + logoSize + Math.round(width * 0.012);
        const nameCenterX = logoPad + Math.round(logoSize / 2);
        const escapedName = options.projectName.replace(/'/g, "'\\''").replace(/:/g, '\\:');
        filterComplex += `;[withlogo]drawtext=text='${escapedName}':fontfile=/System/Library/Fonts/Helvetica.ttc:fontsize=${nameSize}:fontcolor=white:x=${nameCenterX}-text_w/2:y=${nameY}:shadowcolor=black@0.6:shadowx=1:shadowy=1[out]`;
      } else {
        filterComplex = filterComplex.replace(/\[withlogo\]$/, '[out]');
      }
      lastLabel = 'out';
    }

    // If no logo, rename last label to out
    if (!hasLogo && filterComplex.endsWith(';')) {
      filterComplex = filterComplex.slice(0, -1).replace(/\[sub\]$/, '[out]');
      lastLabel = 'out';
    }

    logger.debug('FFmpeg step 2: Subtitles + Logo', { hasSubtitles, hasLogo });

    await runFFmpeg([
      '-y',
      ...inputs,
      '-filter_complex', filterComplex,
      '-map', `[${lastLabel}]`,
      '-map', '0:a',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '23',
      '-c:a', 'copy',
      '-movflags', '+faststart',
      outputPath,
    ]);

    // Cleanup temp files
    for (const f of tempFiles) {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
  }

  // Cleanup mixed audio
  if (hasBgMusic && fs.existsSync(finalAudioPath)) fs.unlinkSync(finalAudioPath);

  logger.debug('Video generated', { outputPath, duration: totalDuration, subtitles: hasSubtitles, logo: hasLogo, bgMusic: hasBgMusic });
  return outputPath;
}
