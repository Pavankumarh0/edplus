import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_RISK_RULES, makeRecordId, type AcademicRecord } from '../schemas/index';
import { computeSnapshot } from './engine';
import { getDb } from '../repositories/firestore';
import { getRiskRules, saveRiskRules, ensureRiskRules } from '../repositories/config';
import { saveSnapshots, getLatestSnapshot, writeRecords } from '../repositories/academics';
import { upsertStudents } from '../repositories/students';

/**
 * Saving risk rules, against the emulator.
 *
 * This is the one consequential faculty action that was never exercised: it
 * bumps `rulesVersion` and, in the dashboard, triggers a full recompute. On
 * live data that rewrites every snapshot, so it is tested here instead — which
 * is the whole reason the emulator config exists.
 */

const USN = '1OX99IS001';

function records(attendancePercent: number): AcademicRecord[] {
  const date = '2026-03-01';
  return [
    {
      recordId: makeRecordId({ usn: USN, type: 'attendance', subject: 'DBMS', date }),
      usn: USN,
      type: 'attendance',
      subject: 'DBMS',
      value: Math.round((attendancePercent * 45) / 100),
      maxValue: 45,
      date,
      sourceUploadId: 'rules-save-test',
    },
    {
      recordId: makeRecordId({ usn: USN, type: 'assessment', subject: 'DBMS', date }),
      usn: USN,
      type: 'assessment',
      subject: 'DBMS',
      value: 30,
      maxValue: 50,
      date,
      sourceUploadId: 'rules-save-test',
    },
  ];
}

beforeAll(async () => {
  const db = getDb();
  await upsertStudents(db, [
    { usn: USN, name: 'Rules Save Test', semester: 5, section: 'Z', department: 'IS' },
  ]);
  await writeRecords(db, records(70));
  await ensureRiskRules(db);
});

afterAll(async () => {
  const db = getDb();
  const student = db.collection('students').doc(USN);
  for (const sub of ['records', 'snapshots']) {
    const snap = await student.collection(sub).get();
    for (const doc of snap.docs) await doc.ref.delete();
  }
  await student.delete();
});

describe('saving risk rules', () => {
  it('bumps the version even when the caller does not ask it to', async () => {
    // Every snapshot records the version that produced it. Letting a caller
    // choose the version would make comparing two scores meaningless.
    const db = getDb();
    const before = await getRiskRules(db);

    const { rulesVersion: _ignored, ...rest } = before;
    const saved = await saveRiskRules(db, { ...rest }, 'test-faculty');

    expect(saved.rulesVersion).toBe((before.rulesVersion ?? 0) + 1);
    expect(saved.updatedBy).toBe('test-faculty');
  });

  it('changes what a student scores, and the new snapshot says which rules did it', async () => {
    const db = getDb();

    const lenient = await getRiskRules(db);
    const first = computeSnapshot({
      usn: USN,
      records: records(70),
      rules: lenient,
      now: new Date('2026-03-02T00:00:00.000Z'),
    });
    await saveSnapshots(db, [first]);

    // Raise the attendance bar: the same 70% must now score worse.
    const { rulesVersion: _v, ...rest } = lenient;
    const strict = await saveRiskRules(
      db,
      {
        ...rest,
        indicators: {
          ...rest.indicators,
          attendance: { ...rest.indicators.attendance, threshold: 95, criticalAt: 60 },
        },
      },
      'test-faculty',
    );

    const second = computeSnapshot({
      usn: USN,
      records: records(70),
      rules: strict,
      now: new Date('2026-03-03T00:00:00.000Z'),
    });
    await saveSnapshots(db, [second]);

    expect(second.score).toBeGreaterThan(first.score);
    expect(second.rulesVersion).toBe(strict.rulesVersion);
    expect(first.rulesVersion).toBe(lenient.rulesVersion);

    // The dashboard reads the newest, and it is the one under the new rules.
    const latest = await getLatestSnapshot(db, USN);
    expect(latest?.rulesVersion).toBe(strict.rulesVersion);
  });

  it('refuses rules that are not a complete set', async () => {
    const db = getDb();
    const current = await getRiskRules(db);
    const { rulesVersion: _v, ...rest } = current;

    await expect(
      saveRiskRules(
        db,
        // Attendance removed: the engine would silently score everyone on
        // three indicators and nobody would know why the numbers moved.
        { ...rest, indicators: { ...rest.indicators, attendance: undefined } } as never,
        'test-faculty',
      ),
    ).rejects.toThrow();
  });

  it('leaves the defaults loadable for a fresh project', async () => {
    const db = getDb();
    const rules = await getRiskRules(db);
    for (const key of ['attendance', 'assessment', 'submission', 'trend'] as const) {
      expect(rules.indicators[key]).toBeDefined();
    }
    expect(DEFAULT_RISK_RULES.indicators.attendance.threshold).toBe(90);
  });
});
