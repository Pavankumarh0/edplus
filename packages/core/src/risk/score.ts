import {
  type IndicatorKey,
  type IndicatorRule,
  type LevelCutoffs,
  type RiskLevel,
} from '../schemas/index.js';

/**
 * Converts a measured value into a 0–100 risk sub-score.
 *
 *   value >= threshold   → 0   (no risk)
 *   value <= criticalAt  → 100 (maximum risk)
 *   between              → linear
 *
 * One formula serves all four indicators because `trend` is configured with
 * a threshold of 0 and a negative `criticalAt`, so "a value below a bar I
 * care about" describes a falling trend just as well as low attendance.
 *
 * Deliberately NOT smoothed or curved: a faculty member who moves the
 * attendance threshold from 75 to 70 should be able to predict what happens
 * to the score, and a linear band is the only shape that reads honestly off
 * the Risk Rules page.
 */
export function bandSubScore(value: number, rule: Pick<IndicatorRule, 'threshold' | 'criticalAt'>): number {
  const { threshold, criticalAt } = rule;
  if (threshold <= criticalAt) {
    throw new Error(
      `Invalid indicator rule: threshold (${threshold}) must exceed criticalAt (${criticalAt})`,
    );
  }
  if (value >= threshold) return 0;
  if (value <= criticalAt) return 100;
  return ((threshold - value) / (threshold - criticalAt)) * 100;
}

/** Maps a 0–100 risk score onto a level using the configured cut-offs. */
export function levelForScore(score: number, cutoffs: LevelCutoffs): RiskLevel {
  if (score >= cutoffs.critical) return 'critical';
  if (score >= cutoffs.atRisk) return 'at_risk';
  if (score >= cutoffs.watch) return 'watch';
  return 'stable';
}

/** Rounds to one decimal place — enough precision to show movement, not
 *  enough to imply false exactness. */
export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Rounds to two decimal places. Used for `confidence`, where a 0..1 scale
 *  makes one decimal too coarse to be meaningful (0.35 would show as 0.4). */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/**
 * The plain-language sentence shown in the UI, quoted in Claude's report and
 * returned by the `get_risk_breakdown` tool.
 *
 * Generated in one place on purpose: if the dashboard and the report explained
 * the same number differently, nobody would trust either.
 */
export function explainIndicator(input: {
  key: IndicatorKey;
  value: number | null;
  available: boolean;
  rule: IndicatorRule;
  recordCount: number;
  totalAchieved?: number;
  totalPossible?: number;
}): string {
  const { key, value, available, rule, recordCount } = input;

  if (key === 'trend') {
    if (!available || value === null) {
      return 'No earlier snapshot to compare against — this is the first assessment of this student.';
    }
    const magnitude = Math.abs(round1(value));
    if (magnitude < 0.5) {
      return 'Academic health is unchanged since the previous snapshot.';
    }
    if (value < 0) {
      return `Academic health fell ${magnitude} points since the previous snapshot (a drop of ${Math.abs(rule.criticalAt)} points counts as maximum concern).`;
    }
    return `Academic health rose ${magnitude} points since the previous snapshot.`;
  }

  const label =
    key === 'attendance' ? 'Attendance' : key === 'assessment' ? 'Assessment average' : 'Submission completion';

  if (!available || value === null) {
    if (recordCount === 0) {
      return `No ${key} records have been uploaded for this student yet.`;
    }
    return `Only ${recordCount} ${key} record${recordCount === 1 ? '' : 's'} available — below the ${rule.minRecords} needed to score this indicator.`;
  }

  const shown = round1(value);
  const counts =
    input.totalPossible && input.totalPossible > 0
      ? ` (${round1(input.totalAchieved ?? 0)} of ${round1(input.totalPossible)})`
      : '';

  if (value >= rule.threshold) {
    return `${label} ${shown}%${counts} — at or above the ${rule.threshold}% threshold.`;
  }
  if (value <= rule.criticalAt) {
    return `${label} ${shown}%${counts} — at or below the ${rule.criticalAt}% critical floor.`;
  }
  return `${label} ${shown}%${counts} — below the ${rule.threshold}% threshold.`;
}
