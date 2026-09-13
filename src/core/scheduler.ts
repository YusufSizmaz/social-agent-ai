import cron, { type ScheduledTask } from 'node-cron';
import { logger } from '../config/logger.js';

interface ScheduledJob {
  name: string;
  expression: string;
  task: ScheduledTask;
}

const jobs = new Map<string, ScheduledJob>();
let started = false;

export function isValidCron(expression: string): boolean {
  return cron.validate(expression);
}

/**
 * Registers a cron job. Returns false if the name is taken or the expression is invalid.
 * Jobs registered after startAllCrons() start immediately.
 */
export function registerCron(name: string, expression: string, fn: () => void | Promise<void>): boolean {
  if (jobs.has(name)) {
    logger.warn(`Cron job "${name}" already registered, skipping`);
    return false;
  }

  if (!isValidCron(expression)) {
    logger.error(`Invalid cron expression for "${name}": "${expression}"`);
    return false;
  }

  const task = cron.schedule(expression, async () => {
    try {
      await fn();
    } catch (err) {
      logger.error(`Cron job "${name}" failed`, { error: err instanceof Error ? err.message : String(err) });
    }
  }, { scheduled: started });

  jobs.set(name, { name, expression, task });
  logger.info(`Cron job registered: "${name}" (${expression})`);
  return true;
}

export function unregisterCron(name: string): void {
  const job = jobs.get(name);
  if (job) {
    job.task.stop();
    jobs.delete(name);
    logger.debug(`Cron job unregistered: "${name}"`);
  }
}

export function listCronNames(): string[] {
  return [...jobs.keys()];
}

export function startAllCrons(): void {
  for (const job of jobs.values()) {
    job.task.start();
  }
  started = true;
  logger.info(`Started ${jobs.size} cron jobs`);
}

export function stopAllCrons(): void {
  for (const job of jobs.values()) {
    job.task.stop();
  }
  started = false;
  logger.info(`Stopped ${jobs.size} cron jobs`);
}
