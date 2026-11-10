import { generateText } from './text-generator.js';
import { generateImage, searchPexelsImage } from './image-generator.js';
import { textToSpeech, voiceForLanguage } from './tts.js';
import { generateVideo } from './video-generator.js';
import { logger } from '../config/logger.js';
import { ContentType } from '../config/constants.js';
import type { ContentRequest, GeneratedContent } from '../types/index.js';
import * as fs from 'fs';
import * as path from 'path';

export interface VideoContentResult extends GeneratedContent {
  videoPath: string;
  audioPath: string;
  imagePath: string;
}

/**
 * End-to-end video content pipeline:
 * 1. Generate text via Gemini
 * 2. Generate TTS audio from text
 * 3. Generate/find background image
 * 4. Assemble video with FFmpeg (image + audio + text overlay)
 * 5. Return GeneratedContent with videoPath as mediaUrl
 */
export async function createVideoContent(request: ContentRequest): Promise<VideoContentResult> {
  logger.info('Video pipeline started', { platform: request.platform });

  // Step 1: Generate text
  const textContent = await generateText(request);
  logger.info('Video pipeline — text generated', { length: textContent.text.length });

  // Intermediate files are removed if any later step fails; on success the caller cleans them up
  let audioPath: string | undefined;
  let imagePath: string | undefined;
  try {
    // Step 2: TTS — convert text to audio (voice from project config, else picked by language)
    const context = request.context as Record<string, unknown> | undefined;
    const configuredVoice = (context?.['projectConfig'] as Record<string, unknown> | undefined)?.['ttsVoice'];
    const voice = typeof configuredVoice === 'string' && configuredVoice
      ? configuredVoice
      : voiceForLanguage(context?.['language'] as string | undefined);
    audioPath = await textToSpeech(textContent.text, voice, '+0%');
    logger.info('Video pipeline — TTS completed', { audioPath });

    // Step 3: Background image — vertical for Shorts/Reels (1080x1920)
    const isVertical = request.contentType === ContentType.SHORT || request.contentType === ContentType.REEL;
    const width = isVertical ? 1080 : 1920;
    const height = isVertical ? 1920 : 1080;
    imagePath = await generateBackgroundImage(request, textContent.text, width, height);

    // Step 4: Assemble video with Ken Burns + subtitles + logo
    // Resolve logo + bgMusic from project config
    let logoPath: string | undefined;
    let bgMusicPath: string | undefined;
    const projectConfig = context?.['projectConfig'] as Record<string, unknown> | undefined;
    if (projectConfig?.logoUrl && typeof projectConfig.logoUrl === 'string') {
      const resolved = path.resolve('public', (projectConfig.logoUrl as string).replace(/^\/public\//, ''));
      if (fs.existsSync(resolved)) logoPath = resolved;
    }
    if (projectConfig?.bgMusicPath && typeof projectConfig.bgMusicPath === 'string') {
      const resolved = path.resolve('public', (projectConfig.bgMusicPath as string).replace(/^\/public\//, ''));
      if (fs.existsSync(resolved)) bgMusicPath = resolved;
    }

    // Build display text for subtitles: replace phonetic spellings back to brand names
    const subtitleReplacements = (projectConfig?.subtitleReplacements ?? {}) as Record<string, string>;
    let subtitleText = textContent.text;
    for (const [from, to] of Object.entries(subtitleReplacements)) {
      subtitleText = subtitleText.replaceAll(from, to);
    }

    // Resolve project name for logo text overlay
    const projectName = context?.['projectName'] as string | undefined;

    const videoPath = await generateVideo({
      imagePath,
      audioPath,
      text: textContent.text,
      subtitleText,
      width,
      height,
      logoPath,
      projectName,
      bgMusicPath,
      bgMusicVolume: (projectConfig?.bgMusicVolume as number) ?? 0.6,
    });

    logger.info('Video pipeline completed', { videoPath });

    return {
      text: textContent.text,
      hashtags: textContent.hashtags,
      mediaUrls: [videoPath],
      metadata: textContent.metadata,
      videoPath,
      audioPath,
      imagePath,
    };
  } catch (err) {
    removeFiles([audioPath, imagePath]);
    throw err;
  }
}

/**
 * Generates an image for the content with Imagen, falling back to a Pexels stock photo.
 * Returns the path of a temp file the caller is responsible for removing.
 */
export async function generateBackgroundImage(
  request: ContentRequest,
  text: string,
  width: number,
  height: number,
): Promise<string> {
  const imagePrompt = buildImagePrompt(request, text);
  try {
    const imagePath = await generateImage(imagePrompt, width, height);
    logger.info('AI image generated', { imagePath });
    return imagePath;
  } catch (err) {
    logger.warn('AI image failed, falling back to Pexels', {
      error: err instanceof Error ? err.message : String(err),
    });

    const pexelsImages = await searchPexelsImage(extractSearchQuery(request), 1);
    if (pexelsImages.length === 0) {
      throw new Error(
        'Could not generate or find an image — Imagen failed (it requires a billing-enabled Gemini key) '
        + 'and no Pexels image was available (set PEXELS_API_KEY)',
      );
    }
    logger.info('Pexels image found', { imagePath: pexelsImages[0] });
    return pexelsImages[0]!;
  }
}

function removeFiles(filePaths: Array<string | undefined>): void {
  for (const filePath of filePaths) {
    if (!filePath) continue;
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {
      // ignore cleanup errors
    }
  }
}

/**
 * Clean up temp files created by the video pipeline.
 */
export function cleanupVideoFiles(result: VideoContentResult): void {
  removeFiles([result.videoPath, result.audioPath, result.imagePath]);
}

const NO_TEXT_INSTRUCTION = 'Do NOT include any text, letters, words, watermarks, or typography in the image.';
const PHOTO_QUALITY = 'shallow depth of field, soft bokeh, studio lighting, professional photography, 8k, ultra detailed';

function buildImagePrompt(request: ContentRequest, text: string): string {
  const context = request.context as Record<string, unknown> | undefined;
  const animalType = context?.['animalType'] as string | undefined;
  const type = context?.['type'] as string | undefined;
  const pConfig = context?.['projectConfig'] as Record<string, unknown> | undefined;

  // Use custom template if provided
  if (pConfig?.imagePromptTemplate && typeof pConfig.imagePromptTemplate === 'string') {
    const template = pConfig.imagePromptTemplate as string;
    const shortText = text.slice(0, 80);
    return template
      .replace(/\{\{text\}\}/g, shortText)
      .replace(/\{\{animalType\}\}/g, animalType ?? '')
      .replace(/\{\{type\}\}/g, type ?? '')
      + `. ${NO_TEXT_INSTRUCTION}`;
  }

  if (animalType) {
    if (type === 'adoption') {
      return `cute ${animalType} looking at camera, warm and inviting, cozy home environment, ${PHOTO_QUALITY}. ${NO_TEXT_INSTRUCTION}`;
    }
    if (type === 'lost') {
      return `${animalType} alone outdoors, searching, emotional, cinematic mood, ${PHOTO_QUALITY}. ${NO_TEXT_INSTRUCTION}`;
    }
    return `adorable ${animalType}, heartwarming, natural light, ${PHOTO_QUALITY}. ${NO_TEXT_INSTRUCTION}`;
  }

  // Generic: extract keywords from text
  const shortText = text.slice(0, 80);
  return `social media visual for: ${shortText}, modern, clean, ${PHOTO_QUALITY}. ${NO_TEXT_INSTRUCTION}`;
}

function extractSearchQuery(request: ContentRequest): string {
  const context = request.context as Record<string, unknown> | undefined;
  const animalType = context?.['animalType'] as string | undefined;

  if (animalType) {
    return `cute ${animalType} pet`;
  }
  return 'social media content';
}
