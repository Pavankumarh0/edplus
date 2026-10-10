/**
 * npm run demo:students [-- --live]
 *
 * Adds the two students used for live call testing, with REAL parent phone
 * numbers, their own app logins, and enough academic history to produce a
 * meaningful risk score.
 *
 * Kept separate from `seed.ts` on purpose: the main seed's parent numbers are
 * invented, and must stay that way so nobody dials a stranger by accident.
 * Real numbers live here, in one obvious place.
 */
import {
  DEFAULT_RISK_RULES,
  computeSnapshot,
  makeRecordId,
  type AcademicRecord,
  type ParentLanguage,
  type RecordType,
  type StudentUpsert,
} from '@eduplus/core';
import { getAuth } from 'firebase-admin/auth';
import {
  ensureCreatedAt,
  getAdminApp,
  saveSnapshots,
  upsertStudents,
  writeRecords,
} from '@eduplus/core/repositories';
import { assertSafeTarget, describeTarget, getDb } from './lib/admin';

const allowLive = process.argv.includes('--live');

const SUBJECTS = ['DBMS', 'OS', 'CN'] as const;
const CLASSES_HELD = 45;
const MAX_MARKS = 50;
const TOTAL_SUBMISSIONS = 6;

interface DemoStudent {
  usn: string;
  name: string;
  section: string;
  email: string;
  password: string;
  parentName: string;
  /** Real number. Calls to this student will ring it. */
  parentPhone: string;
  parentLanguage: ParentLanguage;
  /** March percentages: [attendance, assessment, submission]. */
  march: [number, number, number];
  /** April percentages, so there is a trend and a second snapshot. */
  april: [number, number, number];
}

const STUDENTS: DemoStudent[] = [
  {
    usn: '1OX21IS050',
    name: 'Pavan Kumar H',
    section: 'A',
    email: 'pavan@eduplus.local',
    password: 'eduplus-demo',
    parentName: 'Parent of Pavan',
    parentPhone: '+917676729328',
    parentLanguage: 'kn-IN',
    march: [58, 36, 50],
    april: [71, 48, 67],
  },
  {
    usn: '1OX21IS051',
    name: 'Yadava HC',
    section: 'A',
    email: 'yadava@eduplus.local',
    password: 'eduplus-demo',
    parentName: 'Parent of Yadava',
    parentPhone: '+918904030441',
    parentLanguage: 'kn-IN',
    march: [44, 24, 33],
    april: [52, 31, 50],
  },
];

function countOf(percent: number, total: number): number {
  return Math.round((percent * total) / 100);
}

function recordsFor(
  student: DemoStudent,
  percentages: [number, number, number],
  date: string,
  uploadId: string,
): AcademicRecord[] {
  const out: AcademicRecord[] = [];
  const plan: [RecordType, number, number][] = [
    ['attendance', percentages[0], CLASSES_HELD],
    ['assessment', percentages[1], MAX_MARKS],
    ['submission', percentages[2], TOTAL_SUBMISSIONS],
  ];

  for (const [type, percent, total] of plan) {
    for (const subject of SUBJECTS) {
      out.push({
        recordId: makeRecordId({ usn: student.usn, type, subject, date }),
        usn: student.usn,
        type,
        subject,
        value: countOf(percent, total),
        maxValue: total,
        date,
        sourceUploadId: uploadId,
      });
    }
  }
  return out;
}

async function main() {
  assertSafeTarget(allowLive);
  const db = getDb();
  const auth = getAuth(getAdminApp());

  console.log(`\nAdding call-test students to ${describeTarget()}\n`);

  for (const student of STUDENTS) {
    // ── Student + parent contact ──────────────────────────────────────────
    const upsert: StudentUpsert = {
      usn: student.usn,
      name: student.name,
      semester: 5,
      section: student.section,
      department: 'Information Science',
      parent: {
        name: student.parentName,
        phone: student.parentPhone,
        preferredLanguage: student.parentLanguage,
      },
    };
    await upsertStudents(db, [upsert]);
    await ensureCreatedAt(db, [student.usn]);

    // ── Two months of records, so there is a trend to show ────────────────
    const march = recordsFor(student, student.march, '2026-03-01', 'demo-students-march');
    const april = recordsFor(student, student.april, '2026-04-01', 'demo-students-april');
    await writeRecords(db, [...march, ...april]);

    const marchSnapshot = computeSnapshot({
      usn: student.usn,
      records: march,
      rules: DEFAULT_RISK_RULES,
      now: new Date('2026-03-02T09:00:00.000Z'),
    });
    const aprilSnapshot = computeSnapshot({
      usn: student.usn,
      records: [...march, ...april],
      rules: DEFAULT_RISK_RULES,
      previousSnapshot: marchSnapshot,
      now: new Date('2026-04-02T09:00:00.000Z'),
    });
    await saveSnapshots(db, [marchSnapshot, aprilSnapshot]);

    // ── App login ─────────────────────────────────────────────────────────
    // The `usn` claim is what the Firestore rules check, so without it the
    // account signs in and then sees nothing.
    let uid: string;
    try {
      const existing = await auth.getUserByEmail(student.email);
      uid = existing.uid;
      await auth.updateUser(uid, { password: student.password, displayName: student.name });
    } catch {
      const created = await auth.createUser({
        email: student.email,
        password: student.password,
        displayName: student.name,
        emailVerified: true,
      });
      uid = created.uid;
    }
    await auth.setCustomUserClaims(uid, { role: 'student', usn: student.usn });
    await db.collection('students').doc(student.usn).set({ authUid: uid }, { merge: true });

    const masked = `${student.parentPhone.slice(0, 3)}${'•'.repeat(7)}${student.parentPhone.slice(-2)}`;
    console.log(`  ${student.name}  (${student.usn})`);
    console.log(`    login    ${student.email} / ${student.password}`);
    console.log(`    parent   ${masked}  ${student.parentLanguage}`);
    console.log(
      `    risk     ${marchSnapshot.score} ${marchSnapshot.level}  ->  ${aprilSnapshot.score} ${aprilSnapshot.level}`,
    );
    console.log('');
  }

  console.log('Both students can sign in to the mobile app and be called.\n');
}

main().catch((error) => {
  console.error('\nFailed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
