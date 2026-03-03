/**
 * Video Pipeline Test — Real CatPet Project
 *
 * Fetches CatPet project config from DB and runs the full video pipeline.
 * Run: npx tsx src/test-video.ts
 */
import { createVideoContent } from './ai/video-orchestrator.js';
import { ContentType, Platform, Tone } from './config/constants.js';
import { db, schema } from './db/index.js';
import { eq } from 'drizzle-orm';
import type { ContentRequest } from './types/index.js';

async function main() {
  console.log('=== VIDEO PIPELINE TEST (Real CatPet) ===\n');

  // Fetch CatPet project from DB
  const [project] = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.name, 'CatPet'))
    .limit(1);

  if (!project) {
    console.error('CatPet projesi bulunamadi! Panelden olusturun.');
    process.exit(1);
  }

  const config = (project.config ?? {}) as Record<string, unknown>;
  console.log(`Project: ${project.name} (${project.id})`);
  console.log(`Tone: ${config.defaultTone}`);
  console.log(`Content Type: ${config.defaultContentType}`);
  console.log(`Logo: ${config.logoUrl || 'yok'}`);
  console.log(`Image Prompt Template: ${config.imagePromptTemplate ? 'var' : 'yok'}`);
  console.log('');

  const toneMap: Record<string, Tone> = {
    emotional: Tone.EMOTIONAL,
    informative: Tone.INFORMATIVE,
    urgent: Tone.URGENT,
    hopeful: Tone.HOPEFUL,
    friendly: Tone.FRIENDLY,
  };

  const contentTypeMap: Record<string, ContentType> = {
    short: ContentType.SHORT,
    reel: ContentType.REEL,
    video: ContentType.VIDEO,
    text: ContentType.TEXT,
    image: ContentType.IMAGE,
    story: ContentType.STORY,
  };

  const tone = toneMap[config.defaultTone as string] ?? Tone.EMOTIONAL;
  const contentType = contentTypeMap[config.defaultContentType as string] ?? ContentType.SHORT;
  const prompt = (config.promptTemplate as string) || 'Hayvan sahiplendirme icin duygusal bir icerik olustur.';

  const request: ContentRequest = {
    projectId: project.id,
    platform: Platform.YOUTUBE,
    contentType,
    tone,
    prompt,
    context: {
      type: 'adoption',
      animalType: 'kedi',
      projectConfig: config,
      projectName: project.name,
    },
  };

  console.log('1. Generating content + TTS + image + video...\n');

  const startTime = Date.now();
  const result = await createVideoContent(request);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\n=== RESULT (${elapsed}s) ===`);
  console.log(`\nText:\n${result.text}`);
  console.log(`\nHashtags: ${result.hashtags.join(' ')}`);
  console.log(`\nFiles:`);
  console.log(`  Audio: ${result.audioPath}`);
  console.log(`  Image: ${result.imagePath}`);
  console.log(`  Video: ${result.videoPath}`);
  console.log(`\nVideo ready at: ${result.videoPath}`);
  console.log('\nOpen it with: open ' + result.videoPath);

  process.exit(0);
}

main().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
