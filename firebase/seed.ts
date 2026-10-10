/**
 * npm run seed
 *
 * Loads the full demo dataset: March records, risk snapshots for all 30
 * students, an approved intervention on the headline student, and the demo
 * accounts. Use this to develop the dashboard without clicking through an
 * upload every time.
 *
 * For the judged demo itself use `npm run demo:reset`, which leaves the system
 * empty so the upload can be shown live.
 *
 * Flags:
 *   --live     allow writing to the real project (otherwise emulator only)
 *   --april    also load the April re-upload and resolve intervention outcomes
 */
import {
  classifyOutcome,
  resolveAllOutcomes,
  type Intervention,
  type RiskSnapshot,
  type StudentTask,
} from '@eduplus/core';
import {
  applyOutcomes,
  createIntervention,
  createTasks,
  ensureCreatedAt,
  ensureRiskRules,
  getRiskRules,
  markUploadCommitted,
  saveSnapshots,
  saveUpload,
  upsertStudents,
  writeRecords,
} from '@eduplus/core/repositories';
import { assertSafeTarget, describeTarget, ensureDemoUsers, getDb } from './lib/admin.js';
import {
  APRIL_FILES,
  DEMO_STUDENTS,
  MARCH_FILES,
  loadMonth,
  scoreMonth,
} from './lib/demo-data.js';

const args = new Set(process.argv.slice(2));
const allowLive = args.has('--live');
const withApril = args.has('--april');

async function main() {
  assertSafeTarget(allowLive);
  const db = getDb();

  console.log(`\nSeeding ${describeTarget()}\n`);

  // ── Risk rules ────────────────────────────────────────────────────────────
  await ensureRiskRules(db);
  const rules = await getRiskRules(db);
  console.log(`  rules        v${rules.rulesVersion}`);

  // ── March upload ──────────────────────────────────────────────────────────
  const march = loadMonth(MARCH_FILES, '2026-03-01');
  const { studentsWritten, parentsWritten } = await upsertStudents(db, march.students);
  await ensureCreatedAt(db, march.usns);
  const recordsWritten = await writeRecords(db, march.records);
  console.log(`  students     ${studentsWritten} (${parentsWritten} parent contacts)`);
  console.log(`  records      ${recordsWritten} (March)`);

  await saveUpload(db, {
    uploadId: 'seed-march',
    fileName: 'sample-data/01-03-march.csv',
    recordType: 'attendance',
    uploadedBy: 'seed',
    mapping: {
      usn: 'USN', name: 'Student Name', subject: 'Subject', value: 'Classes Attended',
      maxValue: 'Classes Held', date: 'Date', semester: 'Semester', section: 'Section',
      department: 'Department', parentName: 'Parent Name', parentPhone: 'Parent Phone',
      parentLanguage: 'Preferred Language',
    },
    mappingSource: 'heuristic',
    mappingConfidence: 1,
    rowsTotal: march.records.length,
    rowsOk: march.records.length,
    rowsRejected: 0,
    errors: [],
    affectedUsns: march.usns,
    committedAt: null,
    createdAt: new Date('2026-03-02T08:00:00.000Z').toISOString(),
  });
  await markUploadCommitted(db, 'seed-march');

  // ── Snapshots ─────────────────────────────────────────────────────────────
  const marchSnapshots = scoreMonth(march, rules, new Map(), new Date('2026-03-02T09:00:00.000Z'));
  await saveSnapshots(db, [...marchSnapshots.values()]);
  console.log(`  snapshots    ${marchSnapshots.size} (March)`);

  const levels = new Map<string, number>();
  for (const snapshot of marchSnapshots.values()) {
    levels.set(snapshot.level, (levels.get(snapshot.level) ?? 0) + 1);
  }
  console.log(
    `               ${[...levels.entries()].map(([l, n]) => `${l}:${n}`).join('  ')}`,
  );

  // ── A completed intervention on the headline student ──────────────────────
  // Completed (not merely approved) so that loading April immediately
  // demonstrates the before/after outcome.
  const baseline = marchSnapshots.get(DEMO_STUDENTS.critical)!;
  const intervention: Intervention = {
    interventionId: 'seed-iv-ananya',
    usn: DEMO_STUDENTS.critical,
    type: 'mentor_meeting',
    reason:
      `${baseline.indicators.attendance.reason} ${baseline.indicators.assessment.reason} ` +
      'Mentor meeting plus daily attendance follow-up agreed with the student.',
    status: 'completed',
    owner: 'faculty@eduplus.local',
    dueDate: '2026-03-20',
    notes: 'Met on 12 March. Student cited a family illness; agreed a catch-up plan.',
    baselineSnapshotId: baseline.snapshotId,
    baselineScore: baseline.score,
    outcomeSnapshotId: null,
    outcomeScore: null,
    outcome: null,
    createdAt: new Date('2026-03-03T06:00:00.000Z').toISOString(),
    completedAt: new Date('2026-03-20T06:00:00.000Z').toISOString(),
  };
  await createIntervention(db, intervention);
  console.log(`  intervention 1 (completed, baseline score ${baseline.score})`);

  const tasks: StudentTask[] = [
    {
      taskId: 'seed-task-1',
      usn: DEMO_STUDENTS.critical,
      interventionId: intervention.interventionId,
      title: 'Attend every DBMS class this week',
      description: 'Six classes. Attendance is the fastest indicator to recover.',
      dueDate: '2026-03-14',
      done: true,
      doneAt: new Date('2026-03-14T10:00:00.000Z').toISOString(),
    },
    {
      taskId: 'seed-task-2',
      usn: DEMO_STUDENTS.critical,
      interventionId: intervention.interventionId,
      title: 'Submit the two pending OS assignments',
      description: 'Hand both to the subject teacher by Friday.',
      dueDate: '2026-03-18',
      done: true,
      doneAt: new Date('2026-03-18T10:00:00.000Z').toISOString(),
    },
    {
      taskId: 'seed-task-3',
      usn: DEMO_STUDENTS.critical,
      interventionId: intervention.interventionId,
      title: 'Sit the CN retest',
      description: 'Scheduled for 2 April. Ask for the revision sheet beforehand.',
      dueDate: '2026-04-02',
      done: false,
      doneAt: null,
    },
  ];
  await createTasks(db, tasks);
  console.log(`  tasks        ${tasks.length}`);

  // ── Optional April re-upload, which closes the loop ───────────────────────
  if (withApril) {
    const april = loadMonth(APRIL_FILES, '2026-04-01');
    await upsertStudents(db, april.students);
    const aprilRecords = await writeRecords(db, april.records);
    const aprilSnapshots = scoreMonth(
      april,
      rules,
      marchSnapshots,
      new Date('2026-04-02T09:00:00.000Z'),
    );
    await saveSnapshots(db, [...aprilSnapshots.values()]);
    console.log(`  records      ${aprilRecords} (April)`);
    console.log(`  snapshots    ${aprilSnapshots.size} (April)`);

    const outcomeSnapshot = aprilSnapshots.get(DEMO_STUDENTS.critical);
    if (outcomeSnapshot) {
      const resolved = resolveAllOutcomes([intervention], outcomeSnapshot);
      await applyOutcomes(db, resolved);
      for (const outcome of resolved) {
        console.log(`  outcome      ${outcome.outcome} — ${outcome.summary}`);
      }
    }
  }

  // ── Demo accounts ─────────────────────────────────────────────────────────
  const users = await ensureDemoUsers();
  if (!users.skipped) {
    console.log(`  users        ${users.created} created, ${users.updated} updated`);
  }

  // ── What the demo should show ─────────────────────────────────────────────
  const headline = marchSnapshots.get(DEMO_STUDENTS.critical)!;
  const conflict = marchSnapshots.get(DEMO_STUDENTS.conflict)!;
  const missing = marchSnapshots.get(DEMO_STUDENTS.missingData)!;

  console.log('\n  Demo checkpoints');
  console.log(`    ${DEMO_STUDENTS.critical}  critical     score ${headline.score} / ${headline.level}`);
  console.log(`    ${DEMO_STUDENTS.conflict}  conflict     ${conflict.conflicts.length} recorded`);
  console.log(
    `    ${DEMO_STUDENTS.missingData}  missing data ${missing.dataGaps.length} gaps, confidence ${missing.confidence}`,
  );
  console.log('\nDone.\n');
}

main().catch((error) => {
  console.error('\nSeed failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
