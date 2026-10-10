import { describe, expect, it } from 'vitest';
import {
  finaliseMapping,
  heuristicMapping,
  heuristicsAreSufficient,
  normaliseHeader,
} from './mapping';
import { normaliseDate, normaliseLanguage, normalisePhone, parseNumber } from './normalise';
import { buildImport, parseCsv } from './parse';
import { templateCsv, templateHeaders } from './template';
import type { ColumnMapping } from '../schemas/index';

describe('normaliseHeader', () => {
  it('strips case and punctuation', () => {
    expect(normaliseHeader('Classes Attended')).toBe('classesattended');
    expect(normaliseHeader('Max_Marks')).toBe('maxmarks');
    expect(normaliseHeader('  USN  ')).toBe('usn');
    expect(normaliseHeader('Parent Phone (Mobile)')).toBe('parentphonemobile');
  });
});

describe('heuristicMapping', () => {
  it('maps a clean attendance sheet with no help from an LLM', () => {
    const result = heuristicMapping(
      ['USN', 'Student Name', 'Subject', 'Classes Attended', 'Classes Held', 'Date'],
      'attendance',
    );
    expect(result.mapping.usn).toBe('USN');
    expect(result.mapping.name).toBe('Student Name');
    expect(result.mapping.subject).toBe('Subject');
    expect(result.mapping.value).toBe('Classes Attended');
    expect(result.mapping.maxValue).toBe('Classes Held');
    expect(result.mapping.date).toBe('Date');
    expect(heuristicsAreSufficient(result)).toBe(true);
    expect(result.unresolvedRequired).toEqual([]);
  });

  it('maps a marks sheet, reading the same words differently', () => {
    const result = heuristicMapping(
      ['Roll No', 'Subject', 'Marks Obtained', 'Max Marks'],
      'assessment',
    );
    expect(result.mapping.usn).toBe('Roll No');
    expect(result.mapping.value).toBe('Marks Obtained');
    expect(result.mapping.maxValue).toBe('Max Marks');
  });

  it('resolves an ambiguous "Total" column per record type', () => {
    // "Total" means classes held in an attendance sheet...
    const attendance = heuristicMapping(['USN', 'Attended', 'Total'], 'attendance');
    expect(attendance.mapping.value).toBe('Attended');
    expect(attendance.mapping.maxValue).toBe('Total');

    // ...and maximum marks in a marks sheet.
    const marks = heuristicMapping(['USN', 'Scored', 'Total'], 'assessment');
    expect(marks.mapping.value).toBe('Scored');
    expect(marks.mapping.maxValue).toBe('Total');
  });

  it('never assigns one header to two fields', () => {
    const result = heuristicMapping(['USN', 'Marks', 'Total'], 'assessment');
    const used = Object.values(result.mapping);
    expect(new Set(used).size).toBe(used.length);
  });

  it('prefers a specific header over a vague one', () => {
    const result = heuristicMapping(['USN', 'Total', 'Marks Obtained'], 'assessment');
    // "marksobtained" is pattern 0; "marks" is later in the list.
    expect(result.mapping.value).toBe('Marks Obtained');
    expect(result.mapping.maxValue).toBe('Total');
  });

  it('picks up parent contact columns', () => {
    const result = heuristicMapping(
      ['USN', 'Attended', 'Held', 'Parent Name', 'Parent Mobile', 'Preferred Language'],
      'attendance',
    );
    expect(result.mapping.parentName).toBe('Parent Name');
    expect(result.mapping.parentPhone).toBe('Parent Mobile');
    expect(result.mapping.parentLanguage).toBe('Preferred Language');
  });

  it('reports unresolved required fields for genuinely messy headers', () => {
    const result = heuristicMapping(['Col1', 'Col2', 'Col3'], 'attendance');
    expect(heuristicsAreSufficient(result)).toBe(false);
    expect(result.unresolvedRequired).toContain('usn');
    expect(result.unresolvedRequired).toContain('value');
    expect(result.unusedHeaders).toEqual(['Col1', 'Col2', 'Col3']);
  });

  it('lists headers it did not use, so the preview can show them', () => {
    const result = heuristicMapping(['USN', 'Attended', 'Held', 'Remarks'], 'attendance');
    expect(result.unusedHeaders).toEqual(['Remarks']);
  });

  it('recognises every column in its own templates', () => {
    for (const type of ['attendance', 'assessment', 'submission'] as const) {
      const result = heuristicMapping(templateHeaders(type), type);
      expect(heuristicsAreSufficient(result), `${type} template`).toBe(true);
      expect(result.unusedHeaders, `${type} unused`).toEqual([]);
    }
  });
});

describe('finaliseMapping', () => {
  const headers = ['USN', 'Marks', 'Max'];

  it('fills absent optional fields with null', () => {
    const mapping = finaliseMapping({ usn: 'USN', value: 'Marks' }, headers);
    expect(mapping.usn).toBe('USN');
    expect(mapping.subject).toBeNull();
    expect(mapping.parentPhone).toBeNull();
  });

  it('refuses a mapping missing a required field', () => {
    expect(() => finaliseMapping({ usn: 'USN' }, headers)).toThrow(/Cannot import without/);
  });

  it('rejects a column name that is not in the file — the hallucination guard', () => {
    expect(() => finaliseMapping({ usn: 'USN', value: 'Imaginary Column' }, headers)).toThrow(
      /not in the file/,
    );
  });
});

describe('normalisePhone', () => {
  it('accepts the shapes a college spreadsheet actually contains', () => {
    expect(normalisePhone('9876543210')).toBe('+919876543210');
    expect(normalisePhone('09876543210')).toBe('+919876543210');
    expect(normalisePhone('919876543210')).toBe('+919876543210');
    expect(normalisePhone('+91 98765 43210')).toBe('+919876543210');
    expect(normalisePhone('+91-98765-43210')).toBe('+919876543210');
  });

  it('refuses what it cannot place, rather than guessing', () => {
    expect(normalisePhone('')).toBeNull();
    expect(normalisePhone('   ')).toBeNull();
    expect(normalisePhone('12345')).toBeNull();
    expect(normalisePhone('not a phone')).toBeNull();
    // 10 digits but not a valid Indian mobile prefix.
    expect(normalisePhone('1234567890')).toBeNull();
  });

  it('passes through an explicit international number', () => {
    expect(normalisePhone('+14155551234')).toBe('+14155551234');
  });
});

describe('normaliseLanguage', () => {
  it('maps language names to Sarvam codes', () => {
    expect(normaliseLanguage('Kannada')).toBe('kn-IN');
    expect(normaliseLanguage('hindi')).toBe('hi-IN');
    expect(normaliseLanguage('English')).toBe('en-IN');
    expect(normaliseLanguage('Malayalam')).toBe('ml-IN');
  });

  it('accepts codes already in the right shape', () => {
    expect(normaliseLanguage('kn-IN')).toBe('kn-IN');
    expect(normaliseLanguage('hi')).toBe('hi-IN');
  });

  it('falls back to English rather than dropping the contact', () => {
    expect(normaliseLanguage(null)).toBe('en-IN');
    expect(normaliseLanguage('Klingon')).toBe('en-IN');
  });
});

describe('normaliseDate', () => {
  const fallback = '2026-03-01';

  it('passes ISO through untouched', () => {
    expect(normaliseDate('2026-04-03', fallback)).toBe('2026-04-03');
  });

  it('reads ambiguous slash dates day-first, per local convention', () => {
    expect(normaliseDate('03/04/2026', fallback)).toBe('2026-04-03');
    expect(normaliseDate('25-12-2026', fallback)).toBe('2026-12-25');
  });

  it('expands two-digit years', () => {
    expect(normaliseDate('03/04/26', fallback)).toBe('2026-04-03');
  });

  it('anchors a month-year sheet to the first of the month', () => {
    expect(normaliseDate('March 2026', fallback)).toBe('2026-03-01');
    expect(normaliseDate('Mar-2026', fallback)).toBe('2026-03-01');
  });

  it('falls back when it cannot tell', () => {
    expect(normaliseDate('', fallback)).toBe(fallback);
    expect(normaliseDate(null, fallback)).toBe(fallback);
    expect(normaliseDate('sometime last term', fallback)).toBe(fallback);
    expect(normaliseDate('45/45/2026', fallback)).toBe(fallback);
  });
});

describe('parseNumber', () => {
  it('tolerates separators and percent signs', () => {
    expect(parseNumber('1,234')).toBe(1234);
    expect(parseNumber('62%')).toBe(62);
    expect(parseNumber(' 38 ')).toBe(38);
    expect(parseNumber('45.5')).toBe(45.5);
  });

  it('returns null for an empty cell instead of zero', () => {
    // This is the whole point: a blank mark is not a zero mark.
    expect(parseNumber('')).toBeNull();
    expect(parseNumber('   ')).toBeNull();
    expect(parseNumber(null)).toBeNull();
    expect(parseNumber(undefined)).toBeNull();
  });

  it('returns null for non-numbers', () => {
    expect(parseNumber('absent')).toBeNull();
    expect(parseNumber('N/A')).toBeNull();
    expect(parseNumber('12abc')).toBeNull();
  });
});

describe('parseCsv', () => {
  it('handles quoted fields containing commas', () => {
    const { headers, rows } = parseCsv('USN,Subject\n1OX21IS001,"Maths, Applied"\n');
    expect(headers).toEqual(['USN', 'Subject']);
    expect(rows[0]!.Subject).toBe('Maths, Applied');
  });

  it('trims headers and values', () => {
    const { headers, rows } = parseCsv(' USN , Marks \n 1OX21IS001 , 34 \n');
    expect(headers).toEqual(['USN', 'Marks']);
    expect(rows[0]!.USN).toBe('1OX21IS001');
    expect(rows[0]!.Marks).toBe('34');
  });

  it('skips blank lines', () => {
    const { rows } = parseCsv('USN,Marks\n1OX21IS001,34\n\n\n1OX21IS002,20\n');
    expect(rows).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

const ASSESSMENT_MAPPING: ColumnMapping = {
  usn: 'USN',
  name: 'Student Name',
  subject: 'Subject',
  value: 'Marks Obtained',
  maxValue: 'Max Marks',
  date: 'Date',
  semester: null,
  section: null,
  department: null,
  parentName: null,
  parentPhone: null,
  parentLanguage: null,
};

function runImport(csv: string, mapping: ColumnMapping = ASSESSMENT_MAPPING) {
  const { rows } = parseCsv(csv);
  return buildImport(rows, {
    recordType: 'assessment',
    mapping,
    uploadId: 'upload-test',
    defaultDate: '2026-03-01',
  });
}

describe('buildImport', () => {
  it('builds records and student upserts from a clean file', () => {
    const result = runImport(
      'USN,Student Name,Subject,Marks Obtained,Max Marks,Date\n' +
        '1OX21IS001,Aarav Sharma,DBMS,34,50,2026-03-01\n' +
        '1OX21IS002,Diya Nair,DBMS,11,50,2026-03-01\n',
    );
    expect(result.rowsTotal).toBe(2);
    expect(result.rowsOk).toBe(2);
    expect(result.rowsRejected).toBe(0);
    expect(result.errors).toEqual([]);
    expect(result.records).toHaveLength(2);
    expect(result.students.map((s) => s.name)).toEqual(['Aarav Sharma', 'Diya Nair']);
    expect(result.affectedUsns).toEqual(['1OX21IS001', '1OX21IS002']);
  });

  it('normalises the USN so the same student always lands on one document', () => {
    const result = runImport(
      'USN,Student Name,Subject,Marks Obtained,Max Marks,Date\n' +
        ' 1ox21is001 ,Aarav,DBMS,34,50,2026-03-01\n',
    );
    expect(result.records[0]!.usn).toBe('1OX21IS001');
  });

  it('rejects a blank mark with an actionable reason instead of storing zero', () => {
    const result = runImport(
      'USN,Student Name,Subject,Marks Obtained,Max Marks,Date\n' +
        '1OX21IS001,Aarav,DBMS,,50,2026-03-01\n',
    );
    expect(result.rowsOk).toBe(0);
    expect(result.rowsRejected).toBe(1);
    expect(result.records).toHaveLength(0);
    const error = result.errors[0]!;
    expect(error.row).toBe(2);
    expect(error.field).toBe('value');
    expect(error.message).toMatch(/not a number/);
  });

  it('numbers error rows the way the spreadsheet does', () => {
    const result = runImport(
      'USN,Student Name,Subject,Marks Obtained,Max Marks,Date\n' +
        '1OX21IS001,A,DBMS,34,50,2026-03-01\n' +
        '1OX21IS002,B,DBMS,,50,2026-03-01\n' +
        '1OX21IS003,C,DBMS,20,50,2026-03-01\n',
    );
    // The bad row is the third line of the file = spreadsheet row 3.
    expect(result.errors[0]!.row).toBe(3);
    expect(result.rowsOk).toBe(2);
  });

  it('rejects a row whose value exceeds its maximum', () => {
    const result = runImport(
      'USN,Student Name,Subject,Marks Obtained,Max Marks,Date\n' +
        '1OX21IS001,Aarav,DBMS,60,50,2026-03-01\n',
    );
    expect(result.rowsRejected).toBe(1);
    expect(result.errors.some((e) => /cannot exceed/.test(e.message))).toBe(true);
  });

  it('rejects a row with a missing USN', () => {
    const result = runImport(
      'USN,Student Name,Subject,Marks Obtained,Max Marks,Date\n' +
        ',Nameless,DBMS,34,50,2026-03-01\n',
    );
    expect(result.rowsRejected).toBe(1);
    expect(result.errors[0]!.field).toBe('usn');
  });

  it('keeps good rows when other rows fail', () => {
    const result = runImport(
      'USN,Student Name,Subject,Marks Obtained,Max Marks,Date\n' +
        '1OX21IS001,A,DBMS,34,50,2026-03-01\n' +
        ',B,DBMS,20,50,2026-03-01\n' +
        '1OX21IS003,C,DBMS,45,50,2026-03-01\n',
    );
    expect(result.rowsOk).toBe(2);
    expect(result.rowsRejected).toBe(1);
  });

  it('collapses duplicate rows idempotently', () => {
    const result = runImport(
      'USN,Student Name,Subject,Marks Obtained,Max Marks,Date\n' +
        '1OX21IS001,Aarav,DBMS,34,50,2026-03-01\n' +
        '1OX21IS001,Aarav,DBMS,40,50,2026-03-01\n',
    );
    expect(result.records).toHaveLength(1);
    expect(result.duplicatesCollapsed).toBe(1);
    // Later row wins, so a corrected re-upload takes effect.
    expect(result.records[0]!.value).toBe(40);
  });

  it('produces stable record ids across two different uploads', () => {
    const csv =
      'USN,Student Name,Subject,Marks Obtained,Max Marks,Date\n' +
      '1OX21IS001,Aarav,DBMS,34,50,2026-03-01\n';
    const { rows } = parseCsv(csv);
    const first = buildImport(rows, {
      recordType: 'assessment', mapping: ASSESSMENT_MAPPING,
      uploadId: 'upload-A', defaultDate: '2026-03-01',
    });
    const second = buildImport(rows, {
      recordType: 'assessment', mapping: ASSESSMENT_MAPPING,
      uploadId: 'upload-B', defaultDate: '2026-03-01',
    });
    // Same fact from two uploads must overwrite, not duplicate.
    expect(first.records[0]!.recordId).toBe(second.records[0]!.recordId);
    expect(first.records[0]!.sourceUploadId).not.toBe(second.records[0]!.sourceUploadId);
  });

  it('treats the value column as a percentage when no maximum is mapped, and says so', () => {
    const mapping: ColumnMapping = { ...ASSESSMENT_MAPPING, maxValue: null };
    const { rows } = parseCsv(
      'USN,Student Name,Subject,Marks Obtained,Date\n1OX21IS001,Aarav,DBMS,62,2026-03-01\n',
    );
    const result = buildImport(rows, {
      recordType: 'assessment', mapping, uploadId: 'u', defaultDate: '2026-03-01',
    });
    expect(result.records[0]!.value).toBe(62);
    expect(result.records[0]!.maxValue).toBe(100);
    expect(result.warnings.some((w) => /percentage out of 100/.test(w))).toBe(true);
  });

  it('warns and defaults when subject or date are unmapped', () => {
    const mapping: ColumnMapping = { ...ASSESSMENT_MAPPING, subject: null, date: null };
    const { rows } = parseCsv(
      'USN,Student Name,Marks Obtained,Max Marks\n1OX21IS001,Aarav,34,50\n',
    );
    const result = buildImport(rows, {
      recordType: 'assessment', mapping, uploadId: 'u', defaultDate: '2026-03-01',
    });
    expect(result.records[0]!.subject).toBe('General');
    expect(result.records[0]!.date).toBe('2026-03-01');
    expect(result.warnings.some((w) => /General/.test(w))).toBe(true);
    expect(result.warnings.some((w) => /dated 2026-03-01/.test(w))).toBe(true);
  });

  it('imports the academic record even when the parent phone is unusable', () => {
    const mapping: ColumnMapping = {
      ...ASSESSMENT_MAPPING, parentName: 'Parent Name', parentPhone: 'Parent Phone',
    };
    const { rows } = parseCsv(
      'USN,Student Name,Subject,Marks Obtained,Max Marks,Date,Parent Name,Parent Phone\n' +
        '1OX21IS001,Aarav,DBMS,34,50,2026-03-01,Rajesh,12345\n',
    );
    const result = buildImport(rows, {
      recordType: 'assessment', mapping, uploadId: 'u', defaultDate: '2026-03-01',
    });
    expect(result.records).toHaveLength(1);
    expect(result.rowsOk).toBe(1);
    expect(result.students[0]!.parent).toBeUndefined();
    expect(result.errors.some((e) => e.field === 'parentPhone')).toBe(true);
  });

  it('attaches a normalised parent contact when the phone is valid', () => {
    const mapping: ColumnMapping = {
      ...ASSESSMENT_MAPPING,
      parentName: 'Parent Name', parentPhone: 'Parent Phone', parentLanguage: 'Language',
    };
    const { rows } = parseCsv(
      'USN,Student Name,Subject,Marks Obtained,Max Marks,Date,Parent Name,Parent Phone,Language\n' +
        '1OX21IS001,Aarav,DBMS,34,50,2026-03-01,Rajesh Sharma,9876543210,Kannada\n',
    );
    const result = buildImport(rows, {
      recordType: 'assessment', mapping, uploadId: 'u', defaultDate: '2026-03-01',
    });
    expect(result.students[0]!.parent).toEqual({
      name: 'Rajesh Sharma',
      phone: '+919876543210',
      preferredLanguage: 'kn-IN',
    });
  });

  it('merges student details across several rows for the same student', () => {
    const mapping: ColumnMapping = { ...ASSESSMENT_MAPPING, semester: 'Sem', section: 'Sec' };
    const { rows } = parseCsv(
      'USN,Student Name,Subject,Marks Obtained,Max Marks,Date,Sem,Sec\n' +
        '1OX21IS001,Aarav,DBMS,34,50,2026-03-01,5,A\n' +
        '1OX21IS001,Aarav,OS,40,50,2026-03-01,5,A\n',
    );
    const result = buildImport(rows, {
      recordType: 'assessment', mapping, uploadId: 'u', defaultDate: '2026-03-01',
    });
    expect(result.students).toHaveLength(1);
    expect(result.students[0]!.semester).toBe(5);
    expect(result.students[0]!.section).toBe('A');
    expect(result.records).toHaveLength(2);
  });

  it('ignores an out-of-range semester rather than storing it', () => {
    const mapping: ColumnMapping = { ...ASSESSMENT_MAPPING, semester: 'Sem' };
    const { rows } = parseCsv(
      'USN,Student Name,Subject,Marks Obtained,Max Marks,Date,Sem\n' +
        '1OX21IS001,Aarav,DBMS,34,50,2026-03-01,99\n',
    );
    const result = buildImport(rows, {
      recordType: 'assessment', mapping, uploadId: 'u', defaultDate: '2026-03-01',
    });
    expect(result.students[0]!.semester).toBeUndefined();
  });

  it('handles an empty file without crashing', () => {
    const result = runImport('USN,Student Name,Subject,Marks Obtained,Max Marks,Date\n');
    expect(result.rowsTotal).toBe(0);
    expect(result.records).toHaveLength(0);
    expect(result.affectedUsns).toEqual([]);
  });
});

describe('templateCsv', () => {
  it('round-trips through its own importer with zero rejections', () => {
    // The strongest guarantee we can offer: a file built from our template
    // imports cleanly through the heuristic path alone.
    for (const type of ['attendance', 'assessment', 'submission'] as const) {
      const csv = templateCsv(type);
      const { headers, rows } = parseCsv(csv);
      const heuristic = heuristicMapping(headers, type);
      const mapping = finaliseMapping(heuristic.mapping, headers);
      const result = buildImport(rows, {
        recordType: type, mapping, uploadId: 'u', defaultDate: '2026-03-01',
      });
      expect(result.rowsRejected, `${type} rejected`).toBe(0);
      expect(result.rowsOk, `${type} ok`).toBe(2);
    }
  });

  it('can emit headers only', () => {
    const csv = templateCsv('assessment', false);
    expect(csv.trim().split('\n')).toHaveLength(1);
  });
});
