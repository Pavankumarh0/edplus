import { z } from 'zod';
import { INDICATOR_KEYS, IndicatorKeySchema, RiskLevelSchema } from './common';

/**
 * Configuration for a single indicator.
 *
 * The scoring band is deliberately expressed as two human-meaningful numbers
 * rather than an opaque coefficient, so a faculty member editing the Risk
 * Rules page can predict the effect of a change:
 *
 *   value >= threshold   → sub-score 0   (no risk from this indicator)
 *   value <= criticalAt  → sub-score 100 (maximum risk)
 *   in between           → linear
 *
 * `threshold` must be greater than `criticalAt`. This holds for the three
 * percentage indicators (e.g. attendance 75 → 40) and also for `trend`, whose
 * value is a signed change in percentage points (e.g. 0 → -15), which lets one
 * formula serve all four indicators.
 */
export const IndicatorRuleSchema = z
  .object({
    /** Relative importance. Weights are normalised at scoring time, so they
     *  need not sum to 1 — but keeping them tidy makes the UI easier to read. */
    weight: z.number().min(0).max(1),
    /** At or above this value the indicator contributes no risk. */
    threshold: z.number(),
    /** At or below this value the indicator contributes maximum risk. */
    criticalAt: z.number(),
    /** Minimum academic records required before this indicator is trusted at
     *  all. Below this the indicator is reported as a data gap instead of
     *  being scored, so a single stray mark cannot drive a risk level. */
    minRecords: z.number().int().min(0),
    /** Shown on the Risk Rules page so the rule explains itself. */
    unit: z.enum(['percent', 'percentage_points']),
  })
  .refine((r) => r.threshold > r.criticalAt, {
    message: 'threshold must be greater than criticalAt',
    path: ['threshold'],
  });

export type IndicatorRule = z.infer<typeof IndicatorRuleSchema>;

/**
 * Score boundaries for the four risk levels. A score at or above a cut-off
 * takes that level; anything below `watch` is Stable.
 * Must be strictly increasing.
 */
export const LevelCutoffsSchema = z
  .object({
    watch: z.number().min(0).max(100),
    atRisk: z.number().min(0).max(100),
    critical: z.number().min(0).max(100),
  })
  .refine((c) => c.watch < c.atRisk && c.atRisk < c.critical, {
    message: 'Cut-offs must strictly increase: watch < atRisk < critical',
  });

export type LevelCutoffs = z.infer<typeof LevelCutoffsSchema>;

/**
 * Stops a single catastrophic indicator from being averaged away.
 *
 * A weighted mean is the right default, but it has a known failure mode: a
 * student with 96% attendance and 18% marks lands mid-scale, because good
 * attendance dilutes a failing grade. That student needs attention now, and
 * "Watch" does not say so.
 *
 * When any one academic indicator is at or above `singleIndicatorSubScore`,
 * the level is raised to at least `minimumLevel`. The SCORE is never altered —
 * only the level — so the number stays a faithful weighted mean and the
 * escalation is recorded separately and shown in the UI as its own reason.
 */
export const EscalationRuleSchema = z.object({
  enabled: z.boolean(),
  /** Sub-score (0-100) at which one indicator alone is enough to escalate. */
  singleIndicatorSubScore: z.number().min(0).max(100),
  /** The floor applied when escalation fires. */
  minimumLevel: RiskLevelSchema,
});

export type EscalationRule = z.infer<typeof EscalationRuleSchema>;

export const RiskRulesSchema = z.object({
  /**
   * Bumped every time the rules are saved. Stamped onto every snapshot so a
   * historical score can always be explained by the rules in force when it
   * was computed — comparing scores across rule versions is otherwise
   * meaningless, and the UI warns when a history spans versions.
   */
  rulesVersion: z.number().int().min(1),
  indicators: z.record(IndicatorKeySchema, IndicatorRuleSchema),
  levelCutoffs: LevelCutoffsSchema,
  /**
   * How many ACADEMIC indicators (attendance, assessment, submission) must be
   * scoreable before the resulting score is considered trustworthy. Below this
   * the snapshot is still produced — never invent data, never refuse to record
   * — but flagged `insufficientData`, and the UI shows "Insufficient data"
   * rather than leaning on the level.
   *
   * `trend` deliberately does not count toward this minimum: it is derived
   * from the other three, so a student known only by their attendance would
   * otherwise stop being flagged as under-evidenced on their second upload
   * purely because a trend became computable.
   */
  minIndicatorsForScore: z.number().int().min(1).max(4),
  escalation: EscalationRuleSchema,
  updatedAt: z.string().datetime({ offset: true }).optional(),
  updatedBy: z.string().optional(),
});

export type RiskRules = z.infer<typeof RiskRulesSchema>;

/**
 * Starting rules, tuned for an Indian engineering-college context:
 *  - 75% attendance is the standard eligibility bar.
 *  - 40% is the usual internal-assessment pass mark.
 *
 * Attendance and assessment carry most of the weight because they are the
 * indicators faculty can act on earliest. Trend is weighted lightest: it is
 * the most volatile signal and is absent entirely for a student's first
 * snapshot.
 */
export const DEFAULT_RISK_RULES: RiskRules = {
  rulesVersion: 1,
  indicators: {
    attendance: {
      weight: 0.35,
      // 75% is the institutional eligibility bar. Risk starts accruing well
      // above it, because a system that waits until a student is already
      // ineligible is not an early-warning system. A student sitting exactly
      // on 75% scores 30 here — a real, visible concern.
      threshold: 90,
      criticalAt: 40,
      minRecords: 1,
      unit: 'percent',
    },
    assessment: {
      weight: 0.35,
      // 40% is the pass mark. Same reasoning: barely passing is not safe, so
      // the band starts at 65 and a student on exactly 40 scores 50.
      threshold: 65,
      criticalAt: 15,
      minRecords: 1,
      unit: 'percent',
    },
    submission: {
      weight: 0.2,
      threshold: 95,
      criticalAt: 30,
      minRecords: 1,
      unit: 'percent',
    },
    trend: {
      weight: 0.1,
      threshold: 0,
      criticalAt: -12,
      minRecords: 0,
      unit: 'percentage_points',
    },
  },
  levelCutoffs: { watch: 25, atRisk: 45, critical: 70 },
  minIndicatorsForScore: 2,
  escalation: {
    enabled: true,
    singleIndicatorSubScore: 85,
    minimumLevel: 'at_risk',
  },
};

/** Guards against a partial `indicators` record after an edit. */
export function assertCompleteRules(rules: RiskRules): void {
  for (const key of INDICATOR_KEYS) {
    if (!rules.indicators[key]) {
      throw new Error(`Risk rules are missing a configuration for "${key}"`);
    }
  }
}
