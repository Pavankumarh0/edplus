import {
  classifyOutcome,
  type Intervention,
  type Outcome,
  type RiskSnapshot,
} from '../schemas/index';
import { round1 } from './score';

export interface ResolvedOutcome {
  interventionId: string;
  outcome: Outcome;
  baselineScore: number;
  outcomeScore: number;
  /** Negative means the risk score fell, i.e. the student improved. */
  scoreDelta: number;
  outcomeSnapshotId: string;
  /** One-line summary for the interventions board and the student timeline. */
  summary: string;
}

/**
 * Decides whether an intervention worked, by comparing the snapshot that
 * justified it against the first snapshot taken after it was completed.
 *
 * Called when a new snapshot lands (i.e. after the next CSV upload), which is
 * what closes the loop the problem statement asks for: record an action, then
 * let the next batch of real data say whether it helped.
 *
 * Returns null when the intervention is not yet resolvable — not completed,
 * already resolved, or the new snapshot predates completion. Scoring an
 * intervention against data collected before it finished would manufacture a
 * result, so those cases are left alone rather than guessed at.
 */
export function resolveInterventionOutcome(
  intervention: Intervention,
  newSnapshot: RiskSnapshot,
): ResolvedOutcome | null {
  if (intervention.status !== 'completed') return null;
  if (intervention.outcome !== null && intervention.outcomeSnapshotId !== null) return null;
  if (intervention.usn !== newSnapshot.usn) return null;

  // The snapshot must describe the world after the work was done.
  if (intervention.completedAt && newSnapshot.createdAt < intervention.completedAt) return null;

  // Never compare the baseline against itself.
  if (newSnapshot.snapshotId === intervention.baselineSnapshotId) return null;

  const baselineScore = intervention.baselineScore;
  const outcomeScore = newSnapshot.score;
  const scoreDelta = round1(outcomeScore - baselineScore);
  const outcome = classifyOutcome(baselineScore, outcomeScore);

  const movement =
    outcome === 'improved'
      ? `fell ${Math.abs(scoreDelta)} points`
      : outcome === 'worsened'
        ? `rose ${Math.abs(scoreDelta)} points`
        : 'barely moved';

  return {
    interventionId: intervention.interventionId,
    outcome,
    baselineScore,
    outcomeScore,
    scoreDelta,
    outcomeSnapshotId: newSnapshot.snapshotId,
    summary:
      `Risk score ${movement}: ${round1(baselineScore)} → ${round1(outcomeScore)} ` +
      `after this intervention was completed.`,
  };
}

/**
 * Resolves every pending intervention for a student against one new snapshot.
 * A student can have several completed interventions awaiting a verdict.
 */
export function resolveAllOutcomes(
  interventions: Intervention[],
  newSnapshot: RiskSnapshot,
): ResolvedOutcome[] {
  return interventions
    .map((intervention) => resolveInterventionOutcome(intervention, newSnapshot))
    .filter((r): r is ResolvedOutcome => r !== null);
}

export interface BeforeAfter {
  before: { snapshotId: string; score: number; level: string; at: string };
  after: { snapshotId: string; score: number; level: string; at: string };
  outcome: Outcome;
  scoreDelta: number;
}

/** Shapes a baseline/outcome pair for the before/after card in the UI. */
export function buildBeforeAfter(
  baseline: RiskSnapshot,
  outcomeSnapshot: RiskSnapshot,
): BeforeAfter {
  return {
    before: {
      snapshotId: baseline.snapshotId,
      score: baseline.score,
      level: baseline.level,
      at: baseline.createdAt,
    },
    after: {
      snapshotId: outcomeSnapshot.snapshotId,
      score: outcomeSnapshot.score,
      level: outcomeSnapshot.level,
      at: outcomeSnapshot.createdAt,
    },
    outcome: classifyOutcome(baseline.score, outcomeSnapshot.score),
    scoreDelta: round1(outcomeSnapshot.score - baseline.score),
  };
}
