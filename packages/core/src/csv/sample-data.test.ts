import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RISK_RULES,
  type AcademicRecord,
  type RecordType,
  type RiskSnapshot,
} from '../schemas/index.js';
import { computeSnapshot } from '../risk/engine.js';
import { finaliseMapping, heuristicMapping, heuristicsAreSufficient } from './mapping.js';
import { buildImport, parseCsv } from './parse.js';

const SAMPLE_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../../sample-data');

function load(file: string, recordType: RecordType, uploadId: string, defaultDate: string) {
  const text = readFileSync(join(SAMPLE_DIR, file), 'utf8');
  const { headers, rows } = parseCsv(text);
  const heuristic = heuristicMapping(headers, recordType);
  const mapping = finaliseMapping(heuristic.mapping, headers);
  return {
    heuristic,
    result: buildImport(rows, { recordType, mapping, uploadId, defaultDate }),
  };
}

/** Imports the three March files and scores every student. */
function marchSnapshots(): Map<string, RiskSnapshot> {
  const files: [string, RecordType][] = [
    ['01-attendance-march.csv', 'attendance'],
    ['02-assessment-march.csv', 'assessment'],
    ['03-submissions-march.csv', 'submission'],
  ];

  const records: AcademicRecord[] = [];
  const usns = new Set<string>();
  for (const [file, type] of files) {
    const { result } = load(file, type, `march-${type}`, '2026-03-01');
    expect(result.rowsRejected, `${file} should import cleanly`).toBe(0);
    records.push(...result.records);
    for (const usn of result.affectedUsns) usns.add(usn);
  }

  const byUsn = new Map<string, RiskSnapshot>();
  for (const usn of usns) {
    byUsn.set(
      usn,
      computeSnapshot({
        usn,
        records: records.filter((r) => r.usn === usn),
        rules: DEFAULT_RISK_RULES,
        now: new Date('2026-03-02T09:00:00.000Z'),
      }),
    );
  }
  return byUsn;
}

describe('sample data — March upload', () => {
  const snapshots = marchSnapshots();

  it('covers about 30 students', () => {
    expect(snapshots.size).toBe(30);
  });

  it('imports all three files through the heuristic path alone', () => {
    for (const [file, type] of [
      ['01-attendance-march.csv', 'attendance'],
      ['02-assessment-march.csv', 'assessment'],
      ['03-submissions-march.csv', 'submission'],
    ] as [string, RecordType][]) {
      const { heuristic } = load(file, type, 'x', '2026-03-01');
      expect(heuristicsAreSufficient(heuristic), file).toBe(true);
    }
  });

  it('produces a clearly CRITICAL student for the demo headline', () => {
    const ananya = snapshots.get('1OX21IS045')!;
    expect(ananya.level).toBe('critical');
    expect(ananya.score).toBeGreaterThanOrEqual(DEFAULT_RISK_RULES.levelCutoffs.critical);
    expect(ananya.insufficientData).toBe(false);
    expect(ananya.confidence).toBeGreaterThan(0.8);
  });

  it('produces a clearly STABLE student for contrast', () => {
    const aarav = snapshots.get('1OX21IS001')!;
    expect(aarav.level).toBe('stable');
    expect(aarav.score).toBe(0);
  });

  it('produces a student with CONFLICTING indicators', () => {
    const rohan = snapshots.get('1OX21IS012')!;
    expect(rohan.conflicts.length).toBeGreaterThan(0);
    // Present nearly every class, failing the internals.
    expect(rohan.indicators.attendance.subScore).toBe(0);
    expect(rohan.indicators.assessment.subScore).toBeGreaterThan(50);
    const conflict = rohan.conflicts.find((c) => c.weakIndicator === 'assessment');
    expect(conflict).toBeDefined();
  });

  it('produces a student with MISSING academic data', () => {
    const fatima = snapshots.get('1OX21IS023')!;
    expect(fatima.indicators.assessment.available).toBe(false);
    expect(fatima.indicators.submission.available).toBe(false);
    expect(fatima.indicators.attendance.available).toBe(true);
    expect(fatima.dataGaps.length).toBeGreaterThanOrEqual(2);
    // Only one indicator scoreable → below minIndicatorsForScore of 2.
    expect(fatima.insufficientData).toBe(true);
    expect(fatima.confidence).toBeLessThan(0.5);
  });

  it('spreads students across every risk level', () => {
    const levels = new Set([...snapshots.values()].map((s) => s.level));
    expect(levels).toContain('stable');
    expect(levels).toContain('watch');
    expect(levels).toContain('at_risk');
    expect(levels).toContain('critical');
  });

  it('captures parent contacts from the attendance sheet', () => {
    const { result } = load('01-attendance-march.csv', 'attendance', 'x', '2026-03-01');
    const ananya = result.students.find((s) => s.usn === '1OX21IS045')!;
    expect(ananya.parent).toEqual({
      name: 'Venkat Reddy',
      phone: '+919900112233',
      preferredLanguage: 'te-IN',
    });
  });
});

describe('sample data — April re-upload closes the loop', () => {
  const march = marchSnapshots();

  function aprilSnapshot(usn: string): RiskSnapshot {
    const files: [string, RecordType][] = [
      ['04-attendance-april.csv', 'attendance'],
      ['05-assessment-april.csv', 'assessment'],
      ['06-submissions-april.csv', 'submission'],
    ];
    const records: AcademicRecord[] = [];
    for (const [file, type] of files) {
      const { result } = load(file, type, `april-${type}`, '2026-04-01');
      records.push(...result.records.filter((r) => r.usn === usn));
    }
    return computeSnapshot({
      usn,
      records,
      rules: DEFAULT_RISK_RULES,
      previousSnapshot: march.get(usn) ?? null,
      now: new Date('2026-04-02T09:00:00.000Z'),
    });
  }

  it('drops the intervened student’s score, which is the demo payoff', () => {
    const before = march.get('1OX21IS045')!;
    const after = aprilSnapshot('1OX21IS045');
    expect(after.score).toBeLessThan(before.score);
    expect(after.scoreDelta).toBeLessThan(-2); // beyond the noise floor
    expect(after.level).not.toBe('critical');
    // A partial recovery, not a miracle: still on the watch list, which is
    // the honest story and the one worth demoing.
    expect(after.score).toBeGreaterThan(0);
    expect(after.insufficientData).toBe(false);
    // Credited with an improving trend.
    expect(after.indicators.trend.available).toBe(true);
    expect(after.indicators.trend.value).toBeGreaterThan(0);
  });

  it('shows a student getting worse, so the demo is not one-sided', () => {
    const before = march.get('1OX21IS020')!;
    const after = aprilSnapshot('1OX21IS020');
    expect(after.score).toBeGreaterThan(before.score);
    expect(after.indicators.trend.value).toBeLessThan(0);
  });

  it('keeps the missing-data student flagged after re-upload', () => {
    const after = aprilSnapshot('1OX21IS023');
    expect(after.insufficientData).toBe(true);
    expect(after.indicators.assessment.available).toBe(false);
  });

  it('reads the April attendance sheet even though it has no parent columns', () => {
    const { result } = load('04-attendance-april.csv', 'attendance', 'x', '2026-04-01');
    expect(result.rowsRejected).toBe(0);
    // No name blanking: the upsert simply omits parent data this time.
    expect(result.students.every((s) => s.parent === undefined)).toBe(true);
  });
});

describe('sample data — messy headers force the Claude mapping fallback', () => {
  it('cannot be resolved by heuristics alone, which is the point of the fixture', () => {
    const text = readFileSync(join(SAMPLE_DIR, '07-messy-headers-attendance.csv'), 'utf8');
    const { headers } = parseCsv(text);
    const heuristic = heuristicMapping(headers, 'attendance');
    expect(heuristicsAreSufficient(heuristic)).toBe(false);
    expect(heuristic.unresolvedRequired.length).toBeGreaterThan(0);
  });

  it('imports correctly once a mapping is supplied, including day-first dates', () => {
    const text = readFileSync(join(SAMPLE_DIR, '07-messy-headers-attendance.csv'), 'utf8');
    const { headers, rows } = parseCsv(text);
    const mapping = finaliseMapping(
      { usn: 'Univ Seat Number', name: 'Candidate', subject: 'Paper', value: 'Attd', maxValue: 'Sessions', date: 'Dt' },
      headers,
    );
    const result = buildImport(rows, {
      recordType: 'attendance', mapping, uploadId: 'messy', defaultDate: '2026-03-01',
    });
    expect(result.rowsOk).toBe(4);
    expect(result.rowsRejected).toBe(0);
    expect(result.records[0]!.date).toBe('2026-03-01');
  });
});

describe('sample data — dirty rows demonstrate row-level error reporting', () => {
  const { result } = load('08-dirty-rows-assessment.csv', 'assessment', 'dirty', '2026-03-01');

  it('accepts the good rows and rejects only the bad ones', () => {
    // 8 data rows: 1 ok, blank mark, 60/50, no USN, "absent", bad phone (row
    // still imports), 2 duplicates collapsing to 1.
    expect(result.rowsOk).toBe(4);
    expect(result.rowsRejected).toBe(4);
    expect(result.duplicatesCollapsed).toBe(1);
  });

  it('names a row, a field and a reason for every rejection', () => {
    for (const error of result.errors) {
      expect(error.row).toBeGreaterThanOrEqual(2);
      expect(error.message.length).toBeGreaterThan(10);
    }
  });

  it('reports the blank mark, the over-max mark, the missing USN and the bad number', () => {
    const messages = result.errors.map((e) => e.message).join(' | ');
    expect(messages).toMatch(/not a number/);
    expect(messages).toMatch(/cannot exceed/);
    expect(messages).toMatch(/invalid USN/);
    expect(messages).toMatch(/not a number we can dial/);
  });

  it('still imports the academic record for the row with an undialable phone', () => {
    expect(result.records.some((r) => r.usn === '1OX21IS006')).toBe(true);
    expect(result.students.find((s) => s.usn === '1OX21IS006')!.parent).toBeUndefined();
  });
});
