import { z } from 'zod';
import { IndicatorKeySchema, IsoDateTimeSchema, RiskLevelSchema, UsnSchema } from './common.js';

/**
 * The engine's verdict on one indicator.
 *
 * `available: false` means the indicator could not be scored (no records, or
 * fewer than `minRecords`). It is then excluded from the weighted score
 * entirely rather than being treated as 0 — treating missing data as "fine"
 * is the single most dangerous thing an early-warning system can do.
 */
export const IndicatorResultSchema = z.object({
  key: IndicatorKeySchema,
  available: z.boolean(),
  /** Measured value: a percentage, or signed percentage points for `trend`. */
  value: z.number().nullable(),
  /** 0–100 risk contribution before weighting. Higher = worse. */
  subScore: z.number().min(0).max(100).nullable(),
  /** Normalised weight actually applied (0 when unavailable). */
  weight: z.number().min(0).max(1),
  /** How many academic records backed this indicator. */
  recordCount: z.number().int().min(0),
  /**
   * Plain-language explanation, pre-rendered by the engine so that the UI,
   * the Claude report and the MCP tools all quote the same sentence.
   * e.g. "Attendance 62% — below the 75% threshold."
   */
  reason: z.string(),
});

export type IndicatorResult = z.infer<typeof IndicatorResultSchema>;

/**
 * Two indicators pointing in materially different directions. Recorded rather
 * than averaged away, because "high attendance but collapsing marks" is a
 * different problem from "absent and failing" and needs a different
 * intervention.
 */
export const ConflictSchema = z.object({
  strongIndicator: IndicatorKeySchema,
  weakIndicator: IndicatorKeySchema,
  /** Gap in sub-score between the two, in points. */
  gap: z.number(),
  description: z.string(),
});

export type Conflict = z.infer<typeof ConflictSchema>;

/**
 * Set when a single indicator was severe enough to raise the level above what
 * the weighted score alone would give. Null when the level is purely the
 * score's own verdict.
 */
export const EscalationSchema = z.object({
  triggeredBy: z.array(IndicatorKeySchema).min(1),
  fromLevel: RiskLevelSchema,
  toLevel: RiskLevelSchema,
  reason: z.string(),
});

export type Escalation = z.infer<typeof EscalationSchema>;

export const RiskSnapshotSchema = z.object({
  snapshotId: z.string().trim().min(1),
  usn: UsnSchema,

  /**
   * 0–100, where HIGHER MEANS MORE RISK.
   *
   * This direction is relied on across the whole system: prioritisation sorts
   * descending, and an intervention counts as "improved" when a later
   * snapshot's score is LOWER than its baseline.
   */
  score: z.number().min(0).max(100),
  level: RiskLevelSchema,

  /**
   * Weighted mean of the available academic indicators as a plain percentage,
   * where HIGHER MEANS HEALTHIER. This is the opposite direction to `score`
   * and exists for two reasons: it is the number the trend indicator diffs
   * against on the next run, and it is a friendlier figure to show a student
   * than a risk score.
   */
  academicComposite: z.number().min(0).max(100).nullable(),

  indicators: z.record(IndicatorKeySchema, IndicatorResultSchema),

  /** Share of total rule weight that was actually scoreable, 0–1. */
  confidence: z.number().min(0).max(1),
  /** Human-readable list of what is missing, e.g. "No assessment records". */
  dataGaps: z.array(z.string()),
  conflicts: z.array(ConflictSchema),
  /** True when fewer than `minIndicatorsForScore` indicators were scoreable. */
  insufficientData: z.boolean(),

  /**
   * Present when one indicator alone forced the level up. The `score` above is
   * untouched by this — only `level` is affected — so the number remains an
   * honest weighted mean.
   */
  escalation: EscalationSchema.nullable(),

  /** Rules in force when this score was computed. */
  rulesVersion: z.number().int().min(1),

  /** Link back for before/after comparisons. */
  previousSnapshotId: z.string().nullable(),
  /** `score` minus the previous snapshot's score. Negative = improving. */
  scoreDelta: z.number().nullable(),

  createdAt: IsoDateTimeSchema,
});

export type RiskSnapshot = z.infer<typeof RiskSnapshotSchema>;

/**
 * Did the student get better, worse, or stay the same between two snapshots?
 * Remember `score` is inverted: a NEGATIVE delta is good news.
 */
export const OUTCOMES = ['improved', 'no_change', 'worsened'] as const;
export const OutcomeSchema = z.enum(OUTCOMES);
export type Outcome = z.infer<typeof OutcomeSchema>;

/** Score movement smaller than this is treated as noise, not a real change. */
export const OUTCOME_NOISE_FLOOR = 2;

export function classifyOutcome(baselineScore: number, outcomeScore: number): Outcome {
  const delta = outcomeScore - baselineScore;
  if (delta <= -OUTCOME_NOISE_FLOOR) return 'improved';
  if (delta >= OUTCOME_NOISE_FLOOR) return 'worsened';
  return 'no_change';
}
