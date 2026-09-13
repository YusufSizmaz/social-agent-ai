/**
 * Seeds a demo project and account so you can explore the dashboard without any
 * social media credentials. Safe to run multiple times.
 *
 * Run: npm run db:seed
 */
import { eq } from 'drizzle-orm';
import { ContentType, Tone } from '../src/config/constants.js';
import { closeDb, db, schema } from '../src/db/index.js';
import { errorMessage, isConnectionRefused } from '../src/core/errors.js';

const DEMO_PROJECT = 'Demo Coffee Shop';

async function seed() {
  let [project] = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.name, DEMO_PROJECT))
    .limit(1);

  if (project) {
    console.log(`Demo project already exists (${project.id}) — nothing to do.`);
    return;
  }

  [project] = await db
    .insert(schema.projects)
    .values({
      name: DEMO_PROJECT,
      description: 'A sample project showing how brands, accounts and strategies fit together',
      config: {
        defaultTone: 'friendly',
        defaultContentType: 'text',
        platforms: ['twitter'],
        language: 'en',
        promptTemplate: 'Write a cozy, inviting post for a neighborhood coffee shop. Mention a seasonal drink or a small daily moment.',
      },
    })
    .returning();

  const [account] = await db
    .insert(schema.accounts)
    .values({
      projectId: project!.id,
      platform: 'twitter',
      role: 'primary',
      username: 'demo_coffee',
      credentials: {},
      strategy: {
        // Inactive until you add real credentials — then flip it on from the dashboard
        active: false,
        tone: Tone.FRIENDLY,
        contentTypes: [ContentType.TEXT],
        promptTemplate: 'Write a short post for a neighborhood coffee shop about today\'s special.',
        cronExpression: '0 9,15 * * *',
        contentMix: { original: 100, repost: 0, reply: 0 },
        hashtags: ['#coffee'],
        language: 'en',
      },
    })
    .returning();

  await db.insert(schema.posts).values({
    projectId: project!.id,
    accountId: account!.id,
    platform: 'twitter',
    contentType: 'text',
    text: 'Pumpkin spice is back and the first batch of cinnamon rolls just came out of the oven. Come say hi! ☕',
    hashtags: ['#coffee', '#autumn'],
    status: 'review',
    tone: 'friendly',
    metadata: { source: 'seed' },
  });

  console.log(`Seeded project "${DEMO_PROJECT}" with a demo Twitter account and one post awaiting review.`);
}

seed()
  .then(() => closeDb())
  .catch(async (err) => {
    console.error('Seed failed:', errorMessage(err));
    if (isConnectionRefused(err)) {
      console.error('Is PostgreSQL running? Start one with `docker compose up -d db`, or check DATABASE_URL in .env');
    }
    await closeDb();
    process.exit(1);
  });
