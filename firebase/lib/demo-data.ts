import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  DEFAULT_RISK_RULES,
  buildImport,
  computeSnapshot,
  finaliseMapping,
  heuristicMapping,
  parseCsv,
  type AcademicRecord,
  type RecordType,
  type RiskRules,
  type RiskSnapshot,
  type StudentUpsert,
} from '@eduplus/core';

const HERE = dirname(fileURLToPath(import.meta.url));
export const SAMPLE_DIR = join(HERE, '../../sample-data');

export interface LoadedFile {
  records: AcademicRecord[];
  students: StudentUpsert[];
  rowsOk: number;
  rowsRejected: number;
  warnings: string[];
}

/**
 * Imports one sample CSV through the real pipeline — the same heuristic
 * mapping, the same validation, the same deterministic record ids the
 * dashboard uses.
 *
 * Deliberately not a shortcut that writes fabricated documents: if the seed
 * bypassed the importer, it could silently drift from what an upload actually
 * produces and the demo would be rehearsing something the product does not do.
 */
export function loadSampleFile(
  fileName: string,
  recordType: RecordType,
  uploadId: string,
  defaultDate: string,
): LoadedFile {
  const text = readFileSync(join(SAMPLE_DIR, fileName), 'utf8');
  const { headers, rows } = parseCsv(text);

  const heuristic = heuristicMapping(headers, recordType);
  const mapping = finaliseMapping(heuristic.mapping, headers);

  const result = buildImport(rows, { recordType, mapping, uploadId, defaultDate });

  if (result.rowsRejected > 0) {
    throw new Error(
      `${fileName}: ${result.rowsRejected} rows rejected — the sample data should import cleanly.\n` +
        result.errors.map((e) => `  row ${e.row}: ${e.message}`).join('\n'),
    );
  }

  return {
    records: result.records,
    students: result.students,
    rowsOk: result.rowsOk,
    rowsRejected: result.rowsRejected,
    warnings: result.warnings,
  };
}

export const MARCH_FILES: [string, RecordType][] = [
  ['01-attendance-march.csv', 'attendance'],
  ['02-assessment-march.csv', 'assessment'],
  ['03-submissions-march.csv', 'submission'],
];

export const APRIL_FILES: [string, RecordType][] = [
  ['04-attendance-april.csv', 'attendance'],
  ['05-assessment-april.csv', 'assessment'],
  ['06-submissions-april.csv', 'submission'],
];

export interface LoadedMonth {
  records: AcademicRecord[];
  students: StudentUpsert[];
  usns: string[];
}

/** Imports a whole month's worth of files and merges the student upserts. */
export function loadMonth(files: [string, RecordType][], defaultDate: string): LoadedMonth {
  const records: AcademicRecord[] = [];
  const studentsByUsn = new Map<string, StudentUpsert>();

  for (const [fileName, recordType] of files) {
    const loaded = loadSampleFile(fileName, recordType, `seed-${fileName}`, defaultDate);
    records.push(...loaded.records);
    for (const student of loaded.students) {
      const merged = { ...(studentsByUsn.get(student.usn) ?? {}), ...student };
      studentsByUsn.set(student.usn, merged as StudentUpsert);
    }
  }

  return {
    records,
    students: [...studentsByUsn.values()],
    usns: [...studentsByUsn.keys()].sort(),
  };
}

/**
 * Scores every student in a month, chaining onto the previous snapshot so the
 * trend indicator and `scoreDelta` are populated exactly as they would be in
 * production.
 */
export function scoreMonth(
  month: LoadedMonth,
  rules: RiskRules = DEFAULT_RISK_RULES,
  previous: Map<string, RiskSnapshot> = new Map(),
  now: Date = new Date(),
): Map<string, RiskSnapshot> {
  const out = new Map<string, RiskSnapshot>();
  for (const usn of month.usns) {
    out.set(
      usn,
      computeSnapshot({
        usn,
        records: month.records.filter((r) => r.usn === usn),
        rules,
        previousSnapshot: previous.get(usn) ?? null,
        now,
      }),
    );
  }
  return out;
}

/** The students the demo script calls out by name. */
export const DEMO_STUDENTS = {
  critical: '1OX21IS045', // Ananya Reddy — the headline student
  stable: '1OX21IS001', // Aarav Sharma
  conflict: '1OX21IS012', // Rohan Mehta — high attendance, failing marks
  missingData: '1OX21IS023', // Fatima Khan — attendance only
  worsening: '1OX21IS020', // Shaurya Verma
} as const;

/** Demo accounts. Passwords are deliberately obvious — this is seed data. */
export const DEMO_USERS = [
  {
    email: 'faculty@eduplus.local',
    password: 'eduplus-demo',
    displayName: 'Dr. Priya Menon',
    claims: { role: 'faculty' as const },
  },
  {
    email: 'ananya@eduplus.local',
    password: 'eduplus-demo',
    displayName: 'Ananya Reddy',
    claims: { role: 'student' as const, usn: DEMO_STUDENTS.critical },
  },
  {
    email: 'aarav@eduplus.local',
    password: 'eduplus-demo',
    displayName: 'Aarav Sharma',
    claims: { role: 'student' as const, usn: DEMO_STUDENTS.stable },
  },
];
