/**
 * npm run demo:reset
 *
 * Restores the pre-demo state: every student, record, snapshot, report,
 * intervention, task, call and upload is removed, and the risk rules plus the
 * demo accounts are put back.
 *
 * The system is left EMPTY on purpose. The judged demo opens by uploading
 * CSV 1, and that only lands if there is nothing there already — a dashboard
 * that already shows 30 students makes the first and most important step of
 * the demo invisible.
 *
 * Flags:
 *   --live     allow wiping the real project (otherwise emulator only)
 *   --yes      skip the confirmation prompt
 */
import { createInterface } from 'node:readline/promises';
import { ensureRiskRules } from '@eduplus/core/repositories';
import {
  assertSafeTarget,
  describeTarget,
  ensureDemoUsers,
  getDb,
  wipeCollection,
} from './lib/admin.js';

const args = new Set(process.argv.slice(2));
const allowLive = args.has('--live');
const skipPrompt = args.has('--yes');

/** Every collection the demo writes to. Ordered so students go last. */
const COLLECTIONS = ['uploads', 'interventions', 'calls', 'audit', 'students'];

async function confirm(): Promise<boolean> {
  if (skipPrompt) return true;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(
    `\nThis deletes ALL EduPlus data in ${describeTarget()}.\nType "reset" to continue: `,
  );
  rl.close();
  return answer.trim().toLowerCase() === 'reset';
}

async function main() {
  assertSafeTarget(allowLive);

  if (!(await confirm())) {
    console.log('Cancelled — nothing was deleted.');
    return;
  }

  const db = getDb();
  console.log(`\nResetting ${describeTarget()}\n`);

  for (const collection of COLLECTIONS) {
    // recursiveDelete also removes subcollections, which is what clears each
    // student's records, snapshots, reports, tasks and private parent contact.
    await wipeCollection(collection);
    console.log(`  cleared      ${collection}`);
  }

  const rules = await ensureRiskRules(db);
  console.log(`  rules        restored at v${rules.rulesVersion}`);

  const users = await ensureDemoUsers();
  if (!users.skipped) {
    console.log(`  users        ${users.created} created, ${users.updated} updated`);
  }

  console.log('\n  Ready for the demo. Next step: upload sample-data/01-attendance-march.csv\n');
}

main().catch((error) => {
  console.error('\nReset failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
