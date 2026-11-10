import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { ContentType, type Platform } from '../config/constants.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { generateText } from '../ai/text-generator.js';
import { createVideoContent, cleanupVideoFiles, generateBackgroundImage } from '../ai/video-orchestrator.js';
import { checkQuality } from '../ai/quality-checker.js';
import type { ContentRequest, GeneratedContent } from '../types/index.js';
import { PUBLIC_DIR, ensureDir } from './media.js';
import { fitToPlatform } from './safety-guard.js';

const VIDEO_TYPES = new Set<string>([ContentType.VIDEO, ContentType.SHORT, ContentType.REEL]);
const IMAGE_TYPES = new Set<string>([ContentType.IMAGE, ContentType.STORY]);
const VIDEOS_DIR = path.join(PUBLIC_DIR, 'videos');
const IMAGES_DIR = path.join(PUBLIC_DIR, 'images');

export function isVideoContentType(contentType: string): boolean {
  return VIDEO_TYPES.has(contentType);
}

export interface CreatedContent extends GeneratedContent {
  mediaUrls: string[];
  qualityScore: number | null;
  qualityFeedback: string | null;
}

/**
 * Generates content for a request: text only, text plus an image for image/story types,
 * or the full video pipeline for video types. Generated media is moved to `public/` so the
 * dashboard can show it and platform adapters can upload it.
 */
export async function createContent(request: ContentRequest): Promise<CreatedContent> {
  let content: GeneratedContent;

  if (isVideoContentType(request.contentType)) {
    const result = await createVideoContent(request);
    try {
      ensureDir(VIDEOS_DIR);
      const filename = path.basename(result.videoPath);
      fs.copyFileSync(result.videoPath, path.join(VIDEOS_DIR, filename));
      content = {
        text: result.text,
        hashtags: result.hashtags,
        mediaUrls: [`/public/videos/${filename}`],
        metadata: result.metadata,
      };
    } finally {
      cleanupVideoFiles(result);
    }
  } else {
    content = await generateText(request);
    if (IMAGE_TYPES.has(request.contentType) && !request.mediaUrls?.length) {
      content = { ...content, mediaUrls: [await createImage(request, content.text)] };
    }
  }

  content = fitToPlatform(content, request.platform as Platform);

  let qualityScore: number | null = null;
  let qualityFeedback: string | null = null;
  if (env.QUALITY_CHECK_ENABLED) {
    try {
      const quality = await checkQuality(content.text, request.platform as Platform);
      qualityScore = quality.score;
      qualityFeedback = quality.feedback;
    } catch (err) {
      logger.warn('Quality check failed, continuing without a score', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    ...content,
    mediaUrls: content.mediaUrls ?? [],
    qualityScore,
    qualityFeedback,
  };
}

/** Generates an image for the post and moves it to `public/images`, returning its public URL */
async function createImage(request: ContentRequest, text: string): Promise<string> {
  // Stories are vertical; feed images are square (accepted by every platform)
  const vertical = request.contentType === ContentType.STORY;
  const tempPath = await generateBackgroundImage(request, text, 1080, vertical ? 1920 : 1080);
  try {
    ensureDir(IMAGES_DIR);
    const filename = `${randomUUID()}${path.extname(tempPath) || '.png'}`;
    fs.copyFileSync(tempPath, path.join(IMAGES_DIR, filename));
    return `/public/images/${filename}`;
  } finally {
    try { fs.unlinkSync(tempPath); } catch { /* already gone */ }
  }
}

/** True when quality checks are enabled and the content scored below the configured minimum */
export function failsQualityGate(content: Pick<CreatedContent, 'qualityScore'>): boolean {
  return content.qualityScore !== null && content.qualityScore < env.QUALITY_MIN_SCORE;
}
