import type { RecordType } from '../schemas/index.js';

interface TemplateSpec {
  headers: string[];
  sampleRows: string[][];
  note: string;
}

/**
 * Downloadable templates, one per record type.
 *
 * The headers are exactly the ones `heuristicMapping` recognises with a
 * top-ranked pattern, so a faculty member who starts from a template never
 * needs the Claude mapping path at all.
 */
const TEMPLATES: Record<RecordType, TemplateSpec> = {
  attendance: {
    headers: [
      'USN', 'Student Name', 'Semester', 'Section', 'Department',
      'Subject', 'Classes Attended', 'Classes Held', 'Date',
      'Parent Name', 'Parent Phone', 'Preferred Language',
    ],
    sampleRows: [
      ['1OX21IS001', 'Aarav Sharma', '5', 'A', 'Information Science', 'DBMS', '38', '45', '2026-03-01', 'Rajesh Sharma', '+919876543210', 'Hindi'],
      ['1OX21IS002', 'Diya Nair', '5', 'A', 'Information Science', 'DBMS', '21', '45', '2026-03-01', 'Suresh Nair', '9876501234', 'Malayalam'],
    ],
    note: 'Classes Attended / Classes Held are counts, not percentages.',
  },
  assessment: {
    headers: [
      'USN', 'Student Name', 'Semester', 'Section', 'Department',
      'Subject', 'Marks Obtained', 'Max Marks', 'Date',
    ],
    sampleRows: [
      ['1OX21IS001', 'Aarav Sharma', '5', 'A', 'Information Science', 'DBMS', '34', '50', '2026-03-01'],
      ['1OX21IS002', 'Diya Nair', '5', 'A', 'Information Science', 'DBMS', '11', '50', '2026-03-01'],
    ],
    note: 'Marks Obtained / Max Marks. Leave a row out entirely if the test was not taken — do not enter 0.',
  },
  submission: {
    headers: [
      'USN', 'Student Name', 'Semester', 'Section', 'Department',
      'Subject', 'Submitted', 'Total Submissions', 'Date',
    ],
    sampleRows: [
      ['1OX21IS001', 'Aarav Sharma', '5', 'A', 'Information Science', 'DBMS', '6', '6', '2026-03-01'],
      ['1OX21IS002', 'Diya Nair', '5', 'A', 'Information Science', 'DBMS', '2', '6', '2026-03-01'],
    ],
    note: 'Submitted / Total Submissions are counts of assignments.',
  },
};

function escapeCell(cell: string): string {
  return /[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

/** CSV text for a blank-but-illustrated template. */
export function templateCsv(recordType: RecordType, includeSamples = true): string {
  const spec = TEMPLATES[recordType];
  const lines = [spec.headers.map(escapeCell).join(',')];
  if (includeSamples) {
    for (const row of spec.sampleRows) lines.push(row.map(escapeCell).join(','));
  }
  return `${lines.join('\n')}\n`;
}

export function templateHeaders(recordType: RecordType): string[] {
  return [...TEMPLATES[recordType].headers];
}

export function templateNote(recordType: RecordType): string {
  return TEMPLATES[recordType].note;
}

export function templateFileName(recordType: RecordType): string {
  return `eduplus-${recordType}-template.csv`;
}
