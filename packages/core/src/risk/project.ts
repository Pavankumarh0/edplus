import {
  INDICATOR_KEYS,
  type IndicatorKey,
  type RiskLevel,
  type RiskRules,
  type RiskSnapshot,
} from '../schemas/index';
import { bandSubScore, levelForScore, round1 } from './score';

/** How many recent snapshots the projection looks at. */
export const PROJECTION_WINDOW = 4;

export interface Projection {
  /** Projected risk score at the next snapshot. */
  projectedScore: number;
  projectedLevel: RiskLevel;
  /** Score change per snapshot. Positive = getting worse. */
  slopePerSnapshot: number;
  /** How many snapshots the fit used. */
  basedOnSnapshots: number;
  direction: 'improving' | 'worsening' | 'flat';
  /**
   * Always present, always shown in the UI. A straight line through four
   * points is not a prediction about a person.
   */
  caveat: string;
}

/**
 * Least-squares straight line through recent scores, projected one snapshot
 * ahead.
 *
 * Chosen over anything fancier because it is explainable to the student it
 * describes: "your last four scores moved up by about 6 points each time, so
 * if nothing changes the next one lands near 71". A model nobody can explain
 * has no business flagging a student for intervention.
 *
 * Returns null with fewer than two snapshots — there is no trend in one point.
 */
export function projectRisk(
  snapshots: RiskSnapshot[],
  rules: RiskRules,
  window = PROJECTION_WINDOW,
): Projection | null {
  // Oldest → newest, then keep the tail.
  const ordered = [...snapshots]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(-window);

  if (ordered.length < 2) return null;

  const n = ordered.length;
  const xs = ordered.map((_, i) => i);
  const ys = ordered.map((s) => s.score);

  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;

  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i += 1) {
    numerator += (xs[i]! - meanX) * (ys[i]! - meanY);
    denominator += (xs[i]! - meanX) ** 2;
  }

  const slope = denominator === 0 ? 0 : numerator / denominator;
  const intercept = meanY - slope * meanX;
  const projectedScore = round1(Math.min(100, Math.max(0, intercept + slope * n)));

  const direction = slope > 0.5 ? 'worsening' : slope < -0.5 ? 'improving' : 'flat';

  return {
    projectedScore,
    projectedLevel: levelForScore(projectedScore, rules.levelCutoffs),
    slopePerSnapshot: round1(slope),
    basedOnSnapshots: n,
    direction,
    caveat:
      `Projection, not a guarantee. A straight line through the last ${n} snapshots, ` +
      'assuming nothing changes. An intervention is meant to break this line.',
  };
}

export interface WhatIfResult {
  score: number;
  level: RiskLevel;
  /** Change vs the snapshot being explored. Negative = better. */
  scoreDelta: number;
  levelChanged: boolean;
  /** Which indicators were overridden, and to what. */
  applied: Partial<Record<IndicatorKey, number>>;
  caveat: string;
}

/**
 * Recomputes the score with one or more indicator values replaced by a
 * hypothetical, e.g. "if attendance reached 75%".
 *
 * Reuses the real scoring path — the same `bandSubScore` and the same
 * normalised weights as the live engine — so the slider cannot drift away
 * from what an actual upload would produce. It deliberately does not
 * re-derive `trend`, because a hypothetical present implies no particular
 * history and inventing one would make the answer less honest, not more.
 */
export function whatIf(
  snapshot: RiskSnapshot,
  rules: RiskRules,
  overrides: Partial<Record<IndicatorKey, number>>,
): WhatIfResult {
  let weightedRisk = 0;
  let availableWeight = 0;
  const applied: Partial<Record<IndicatorKey, number>> = {};

  for (const key of INDICATOR_KEYS) {
    const indicator = snapshot.indicators[key];
    const rule = rules.indicators[key];
    if (!indicator || !rule) continue;

    const override = overrides[key];
    const hasOverride = typeof override === 'number';

    // An override makes a previously-missing indicator scoreable: asking
    // "what if we had 80% attendance" presumes the data exists.
    const value = hasOverride ? override : indicator.value;
    const available = hasOverride || indicator.available;
    if (!available || value === null) continue;

    if (hasOverride) applied[key] = override;

    weightedRisk += bandSubScore(value, rule) * rule.weight;
    availableWeight += rule.weight;
  }

  const score = availableWeight > 0 ? round1(weightedRisk / availableWeight) : 0;
  const level = levelForScore(score, rules.levelCutoffs);

  return {
    score,
    level,
    scoreDelta: round1(score - snapshot.score),
    levelChanged: level !== snapshot.level,
    applied,
    caveat:
      'Projection, not a guarantee. Shows what the current rules would score if ' +
      'this indicator reached that value, with everything else unchanged.',
  };
}
