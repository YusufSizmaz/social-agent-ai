import * as fs from 'fs';
import * as path from 'path';
import { ContentType, type Platform } from '../config/constants.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { generateText } from '../ai/text-generator.js';
import { createVideoContent, cleanupVideoFiles } from '../ai/video-orchestrator.js';
import { checkQuality } from '../ai/quality-checker.js';
import type { ContentRequest, GeneratedContent } from '../types/index.js';
import { PUBLIC_DIR, ensureDir } from './media.js';
import { fitToPlatform } from './safety-guard.js';

const VIDEO_TYPES = new Set<string>([ContentType.VIDEO, ContentType.SHORT, ContentType.REEL]);
const VIDEOS_DIR = path.join(PUBLIC_DIR, 'videos');

export function isVideoContentType(contentType: string): boolean {
  return VIDEO_TYPES.has(contentType);
}

export interface CreatedContent extends GeneratedContent {
  mediaUrls: string[];
  qualityScore: number | null;
  qualityFeedback: string | null;
}

/**
 * Generates content for a request: text only, or the full video pipeline for video types.
 * Generated videos are moved to `public/videos` so the dashboard can play them and
 * platform adapters can upload them.
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

/** True when quality checks are enabled and the content scored below the configured minimum */
export function failsQualityGate(content: Pick<CreatedContent, 'qualityScore'>): boolean {
  return content.qualityScore !== null && content.qualityScore < env.QUALITY_MIN_SCORE;
}
