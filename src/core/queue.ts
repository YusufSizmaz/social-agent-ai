import { eq, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { JobStatus, RETRY_CONFIG, type JobType } from '../config/constants.js';
import { logger } from '../config/logger.js';

export interface Job {
  id: string;
  type: JobType;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
}

/** A job stuck in "processing" longer than this is assumed to belong to a crashed worker */
const STALE_JOB_MINUTES = 30;

/** `db` or a transaction handle, so a job can be queued atomically with the row it refers to */
type Executor = Pick<typeof db, 'insert'>;

export async function enqueueJob(
  type: JobType,
  payload: Record<string, unknown>,
  options?: { priority?: number; scheduledAt?: Date; maxAttempts?: number; tx?: Executor },
): Promise<string> {
  const [job] = await (options?.tx ?? db)
    .insert(schema.jobQueue)
    .values({
      type,
      payload,
      priority: options?.priority ?? 0,
      scheduledAt: options?.scheduledAt,
      maxAttempts: options?.maxAttempts ?? 3,
    })
    .returning({ id: schema.jobQueue.id });

  logger.debug(`Job enqueued: ${type}`, { jobId: job!.id });
  return job!.id;
}

export async function dequeueJob(): Promise<Job | null> {
  const rows = await db.execute<{
    id: string;
    type: JobType;
    payload: Record<string, unknown>;
    attempts: number;
    max_attempts: number;
  }>(sql`
    UPDATE job_queue
    SET status = 'processing', started_at = NOW(), attempts = attempts + 1
    WHERE id = (
      SELECT id FROM job_queue
      WHERE status IN ('pending', 'retrying')
        AND (scheduled_at IS NULL OR scheduled_at <= NOW())
      ORDER BY priority DESC, created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, type, payload, attempts, max_attempts
  `);

  const row = rows[0];
  if (!row) return null;

  return {
    id: row.id,
    type: row.type,
    payload: row.payload,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
  };
}

export async function completeJob(jobId: string, result?: Record<string, unknown>): Promise<void> {
  await db
    .update(schema.jobQueue)
    .set({
      status: JobStatus.COMPLETED,
      result: result ?? {},
      completedAt: new Date(),
    })
    .where(eq(schema.jobQueue.id, jobId));
}

/** Delay before the next attempt: exponential in the attempt number, capped at 30 minutes */
export function retryDelayMs(attempt: number): number {
  return Math.min(RETRY_CONFIG.baseDelayMs * 30 * Math.pow(2, Math.max(0, attempt - 1)), 30 * 60 * 1000);
}

export async function failJob(
  jobId: string,
  error: string,
  canRetry: boolean,
  attempt = 1,
  minDelayMs = 0,
): Promise<void> {
  await db
    .update(schema.jobQueue)
    .set({
      status: canRetry ? JobStatus.RETRYING : JobStatus.FAILED,
      errorMessage: error,
      scheduledAt: canRetry ? new Date(Date.now() + Math.max(retryDelayMs(attempt), minDelayMs)) : undefined,
      completedAt: canRetry ? undefined : new Date(),
    })
    .where(eq(schema.jobQueue.id, jobId));
}

/**
 * Puts a job back in the queue to run at `runAt` without spending one of its attempts
 * (used when an account has hit its hourly/daily publishing limit).
 */
export async function deferJob(jobId: string, runAt: Date, reason: string): Promise<void> {
  await db
    .update(schema.jobQueue)
    .set({
      status: JobStatus.RETRYING,
      attempts: sql`GREATEST(${schema.jobQueue.attempts} - 1, 0)`,
      scheduledAt: runAt,
      errorMessage: reason,
    })
    .where(eq(schema.jobQueue.id, jobId));
}

/**
 * Re-queues jobs left in "processing" by a process that crashed or was killed.
 * Publish jobs that are out of attempts also fail their post, so it can be retried from the dashboard
 * instead of staying in "publishing" forever.
 */
export async function recoverStaleJobs(olderThanMinutes = STALE_JOB_MINUTES): Promise<number> {
  const rows = await db.execute<{ id: string }>(sql`
    WITH recovered AS (
      UPDATE job_queue
      SET status = CASE WHEN attempts < max_attempts THEN 'retrying'::job_status ELSE 'failed'::job_status END,
          completed_at = CASE WHEN attempts < max_attempts THEN NULL ELSE NOW() END,
          error_message = COALESCE(error_message, 'Recovered after worker interruption')
      WHERE status = 'processing'
        AND started_at < NOW() - make_interval(mins => ${olderThanMinutes})
      RETURNING id, type, status, payload
    ), orphaned_posts AS (
      UPDATE posts
      SET status = 'failed',
          error_message = 'Publishing was interrupted (the worker stopped). Retry from the dashboard.',
          updated_at = NOW()
      WHERE status = 'publishing'
        AND id::text IN (
          SELECT payload->>'postId' FROM recovered
          WHERE type = 'publish_post' AND status = 'failed'
        )
    )
    SELECT id FROM recovered
  `);

  if (rows.length > 0) {
    logger.warn(`Recovered ${rows.length} stale job(s)`);
  }
  return rows.length;
}
