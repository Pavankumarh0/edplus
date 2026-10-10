import {
  INDICATOR_KEYS,
  INDICATOR_LABELS,
  riskLevelRank,
  type AcademicRecord,
  type Conflict,
  type Escalation,
  type IndicatorKey,
  type IndicatorResult,
  type RiskLevel,
  type RiskRules,
  type RiskSnapshot,
  assertCompleteRules,
} from '../schemas/index';
import { aggregateByType, type AggregatedIndicator, EMPTY_AGGREGATE } from './aggregate';
import { bandSubScore, explainIndicator, levelForScore, round1, round2 } from './score';

/** A sub-score at or below this means the indicator is genuinely healthy. */
export const CONFLICT_STRONG_MAX = 15;
/** A sub-score at or above this means the indicator is clearly concerning. */
export const CONFLICT_WEAK_MIN = 50;

export interface ComputeSnapshotInput {
  usn: string;
  records: AcademicRecord[];
  rules: RiskRules;
  /**
   * The student's most recent snapshot, used for the trend indicator and for
   * `scoreDelta`. Pass null for a student's first ever snapshot.
   */
  previousSnapshot?: RiskSnapshot | null;
  /** Injectable for deterministic tests. */
  now?: Date;
}

/** Deterministic, lexicographically-sortable snapshot id. */
export function makeSnapshotId(usn: string, now: Date): string {
  const compact = now.toISOString().replace(/[-:.]/g, '').replace('Z', 'Z');
  return `${usn}__${compact}`;
}

/**
 * The single source of truth for a student's risk.
 *
 * Pure: no I/O, no clock access beyond the injected `now`, no randomness. The
 * same records plus the same rules always produce the same snapshot, which is
 * what makes a score defensible to a student who asks why they were flagged.
 *
 * Claude never calls this and never adjusts its output — the model explains
 * the score, it does not compute it.
 */
export function computeSnapshot(input: ComputeSnapshotInput): RiskSnapshot {
  const { usn, records, rules } = input;
  assertCompleteRules(rules);

  const now = input.now ?? new Date();
  const previous = input.previousSnapshot ?? null;

  // Only this student's records count, whatever the caller passed in.
  const own = records.filter((r) => r.usn === usn);
  const aggregates = aggregateByType(own);

  // ── Academic composite (higher = healthier) ───────────────────────────────
  // Computed before scoring so the trend indicator has something to diff, and
  // deliberately excluding `trend` itself to avoid feeding a derived value
  // back into its own inputs.
  const academicKeys = ['attendance', 'assessment', 'submission'] as const;
  let compositeWeighted = 0;
  let compositeWeight = 0;
  for (const key of academicKeys) {
    const rule = rules.indicators[key]!;
    const agg = aggregates[key];
    if (agg.value !== null && agg.recordCount >= rule.minRecords) {
      compositeWeighted += agg.value * rule.weight;
      compositeWeight += rule.weight;
    }
  }
  const academicComposite =
    compositeWeight > 0 ? round1(compositeWeighted / compositeWeight) : null;

  // ── Trend ─────────────────────────────────────────────────────────────────
  // Needs both a current and a previous composite. Absent for a first
  // snapshot, and absent again if the previous snapshot itself had too little
  // data to produce a composite.
  const previousComposite = previous?.academicComposite ?? null;
  const trendValue =
    academicComposite !== null && previousComposite !== null
      ? round1(academicComposite - previousComposite)
      : null;

  // ── Score each indicator ──────────────────────────────────────────────────
  const indicators: Partial<Record<IndicatorKey, IndicatorResult>> = {};
  const dataGaps: string[] = [];

  let availableWeight = 0;
  let totalWeight = 0;
  let weightedRisk = 0;

  for (const key of INDICATOR_KEYS) {
    const rule = rules.indicators[key]!;
    totalWeight += rule.weight;

    const agg: AggregatedIndicator =
      key === 'trend'
        ? { ...EMPTY_AGGREGATE, value: trendValue, recordCount: trendValue === null ? 0 : 1 }
        : aggregates[key];

    const hasValue = agg.value !== null;
    const hasEnoughRecords = agg.recordCount >= rule.minRecords;
    // A trend needs a comparable previous snapshot, not a record count.
    const available = key === 'trend' ? trendValue !== null : hasValue && hasEnoughRecords;

    const subScore = available && agg.value !== null ? round1(bandSubScore(agg.value, rule)) : null;

    if (available && subScore !== null) {
      availableWeight += rule.weight;
      weightedRisk += subScore * rule.weight;
    } else {
      dataGaps.push(gapMessage(key, agg.recordCount, rule.minRecords));
    }

    indicators[key] = {
      key,
      available,
      value: agg.value === null ? null : round1(agg.value),
      subScore,
      // Weight shown is the NORMALISED one actually applied, so the UI can
      // explain why a score moved when an indicator went missing.
      weight: 0,
      recordCount: agg.recordCount,
      reason: explainIndicator({
        key,
        value: agg.value,
        available,
        rule,
        recordCount: agg.recordCount,
        totalAchieved: agg.totalAchieved,
        totalPossible: agg.totalPossible,
      }),
    };
  }

  // Re-normalise weights across the indicators that were actually scoreable.
  // This is the heart of the missing-data behaviour: an absent indicator is
  // excluded, never silently scored as zero risk.
  for (const key of INDICATOR_KEYS) {
    const result = indicators[key]!;
    const rule = rules.indicators[key]!;
    result.weight = result.available && availableWeight > 0 ? round1(rule.weight / availableWeight) : 0;
  }

  const score = availableWeight > 0 ? round1(weightedRisk / availableWeight) : 0;

  // Counts ACADEMIC indicators only. `trend` is derived from these same three,
  // so letting it satisfy a data-sufficiency minimum would be circular: a
  // student with nothing but attendance gains a trend on their second upload
  // and would silently stop being flagged as under-evidenced, even though we
  // still know only one thing about them.
  const availableAcademicCount = academicKeys.filter((k) => indicators[k]!.available).length;
  const insufficientData = availableAcademicCount < rules.minIndicatorsForScore;

  const confidence = totalWeight > 0 ? round2(availableWeight / totalWeight) : 0;

  const scoredLevel = levelForScore(score, rules.levelCutoffs);
  const escalation = detectEscalation(
    indicators as Record<IndicatorKey, IndicatorResult>,
    scoredLevel,
    rules,
  );

  return {
    snapshotId: makeSnapshotId(usn, now),
    usn,
    score,
    level: escalation ? escalation.toLevel : scoredLevel,
    escalation,
    academicComposite,
    indicators: indicators as Record<IndicatorKey, IndicatorResult>,
    confidence,
    dataGaps,
    conflicts: detectConflicts(indicators as Record<IndicatorKey, IndicatorResult>),
    insufficientData,
    rulesVersion: rules.rulesVersion,
    previousSnapshotId: previous?.snapshotId ?? null,
    scoreDelta: previous ? round1(score - previous.score) : null,
    createdAt: now.toISOString(),
  };
}

function gapMessage(key: IndicatorKey, recordCount: number, minRecords: number): string {
  if (key === 'trend') {
    return 'No comparable earlier snapshot — trend could not be assessed.';
  }
  if (recordCount === 0) {
    return `No ${key} data uploaded.`;
  }
  return `Only ${recordCount} of the ${minRecords} ${key} records needed to score this indicator.`;
}

/**
 * Finds indicators pointing in materially different directions.
 *
 * Restricted to the three academic indicators. `trend` is excluded on purpose:
 * it is derived from those same three, so pairing it against its own inputs
 * would report arithmetic as disagreement.
 *
 * Why record this at all rather than let the weighted average absorb it:
 * "present every day but failing every test" and "absent and failing" can land
 * on the same score while needing completely different interventions. The
 * average hides that; the conflict list surfaces it.
 */
export function detectConflicts(
  indicators: Record<IndicatorKey, IndicatorResult>,
): Conflict[] {
  const academic = (['attendance', 'assessment', 'submission'] as const)
    .map((key) => indicators[key])
    .filter((r): r is IndicatorResult => Boolean(r?.available) && r?.subScore !== null);

  const conflicts: Conflict[] = [];

  for (const strong of academic) {
    for (const weak of academic) {
      if (strong.key === weak.key) continue;
      const strongScore = strong.subScore!;
      const weakScore = weak.subScore!;
      if (strongScore <= CONFLICT_STRONG_MAX && weakScore >= CONFLICT_WEAK_MIN) {
        conflicts.push({
          strongIndicator: strong.key,
          weakIndicator: weak.key,
          gap: round1(weakScore - strongScore),
          description:
            `${INDICATOR_LABELS[strong.key]} is healthy (${strong.value}%) while ` +
            `${INDICATOR_LABELS[weak.key].toLowerCase()} is a serious concern (${weak.value}%). ` +
            'These point to different causes, so treat them separately rather than as one overall problem.',
        });
      }
    }
  }

  // Largest disagreement first, then alphabetical so the order is stable.
  return conflicts.sort(
    (a, b) => b.gap - a.gap || a.weakIndicator.localeCompare(b.weakIndicator),
  );
}

/**
 * Raises the level when one academic indicator is severe enough on its own.
 *
 * The weighted mean is still the score — this only moves the LEVEL, and only
 * upward to a configured floor. Separating the two keeps the score honest
 * (it remains a plain weighted mean anyone can recompute by hand) while
 * ensuring a student failing every assessment is not filed under "Watch"
 * because they turn up to class.
 *
 * `trend` is excluded, as everywhere else in this engine: it is derived from
 * the academic indicators, so escalating on it would double-count them.
 */
export function detectEscalation(
  indicators: Record<IndicatorKey, IndicatorResult>,
  scoredLevel: RiskLevel,
  rules: RiskRules,
): Escalation | null {
  const config = rules.escalation;
  if (!config?.enabled) return null;

  // Only ever escalates upward.
  if (riskLevelRank(scoredLevel) >= riskLevelRank(config.minimumLevel)) return null;

  const triggeredBy = (['attendance', 'assessment', 'submission'] as const).filter((key) => {
    const indicator = indicators[key];
    return (
      indicator?.available &&
      indicator.subScore !== null &&
      indicator.subScore >= config.singleIndicatorSubScore
    );
  });

  if (triggeredBy.length === 0) return null;

  const names = triggeredBy.map((k) => INDICATOR_LABELS[k].toLowerCase()).join(' and ');

  return {
    triggeredBy: [...triggeredBy],
    fromLevel: scoredLevel,
    toLevel: config.minimumLevel,
    reason:
      `Raised from ${scoredLevel.replace('_', ' ')} because ${names} alone is severe enough ` +
      'to need attention, even though the other indicators pull the overall score down.',
  };
}
