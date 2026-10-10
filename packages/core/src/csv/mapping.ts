import {
  ColumnMappingSchema,
  type ColumnMapping,
  type RecordType,
} from '../schemas/index';

export type MappingField = keyof ColumnMapping;

/** Fields that must be resolved before an import can run at all. */
export const REQUIRED_FIELDS: MappingField[] = ['usn', 'value'];

/**
 * Normalises a header for comparison: lowercase, alphanumerics only.
 * "Classes Attended" → "classesattended", "Max_Marks" → "maxmarks".
 */
export function normaliseHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Header patterns per field, most specific first.
 *
 * `value` and `maxValue` are deliberately absent here: what counts as "the
 * number" depends entirely on what is being uploaded, so they come from
 * `VALUE_PATTERNS` below. A column called "Total" means classes held in an
 * attendance sheet and maximum marks in a marks sheet.
 */
const SHARED_PATTERNS: Partial<Record<MappingField, RegExp[]>> = {
  usn: [/^usn$/, /universityseat/, /^rollno?$/, /^rollnumber$/, /^regn?o$/, /registration/, /^studentid$/, /^sid$/],
  name: [/^studentname$/, /^name$/, /^fullname$/, /^student$/],
  subject: [/^subjectname$/, /^subjectcode$/, /^subject$/, /^course(name|code)?$/, /^paper$/],
  date: [/^date$/, /^recordeddate$/, /^asof(date)?$/, /^month$/, /^period$/, /^examdate$/],
  semester: [/^semester$/, /^sem$/],
  section: [/^section$/, /^sec$/, /^div(ision)?$/],
  department: [/^department$/, /^dept$/, /^branch$/, /^stream$/],
  parentName: [/^parentname$/, /parentsname/, /^guardian(name)?$/, /^fathername$/, /^mothername$/],
  parentPhone: [/parent.*(phone|mobile|contact|number)/, /guardian.*(phone|mobile|contact)/, /^parentno$/, /^contact(no|number)$/, /^mobile$/, /^phone$/],
  parentLanguage: [/parent.*lang/, /preferred.*lang/, /^language$/, /^lang$/],
};

/** Per-record-type patterns for the two numeric columns. */
const VALUE_PATTERNS: Record<RecordType, { value: RegExp[]; maxValue: RegExp[] }> = {
  attendance: {
    value: [/^classesattended$/, /^attended$/, /^present$/, /^presentdays$/, /^attendedclasses$/, /^noofclassesattended$/],
    maxValue: [/^classesheld$/, /^totalclasses$/, /^conducted$/, /^classesconducted$/, /^totaldays$/, /^held$/, /^total$/],
  },
  assessment: {
    value: [/^marksobtained$/, /^marksscored$/, /^obtained$/, /^scored$/, /^marks$/, /^score$/, /^internalmarks$/, /^cie$/],
    maxValue: [/^maxmarks$/, /^maximummarks$/, /^outof$/, /^totalmarks$/, /^maximum$/, /^max$/, /^total$/],
  },
  submission: {
    value: [/^submitted$/, /^submissionsmade$/, /^submissionsdone$/, /^completed$/, /^submissions$/, /^done$/],
    maxValue: [/^totalsubmissions$/, /^expected$/, /^assigned$/, /^expectedsubmissions$/, /^totalassignments$/, /^total$/],
  },
};

export interface HeuristicMatch {
  field: MappingField;
  header: string;
  /** 1 = exact pattern hit at the top of the list, lower = weaker match. */
  score: number;
}

export interface HeuristicResult {
  mapping: Partial<Record<MappingField, string>>;
  matches: HeuristicMatch[];
  /** Required fields the heuristics could not resolve. */
  unresolvedRequired: MappingField[];
  /** Optional fields not found — fine to leave null. */
  unresolvedOptional: MappingField[];
  /** Headers in the file that were not used by any field. */
  unusedHeaders: string[];
  /** Mean score of the matches found, 0–1. */
  confidence: number;
}

function patternsFor(field: MappingField, recordType: RecordType): RegExp[] {
  if (field === 'value') return VALUE_PATTERNS[recordType].value;
  if (field === 'maxValue') return VALUE_PATTERNS[recordType].maxValue;
  return SHARED_PATTERNS[field] ?? [];
}

const ALL_FIELDS: MappingField[] = [
  'usn', 'name', 'subject', 'value', 'maxValue', 'date',
  'semester', 'section', 'department', 'parentName', 'parentPhone', 'parentLanguage',
];

/**
 * Tries to map headers to fields without calling an LLM.
 *
 * Runs first and, on the sample data and any sanely-named sheet, resolves
 * everything — so the common case costs no tokens, no latency and cannot
 * hallucinate. Claude is the fallback for genuinely messy headers, not the
 * default path.
 *
 * Earlier patterns in each list score higher, so a column literally named
 * "marks_obtained" beats a vaguer "total" when both could match.
 */
export function heuristicMapping(headers: string[], recordType: RecordType): HeuristicResult {
  const normalised = headers.map((h) => ({ raw: h, norm: normaliseHeader(h) }));

  const matches: HeuristicMatch[] = [];
  const mapping: Partial<Record<MappingField, string>> = {};
  const claimed = new Set<string>();

  // Two passes so that a strong match always wins a shared header like
  // "Total" over a weaker one, regardless of field order.
  const candidates: HeuristicMatch[] = [];
  for (const field of ALL_FIELDS) {
    const patterns = patternsFor(field, recordType);
    for (const { raw, norm } of normalised) {
      const index = patterns.findIndex((p) => p.test(norm));
      if (index === -1) continue;
      candidates.push({
        field,
        header: raw,
        // First pattern → 1.0, decaying gently for later ones.
        score: 1 - index / (patterns.length + 1),
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score || a.field.localeCompare(b.field));

  for (const candidate of candidates) {
    if (mapping[candidate.field]) continue;
    if (claimed.has(candidate.header)) continue;
    mapping[candidate.field] = candidate.header;
    claimed.add(candidate.header);
    matches.push(candidate);
  }

  const unresolvedRequired = REQUIRED_FIELDS.filter((f) => !mapping[f]);
  const unresolvedOptional = ALL_FIELDS.filter(
    (f) => !mapping[f] && !REQUIRED_FIELDS.includes(f),
  );
  const unusedHeaders = headers.filter((h) => !claimed.has(h));

  const confidence =
    matches.length === 0 ? 0 : matches.reduce((sum, m) => sum + m.score, 0) / matches.length;

  return {
    mapping,
    matches,
    unresolvedRequired,
    unresolvedOptional,
    unusedHeaders,
    confidence: Math.round(confidence * 100) / 100,
  };
}

/** True when the heuristics alone are enough and Claude need not be called. */
export function heuristicsAreSufficient(result: HeuristicResult): boolean {
  return result.unresolvedRequired.length === 0;
}

/**
 * Turns a partial mapping into a validated `ColumnMapping`, filling absent
 * optional fields with null.
 *
 * Throws when a required field is missing or when a mapped header is not
 * actually present in the file — the second check is what stops a hallucinated
 * column name from reaching the importer.
 */
export function finaliseMapping(
  partial: Partial<Record<MappingField, string>>,
  headers: string[],
): ColumnMapping {
  const missing = REQUIRED_FIELDS.filter((f) => !partial[f]);
  if (missing.length > 0) {
    throw new Error(`Cannot import without a column for: ${missing.join(', ')}`);
  }

  const headerSet = new Set(headers);
  for (const [field, header] of Object.entries(partial)) {
    if (header && !headerSet.has(header)) {
      throw new Error(
        `Mapping points "${field}" at a column named "${header}", which is not in the file. ` +
          `Available columns: ${headers.join(', ')}`,
      );
    }
  }

  return ColumnMappingSchema.parse({
    usn: partial.usn,
    value: partial.value,
    name: partial.name ?? null,
    subject: partial.subject ?? null,
    maxValue: partial.maxValue ?? null,
    date: partial.date ?? null,
    semester: partial.semester ?? null,
    section: partial.section ?? null,
    department: partial.department ?? null,
    parentName: partial.parentName ?? null,
    parentPhone: partial.parentPhone ?? null,
    parentLanguage: partial.parentLanguage ?? null,
  });
}
