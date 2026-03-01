import cron, { type ScheduledTask } from 'node-cron';
import { logger } from '../config/logger.js';

interface ScheduledJob {
  name: string;
  expression: string;
  task: ScheduledTask;
}

const jobs = new Map<string, ScheduledJob>();

export function registerCron(name: string, expression: string, fn: () => void | Promise<void>): void {
  if (jobs.has(name)) {
    logger.warn(`Cron job "${name}" already registered, skipping`);
    return;
  }

  const task = cron.schedule(expression, async () => {
    try {
      await fn();
    } catch (err) {
      logger.error(`Cron job "${name}" failed`, { error: err instanceof Error ? err.message : String(err) });
    }
  }, { scheduled: false });

  jobs.set(name, { name, expression, task });
  logger.info(`Cron job registered: "${name}" (${expression})`);
}

export function unregisterCron(name: string): void {
  const job = jobs.get(name);
  if (job) {
    job.task.stop();
    jobs.delete(name);
    logger.info(`Cron job unregistered: "${name}"`);
  }
}

export function startAllCrons(): void {
  for (const job of jobs.values()) {
    job.task.start();
  }
  logger.info(`Started ${jobs.size} cron jobs`);
}

export function stopAllCrons(): void {
  for (const job of jobs.values()) {
    job.task.stop();
  }
  logger.info(`Stopped ${jobs.size} cron jobs`);
}
