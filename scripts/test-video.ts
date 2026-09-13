/**
 * Runs the full video pipeline (Gemini → TTS → image → FFmpeg) for a project without publishing.
 *
 * Run: npx tsx scripts/test-video.ts "<project name>" [short|reel|video]
 */
import { eq } from 'drizzle-orm';
import { createVideoContent } from '../src/ai/video-orchestrator.js';
import { ContentType, Platform, Tone } from '../src/config/constants.js';
import { closeDb, db, schema } from '../src/db/index.js';
import type { ContentRequest } from '../src/types/index.js';

async function main() {
  const projectName = process.argv[2];
  const contentType = (process.argv[3] as ContentType | undefined) ?? ContentType.SHORT;

  if (!projectName) {
    console.error('Usage: npx tsx scripts/test-video.ts "<project name>" [short|reel|video]');
    process.exit(1);
  }

  const [project] = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.name, projectName))
    .limit(1);

  if (!project) {
    console.error(`Project "${projectName}" not found. Create it in the dashboard first.`);
    process.exit(1);
  }

  const config = (project.config ?? {}) as Record<string, unknown>;
  const tone = Object.values(Tone).includes(config['defaultTone'] as Tone)
    ? (config['defaultTone'] as Tone)
    : Tone.FRIENDLY;
  const prompt = (config['promptTemplate'] as string) || `Create an engaging short video script about ${project.name}.`;

  const request: ContentRequest = {
    projectId: project.id,
    platform: Platform.YOUTUBE,
    contentType,
    tone,
    prompt,
    context: {
      projectConfig: config,
      projectName: project.name,
      language: config['language'],
    },
  };

  console.log(`Generating ${contentType} video for "${project.name}"...\n`);

  const startTime = Date.now();
  const result = await createVideoContent(request);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\n=== RESULT (${elapsed}s) ===`);
  console.log(`\nText:\n${result.text}`);
  console.log(`\nHashtags: ${result.hashtags.join(' ')}`);
  console.log(`\nVideo: ${result.videoPath}`);

  await closeDb();
}

main().catch(async (err) => {
  console.error('FAILED:', err);
  await closeDb();
  process.exit(1);
});
