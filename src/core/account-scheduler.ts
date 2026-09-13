import { eq, and, isNotNull } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { JobType } from '../config/constants.js';
import { logger } from '../config/logger.js';
import { registerCron, unregisterCron, listCronNames } from './scheduler.js';
import { enqueueJob } from './queue.js';
import type { AccountStrategy } from '../types/index.js';

const CRON_PREFIX = 'account-strategy-';

function cronName(accountId: string): string {
  return `${CRON_PREFIX}${accountId}`;
}

/**
 * Makes the registered account crons match the database: registers active strategies
 * (re-registering to pick up changed expressions) and removes crons for accounts that
 * were deleted, deactivated or had their strategy disabled.
 */
export async function syncAccountCrons(): Promise<void> {
  const accounts = await db
    .select({
      id: schema.accounts.id,
      projectId: schema.accounts.projectId,
      platform: schema.accounts.platform,
      strategy: schema.accounts.strategy,
    })
    .from(schema.accounts)
    .where(and(eq(schema.accounts.active, true), isNotNull(schema.accounts.strategy)));

  const wanted = new Set<string>();
  let registered = 0;

  for (const account of accounts) {
    const strategy = account.strategy as AccountStrategy | null;
    if (!strategy?.active || !strategy.cronExpression) continue;

    const name = cronName(account.id);
    wanted.add(name);

    unregisterCron(name);

    const ok = registerCron(name, strategy.cronExpression, async () => {
      logger.info(`Cron triggered for account ${account.id} (${account.platform})`, {
        accountId: account.id,
      });
      await enqueueJob(JobType.GENERATE_CONTENT, {
        accountId: account.id,
        projectId: account.projectId,
        platform: account.platform,
        strategy,
      });
    });

    if (ok) registered++;
  }

  for (const name of listCronNames()) {
    if (name.startsWith(CRON_PREFIX) && !wanted.has(name)) {
      unregisterCron(name);
    }
  }

  logger.info(`Account crons synced: ${registered} active strategies`);
}

export function removeAccountCron(accountId: string): void {
  unregisterCron(cronName(accountId));
}
