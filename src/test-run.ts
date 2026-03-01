import { logger } from './config/logger.js';
import { db, schema } from './db/index.js';
import { generateText } from './ai/text-generator.js';
import { checkQuality } from './ai/quality-checker.js';
import { checkContentSafety } from './core/safety-guard.js';
import { enqueueJob, dequeueJob, completeJob } from './core/queue.js';
import { Platform, ContentType, Tone, JobType } from './config/constants.js';
import { startServer } from './server/index.js';
import type { ContentRequest } from './types/index.js';

async function testRun(): Promise<void> {
  logger.info('=== TEST BASLIYOR ===');

  // 1. Proje olustur
  logger.info('1. Proje olusturuluyor...');
  const [project] = await db
    .insert(schema.projects)
    .values({ name: 'catpet-test', description: 'Catpet test projesi' })
    .returning();
  logger.info(`Proje olusturuldu: ${project!.id}`);

  // 2. Hesap olustur (mock)
  logger.info('2. Test hesabi olusturuluyor...');
  const [account] = await db
    .insert(schema.accounts)
    .values({
      projectId: project!.id,
      platform: 'twitter',
      username: 'test_catpet',
      credentials: { note: 'test account' },
    })
    .returning();
  logger.info(`Hesap olusturuldu: ${account!.id}`);

  // 3. Gemini ile icerik uret
  logger.info('3. AI ile icerik uretiliyor...');
  const request: ContentRequest = {
    projectId: project!.id,
    platform: Platform.TWITTER,
    contentType: ContentType.TEXT,
    tone: Tone.EMOTIONAL,
    prompt: `Sen Turkiye'de hayvan haklari ve sahiplendirme konusunda uzman bir sosyal medya icerik ureticisisin.
Turkce yaz. Samimi ve duygusal bir dil kullan.
Platform: twitter (max 280 karakter)

Asagidaki hayvan icin sahiplendirme ilani olustur:
- Hayvan turu: Kedi
- Ismi: Pamuk
- Cinsi: Tekir
- Yasi: 2 yasinda
- Konum: Istanbul, Kadikoy
- Aciklama: Cok sevecen, cocuklarla arasi iyi, kucaga gelmeyi seviyor

Uygun hashtagler ekle.`,
  };

  const content = await generateText(request);
  logger.info(`Uretilen icerik: "${content.text}"`);
  logger.info(`Hashtagler: ${content.hashtags.join(', ')}`);

  // 4. Kalite kontrolu
  logger.info('4. Kalite kontrolu yapiliyor...');
  const quality = await checkQuality(content.text, Platform.TWITTER);
  logger.info(`Kalite skoru: ${quality.score}/100 - ${quality.feedback}`);

  // 5. Guvenlik kontrolu
  logger.info('5. Guvenlik kontrolu yapiliyor...');
  const safety = checkContentSafety(content, Platform.TWITTER);
  logger.info(`Guvenlik: ${safety.safe ? 'GECTI' : 'KALDI'} (skor: ${safety.score})`);
  if (safety.reasons.length > 0) {
    logger.info(`Guvenlik notlari: ${safety.reasons.join(', ')}`);
  }

  // 6. Post'u DB'ye kaydet
  logger.info('6. Post DB ye kaydediliyor...');
  const [post] = await db
    .insert(schema.posts)
    .values({
      projectId: project!.id,
      accountId: account!.id,
      platform: 'twitter',
      contentType: 'text',
      text: content.text,
      hashtags: content.hashtags,
      tone: 'emotional',
      status: 'review',
      safetyScore: safety.score,
      qualityScore: quality.score,
    })
    .returning();
  logger.info(`Post kaydedildi: ${post!.id}`);

  // 7. Job queue testi
  logger.info('7. Job queue test ediliyor...');
  const jobId = await enqueueJob(JobType.PUBLISH_POST, {
    postId: post!.id,
    platform: 'twitter',
  });
  logger.info(`Job olusturuldu: ${jobId}`);

  const job = await dequeueJob();
  if (job) {
    logger.info(`Job alindi: ${job.id} (${job.type})`);
    await completeJob(job.id, { status: 'test_completed' });
    logger.info('Job tamamlandi');
  }

  // 8. DB'deki verileri kontrol et
  logger.info('8. DB kontrol ediliyor...');
  const posts = await db.select().from(schema.posts);
  const jobs = await db.select().from(schema.jobQueue);
  logger.info(`DB durumu: ${posts.length} post, ${jobs.length} job`);

  // 9. Web UI'i baslat
  logger.info('9. Web UI baslatiliyor...');
  startServer();

  logger.info('=== TEST TAMAMLANDI ===');
  logger.info('Dashboard: http://localhost:3000');
  logger.info('Durdurmak icin Ctrl+C');
}

testRun().catch((err) => {
  logger.error('Test hatasi', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
