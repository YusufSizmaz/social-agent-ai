import { generateText } from './text-generator.js';
import { generateImage, searchPexelsImage } from './image-generator.js';
import { textToSpeech } from './tts.js';
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

  // Step 2: TTS — convert text to audio
  const audioPath = await textToSpeech(textContent.text, 'tr-TR-EmelNeural', '+0%');
  logger.info('Video pipeline — TTS completed', { audioPath });

  // Step 3: Background image
  let imagePath: string;

  // Try AI image first, then Pexels fallback
  const imagePrompt = buildImagePrompt(request, textContent.text);
  try {
    // For YouTube Shorts: 1080x1920 (vertical)
    const isVertical = request.contentType === ContentType.SHORT || request.contentType === ContentType.REEL;
    const width = isVertical ? 1080 : 1920;
    const height = isVertical ? 1920 : 1080;

    imagePath = await generateImage(imagePrompt, width, height);
    logger.info('Video pipeline — AI image generated', { imagePath });
  } catch (err) {
    logger.warn('AI image failed, falling back to Pexels', {
      error: err instanceof Error ? err.message : String(err),
    });

    const searchQuery = extractSearchQuery(request);
    const pexelsImages = await searchPexelsImage(searchQuery, 1);
    if (pexelsImages.length === 0) {
      throw new Error('Could not generate or find a background image for video');
    }
    imagePath = pexelsImages[0]!;
    logger.info('Video pipeline — Pexels image found', { imagePath });
  }

  // Step 4: Assemble video with Ken Burns + subtitles + logo
  const isVertical = request.contentType === ContentType.SHORT || request.contentType === ContentType.REEL;

  // Resolve logo + bgMusic from project config
  let logoPath: string | undefined;
  let bgMusicPath: string | undefined;
  const projectConfig = (request.context as Record<string, unknown> | undefined)?.['projectConfig'] as Record<string, unknown> | undefined;
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
  const projectName = (request.context as Record<string, unknown> | undefined)?.['projectName'] as string | undefined;

  const videoPath = await generateVideo({
    imagePath,
    audioPath,
    text: textContent.text,
    subtitleText,
    width: isVertical ? 1080 : 1920,
    height: isVertical ? 1920 : 1080,
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
}

/**
 * Clean up temp files created by the video pipeline.
 */
export function cleanupVideoFiles(result: VideoContentResult): void {
  for (const filePath of [result.videoPath, result.audioPath, result.imagePath]) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch {
      // ignore cleanup errors
    }
  }
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
