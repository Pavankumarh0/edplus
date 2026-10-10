import Papa from 'papaparse';
import {
  AcademicRecordSchema,
  UsnSchema,
  makeRecordId,
  type AcademicRecord,
  type ColumnMapping,
  type RecordType,
  type RowError,
  type StudentUpsert,
} from '../schemas/index.js';
import { normaliseDate, normaliseLanguage, normalisePhone, parseNumber } from './normalise.js';

export interface ParseCsvResult {
  headers: string[];
  rows: Record<string, string>[];
  /** Parser-level problems, e.g. a ragged row. */
  errors: RowError[];
}

/**
 * Parses CSV text into rows keyed by header.
 *
 * Uses Papa Parse rather than splitting on commas: quoted fields containing
 * commas and newlines are routine in exported marks sheets, and a hand-rolled
 * split silently corrupts them.
 */
export function parseCsv(text: string): ParseCsvResult {
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim(),
    transform: (v) => (typeof v === 'string' ? v.trim() : v),
  });

  const headers = (result.meta.fields ?? []).filter((h) => h.length > 0);

  const errors: RowError[] = result.errors.map((e) => ({
    // Papa rows are 0-based over data rows; +2 accounts for that and the
    // header, so the number matches what the user sees in their spreadsheet.
    row: typeof e.row === 'number' ? e.row + 2 : 1,
    field: null,
    message: e.message,
    rawValue: null,
  }));

  return { headers, rows: result.data, errors };
}

export interface ImportOptions {
  recordType: RecordType;
  mapping: ColumnMapping;
  uploadId: string;
  /** Used when a row carries no date of its own. */
  defaultDate: string;
  /**
   * When the file has no max-value column, treat `value` as a percentage
   * already out of 100. Recorded as a warning so the preview says so out loud.
   */
  assumePercentageWhenNoMax?: boolean;
}

export interface ImportResult {
  records: AcademicRecord[];
  students: StudentUpsert[];
  errors: RowError[];
  warnings: string[];
  rowsTotal: number;
  rowsOk: number;
  rowsRejected: number;
  /** Rows that collapsed onto an earlier row's record id. */
  duplicatesCollapsed: number;
  affectedUsns: string[];
}

/**
 * Turns parsed rows into validated records and student upserts.
 *
 * Nothing is invented. A row missing a number it needs is rejected with a
 * reason rather than defaulted to zero, because a fabricated zero becomes a
 * real risk score attached to a real student.
 *
 * Rows are processed independently: one bad row never aborts the import, it
 * just lands in `errors` for the preview to show.
 */
export function buildImport(rows: Record<string, string>[], options: ImportOptions): ImportResult {
  const { recordType, mapping, uploadId, defaultDate } = options;
  const assumePercentage = options.assumePercentageWhenNoMax ?? true;

  const errors: RowError[] = [];
  const warnings: string[] = [];
  const byRecordId = new Map<string, AcademicRecord>();
  const studentsByUsn = new Map<string, StudentUpsert>();

  let duplicatesCollapsed = 0;
  let rowsOk = 0;

  if (!mapping.maxValue && assumePercentage) {
    warnings.push(
      `No maximum-value column was mapped, so the "${mapping.value}" column is being read ` +
        'as a percentage out of 100. Check this is right before committing.',
    );
  }
  if (!mapping.date) {
    warnings.push(`No date column was mapped — every record will be dated ${defaultDate}.`);
  }
  if (!mapping.subject) {
    warnings.push('No subject column was mapped — all records will be filed under "General".');
  }

  rows.forEach((row, index) => {
    // Header is row 1, so the first data row is row 2.
    const rowNumber = index + 2;
    const fail = (message: string, field: string | null, rawValue: string | null = null) => {
      errors.push({ row: rowNumber, field, message, rawValue });
    };

    // ── USN ──────────────────────────────────────────────────────────────
    const rawUsn = row[mapping.usn];
    const usnParse = UsnSchema.safeParse(rawUsn ?? '');
    if (!usnParse.success) {
      fail('Missing or invalid USN — the row cannot be attached to a student.', 'usn', rawUsn ?? null);
      return;
    }
    const usn = usnParse.data;

    // ── The numbers ──────────────────────────────────────────────────────
    const rawValue = row[mapping.value];
    const value = parseNumber(rawValue);
    if (value === null) {
      fail(
        `"${mapping.value}" is empty or not a number. Left blank rather than assumed — ` +
          'upload the real figure, or remove the row.',
        'value',
        rawValue ?? null,
      );
      return;
    }

    let maxValue: number | null;
    if (mapping.maxValue) {
      maxValue = parseNumber(row[mapping.maxValue]);
      if (maxValue === null) {
        fail(`"${mapping.maxValue}" is empty or not a number.`, 'maxValue', row[mapping.maxValue] ?? null);
        return;
      }
    } else if (assumePercentage) {
      maxValue = 100;
    } else {
      fail('No maximum-value column mapped, so this row cannot be scored.', 'maxValue');
      return;
    }

    // ── Everything else ──────────────────────────────────────────────────
    const subject = (mapping.subject ? row[mapping.subject] : '')?.trim() || 'General';
    const date = normaliseDate(mapping.date ? row[mapping.date] : null, defaultDate);

    const candidate: AcademicRecord = {
      recordId: makeRecordId({ usn, type: recordType, subject, date }),
      usn,
      type: recordType,
      subject,
      value,
      maxValue,
      date,
      sourceUploadId: uploadId,
    };

    const validated = AcademicRecordSchema.safeParse(candidate);
    if (!validated.success) {
      for (const issue of validated.error.issues) {
        fail(issue.message, issue.path.join('.') || null, String(rawValue ?? ''));
      }
      return;
    }

    // Same student + type + subject + date twice in one file: the later row
    // wins and the duplicate is counted, not reported as an error. This is
    // what makes re-importing a corrected sheet safe.
    if (byRecordId.has(validated.data.recordId)) duplicatesCollapsed += 1;
    byRecordId.set(validated.data.recordId, validated.data);
    rowsOk += 1;

    // ── Student upsert ───────────────────────────────────────────────────
    const existing = studentsByUsn.get(usn) ?? { usn };
    const student: StudentUpsert = { ...existing };

    const name = mapping.name ? row[mapping.name]?.trim() : undefined;
    if (name) student.name = name;

    const semester = mapping.semester ? parseNumber(row[mapping.semester]) : null;
    if (semester !== null && semester >= 1 && semester <= 8) student.semester = semester;

    const section = mapping.section ? row[mapping.section]?.trim() : undefined;
    if (section) student.section = section;

    const department = mapping.department ? row[mapping.department]?.trim() : undefined;
    if (department) student.department = department;

    const parentName = mapping.parentName ? row[mapping.parentName]?.trim() : undefined;
    const rawPhone = mapping.parentPhone ? row[mapping.parentPhone]?.trim() : undefined;
    if (rawPhone) {
      const phone = normalisePhone(rawPhone);
      if (phone) {
        student.parent = {
          name: parentName || 'Parent/Guardian',
          phone,
          preferredLanguage: normaliseLanguage(
            mapping.parentLanguage ? row[mapping.parentLanguage] : null,
          ),
        };
      } else {
        // The academic record still counts — only the contact is unusable.
        fail(
          `Parent phone "${rawPhone}" is not a number we can dial, so no parent contact was saved ` +
            'for this student. The academic record was still imported.',
          'parentPhone',
          rawPhone,
        );
      }
    } else if (parentName) {
      student.parent = {
        name: parentName,
        phone: '',
        preferredLanguage: normaliseLanguage(
          mapping.parentLanguage ? row[mapping.parentLanguage] : null,
        ),
      };
      // A contact with no number cannot be called; drop the stub.
      delete student.parent;
    }

    studentsByUsn.set(usn, student);
  });

  const records = [...byRecordId.values()];

  return {
    records,
    students: [...studentsByUsn.values()],
    errors,
    warnings,
    rowsTotal: rows.length,
    rowsOk,
    rowsRejected: rows.length - rowsOk,
    duplicatesCollapsed,
    affectedUsns: [...studentsByUsn.keys()].sort(),
  };
}
