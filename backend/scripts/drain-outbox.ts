/**
 * Sends everything waiting in the outbox.
 *
 * A script rather than a timer inside the API process, so it can be run on
 * demand — after fixing a mail configuration, or to flush a backlog — and so a
 * restart of the API never drops a message mid-send. `drain` claims each row
 * before touching it, so running two of these at once is safe.
 */

import { drain, pruneSent, status } from '../src/modules/notifications/outbox.service.ts';
import { closeDb } from '../src/core/db.ts';
import { closeRedis } from '../src/core/redis.ts';
import { closeMailer } from '../src/core/mailer.ts';

async function main(): Promise<void> {
  const before = await status();
  console.log(`\n  Outbox: ${before.pending} pending via ${before.transport}\n`);

  const result = await drain(200);
  console.log(`  ${result.sent} sent, ${result.failed} will retry, ${result.abandoned} abandoned`);

  const pruned = await pruneSent();
  if (pruned.removed > 0) {
    console.log(`  ${pruned.removed} delivered message(s) older than 7 days removed`);
  }
  console.log('');
}

main()
  .catch((err: unknown) => {
    console.error('  Drain failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    closeMailer();
    await closeDb();
    await closeRedis();
  });
