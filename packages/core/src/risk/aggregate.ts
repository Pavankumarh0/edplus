import type { AcademicRecord, RecordType } from '../schemas/index';

export interface AggregatedIndicator {
  /** Percentage 0–100, where higher is healthier. Null when no records. */
  value: number | null;
  recordCount: number;
  /** Sum of the denominators, e.g. total classes held. Used in explanations. */
  totalPossible: number;
  /** Sum of the numerators, e.g. total classes attended. */
  totalAchieved: number;
  subjects: string[];
}

export const EMPTY_AGGREGATE: AggregatedIndicator = {
  value: null,
  recordCount: 0,
  totalPossible: 0,
  totalAchieved: 0,
  subjects: [],
};

/**
 * Collapses many records of one type into a single percentage.
 *
 * Sums numerators and denominators rather than averaging per-record
 * percentages. This matters: a student who attended 5/50 classes in one
 * subject and 10/10 in another is at 15/60 = 25%, not the 55% that averaging
 * percentages would report. Averaging percentages lets a small subject mask a
 * large failure, which is precisely the student this system exists to catch.
 */
export function aggregateRecords(records: AcademicRecord[]): AggregatedIndicator {
  if (records.length === 0) return { ...EMPTY_AGGREGATE };

  let totalAchieved = 0;
  let totalPossible = 0;
  const subjects = new Set<string>();

  for (const record of records) {
    totalAchieved += record.value;
    totalPossible += record.maxValue;
    subjects.add(record.subject);
  }

  return {
    value: totalPossible > 0 ? (totalAchieved / totalPossible) * 100 : null,
    recordCount: records.length,
    totalPossible,
    totalAchieved,
    subjects: [...subjects].sort(),
  };
}

/** Groups a student's records by type and aggregates each group. */
export function aggregateByType(
  records: AcademicRecord[],
): Record<RecordType, AggregatedIndicator> {
  const buckets: Record<RecordType, AcademicRecord[]> = {
    attendance: [],
    assessment: [],
    submission: [],
  };

  for (const record of records) {
    buckets[record.type].push(record);
  }

  return {
    attendance: aggregateRecords(buckets.attendance),
    assessment: aggregateRecords(buckets.assessment),
    submission: aggregateRecords(buckets.submission),
  };
}
