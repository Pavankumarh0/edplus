import { riskLevelRank, type RiskSnapshot } from '../schemas/index';

export interface PrioritisableStudent {
  usn: string;
  name?: string;
  snapshot: RiskSnapshot;
  /** True when the student already has a proposed/approved/in-progress
   *  intervention. */
  hasOpenIntervention: boolean;
}

/**
 * Orders students by who most needs faculty attention next.
 *
 * Tie-breaks, in order:
 *   1. Risk level            — Critical outranks At Risk outranks Watch.
 *   2. Score                 — higher risk first within a level.
 *   3. Worsening trend       — a falling student outranks a flat one.
 *   4. No open intervention  — someone already being supported ranks BELOW an
 *                              equally-at-risk student nobody has reached yet.
 *                              The queue answers "who is unattended?", not
 *                              "who is worst?".
 *   5. USN                   — so the order never flickers between renders.
 *
 * Note on students flagged `insufficientData`: they are intentionally left in
 * this list rather than filtered out. Their score is low-confidence, so they
 * sort low, but hiding them would turn "we have no data on this student" into
 * "this student is fine" — the exact failure the brief asks us to make
 * visible. Use `needsDataEntry` to surface them in their own queue.
 */
export function prioritise(students: PrioritisableStudent[]): PrioritisableStudent[] {
  return [...students].sort((a, b) => {
    const levelDiff = riskLevelRank(b.snapshot.level) - riskLevelRank(a.snapshot.level);
    if (levelDiff !== 0) return levelDiff;

    const scoreDiff = b.snapshot.score - a.snapshot.score;
    if (Math.abs(scoreDiff) > 0.001) return scoreDiff;

    // A positive scoreDelta means the risk score rose, i.e. the student got
    // worse. Worsening students come first.
    const aDelta = a.snapshot.scoreDelta ?? 0;
    const bDelta = b.snapshot.scoreDelta ?? 0;
    const deltaDiff = bDelta - aDelta;
    if (Math.abs(deltaDiff) > 0.001) return deltaDiff;

    if (a.hasOpenIntervention !== b.hasOpenIntervention) {
      return a.hasOpenIntervention ? 1 : -1;
    }

    return a.usn.localeCompare(b.usn);
  });
}

/** Students whose snapshot cannot be trusted until more data is uploaded. */
export function needsDataEntry(students: PrioritisableStudent[]): PrioritisableStudent[] {
  return students
    .filter((s) => s.snapshot.insufficientData || s.snapshot.dataGaps.length > 0)
    .sort((a, b) => b.snapshot.dataGaps.length - a.snapshot.dataGaps.length || a.usn.localeCompare(b.usn));
}

/** Counts by level, for the dashboard overview tiles. */
export function countByLevel(students: PrioritisableStudent[]): Record<string, number> {
  const counts: Record<string, number> = {
    stable: 0,
    watch: 0,
    at_risk: 0,
    critical: 0,
    insufficient_data: 0,
  };
  for (const student of students) {
    counts[student.snapshot.level] = (counts[student.snapshot.level] ?? 0) + 1;
    if (student.snapshot.insufficientData) counts.insufficient_data! += 1;
  }
  return counts;
}
