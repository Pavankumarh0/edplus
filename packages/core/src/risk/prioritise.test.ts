import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RISK_RULES,
  classifyOutcome,
  type Intervention,
  type RiskLevel,
  type RiskSnapshot,
} from '../schemas/index.js';
import { countByLevel, needsDataEntry, prioritise, type PrioritisableStudent } from './prioritise.js';
import { projectRisk, whatIf } from './project.js';
import { buildBeforeAfter, resolveAllOutcomes, resolveInterventionOutcome } from './outcome.js';

/** Minimal snapshot stub — only the fields these functions actually read. */
function snap(overrides: Partial<RiskSnapshot> & { usn: string }): RiskSnapshot {
  return {
    snapshotId: `${overrides.usn}__snap`,
    usn: overrides.usn,
    score: 0,
    level: 'stable' as RiskLevel,
    academicComposite: 80,
    indicators: {
      attendance: { key: 'attendance', available: true, value: 80, subScore: 0, weight: 0.5, recordCount: 1, reason: '' },
      assessment: { key: 'assessment', available: true, value: 70, subScore: 0, weight: 0.5, recordCount: 1, reason: '' },
      submission: { key: 'submission', available: false, value: null, subScore: null, weight: 0, recordCount: 0, reason: '' },
      trend: { key: 'trend', available: false, value: null, subScore: null, weight: 0, recordCount: 0, reason: '' },
    },
    confidence: 0.7,
    dataGaps: [],
    conflicts: [],
    insufficientData: false,
    rulesVersion: 1,
    previousSnapshotId: null,
    scoreDelta: null,
    createdAt: '2026-03-01T10:00:00.000Z',
    ...overrides,
  };
}

function student(
  usn: string,
  level: RiskLevel,
  score: number,
  opts: { delta?: number | null; open?: boolean; insufficient?: boolean; gaps?: string[] } = {},
): PrioritisableStudent {
  return {
    usn,
    snapshot: snap({
      usn,
      level,
      score,
      scoreDelta: opts.delta ?? null,
      insufficientData: opts.insufficient ?? false,
      dataGaps: opts.gaps ?? [],
    }),
    hasOpenIntervention: opts.open ?? false,
  };
}

describe('prioritise', () => {
  it('puts more severe levels first regardless of score', () => {
    const ordered = prioritise([
      student('B', 'watch', 99),
      student('A', 'critical', 71),
    ]);
    expect(ordered.map((s) => s.usn)).toEqual(['A', 'B']);
  });

  it('orders by score within a level', () => {
    const ordered = prioritise([
      student('LOW', 'at_risk', 46),
      student('HIGH', 'at_risk', 68),
    ]);
    expect(ordered.map((s) => s.usn)).toEqual(['HIGH', 'LOW']);
  });

  it('puts a worsening student ahead of a flat one on an equal score', () => {
    const ordered = prioritise([
      student('FLAT', 'at_risk', 50, { delta: 0 }),
      student('WORSE', 'at_risk', 50, { delta: 8 }),
    ]);
    expect(ordered.map((s) => s.usn)).toEqual(['WORSE', 'FLAT']);
  });

  it('ranks an unattended student above an identical one already being supported', () => {
    // The queue answers "who has nobody on it?", not just "who is worst?".
    const ordered = prioritise([
      student('HANDLED', 'critical', 80, { delta: 0, open: true }),
      student('IGNORED', 'critical', 80, { delta: 0, open: false }),
    ]);
    expect(ordered.map((s) => s.usn)).toEqual(['IGNORED', 'HANDLED']);
  });

  it('falls back to USN so the order never flickers', () => {
    const ordered = prioritise([
      student('ZZZ', 'watch', 30, { delta: 0 }),
      student('AAA', 'watch', 30, { delta: 0 }),
    ]);
    expect(ordered.map((s) => s.usn)).toEqual(['AAA', 'ZZZ']);
  });

  it('does not mutate the input array', () => {
    const input = [student('B', 'watch', 30), student('A', 'critical', 80)];
    const copy = [...input];
    prioritise(input);
    expect(input).toEqual(copy);
  });

  it('keeps insufficient-data students in the list rather than hiding them', () => {
    // Hiding them would turn "no data" into "looks fine".
    const ordered = prioritise([
      student('NODATA', 'stable', 0, { insufficient: true, gaps: ['No assessment data uploaded.'] }),
      student('FINE', 'stable', 0),
    ]);
    expect(ordered.map((s) => s.usn)).toContain('NODATA');
    expect(ordered).toHaveLength(2);
  });
});

describe('needsDataEntry', () => {
  it('surfaces students with gaps, worst first', () => {
    const queue = needsDataEntry([
      student('ONE_GAP', 'stable', 0, { gaps: ['a'] }),
      student('CLEAN', 'stable', 0),
      student('THREE_GAPS', 'stable', 0, { gaps: ['a', 'b', 'c'], insufficient: true }),
    ]);
    expect(queue.map((s) => s.usn)).toEqual(['THREE_GAPS', 'ONE_GAP']);
  });
});

describe('countByLevel', () => {
  it('counts levels and tracks insufficient data separately', () => {
    const counts = countByLevel([
      student('A', 'critical', 80),
      student('B', 'critical', 75),
      student('C', 'watch', 30),
      student('D', 'stable', 0, { insufficient: true }),
    ]);
    expect(counts.critical).toBe(2);
    expect(counts.watch).toBe(1);
    expect(counts.stable).toBe(1);
    expect(counts.insufficient_data).toBe(1);
  });
});

describe('projectRisk', () => {
  const at = (day: number, score: number) =>
    snap({ usn: 'X', score, createdAt: `2026-0${day}-01T10:00:00.000Z` });

  it('returns null with fewer than two snapshots — one point is not a trend', () => {
    expect(projectRisk([], DEFAULT_RISK_RULES)).toBeNull();
    expect(projectRisk([at(1, 50)], DEFAULT_RISK_RULES)).toBeNull();
  });

  it('projects a worsening line forward', () => {
    const p = projectRisk([at(1, 40), at(2, 50), at(3, 60)], DEFAULT_RISK_RULES)!;
    expect(p.direction).toBe('worsening');
    expect(p.slopePerSnapshot).toBeCloseTo(10, 1);
    expect(p.projectedScore).toBeCloseTo(70, 1);
    expect(p.projectedLevel).toBe('critical');
    expect(p.basedOnSnapshots).toBe(3);
  });

  it('projects an improving line forward', () => {
    const p = projectRisk([at(1, 80), at(2, 65), at(3, 50)], DEFAULT_RISK_RULES)!;
    expect(p.direction).toBe('improving');
    expect(p.slopePerSnapshot).toBeLessThan(0);
    expect(p.projectedScore).toBeCloseTo(35, 1);
  });

  it('reports a flat trend as flat', () => {
    const p = projectRisk([at(1, 50), at(2, 50), at(3, 50)], DEFAULT_RISK_RULES)!;
    expect(p.direction).toBe('flat');
    expect(p.slopePerSnapshot).toBe(0);
  });

  it('clamps the projection into 0..100', () => {
    const p = projectRisk([at(1, 90), at(2, 95), at(3, 99)], DEFAULT_RISK_RULES)!;
    expect(p.projectedScore).toBeLessThanOrEqual(100);
  });

  it('always carries the not-a-guarantee caveat', () => {
    const p = projectRisk([at(1, 40), at(2, 50)], DEFAULT_RISK_RULES)!;
    expect(p.caveat).toContain('Projection, not a guarantee');
  });

  it('honours the window and sorts by date regardless of input order', () => {
    const p = projectRisk([at(3, 60), at(1, 40), at(2, 50)], DEFAULT_RISK_RULES, 2)!;
    expect(p.basedOnSnapshots).toBe(2);
    // Last two chronologically are 50 then 60 → slope +10.
    expect(p.slopePerSnapshot).toBeCloseTo(10, 1);
  });
});

describe('whatIf', () => {
  const base = snap({
    usn: 'X',
    score: 80,
    level: 'critical',
    indicators: {
      attendance: { key: 'attendance', available: true, value: 50, subScore: 80, weight: 1, recordCount: 2, reason: '' },
      assessment: { key: 'assessment', available: false, value: null, subScore: null, weight: 0, recordCount: 0, reason: '' },
      submission: { key: 'submission', available: false, value: null, subScore: null, weight: 0, recordCount: 0, reason: '' },
      trend: { key: 'trend', available: false, value: null, subScore: null, weight: 0, recordCount: 0, reason: '' },
    },
  });

  it('drops the score to zero when attendance reaches the threshold', () => {
    const threshold = DEFAULT_RISK_RULES.indicators.attendance!.threshold;
    const result = whatIf(base, DEFAULT_RISK_RULES, { attendance: threshold });
    expect(result.score).toBe(0);
    expect(result.level).toBe('stable');
    expect(result.scoreDelta).toBeLessThan(0);
    expect(result.levelChanged).toBe(true);
    expect(result.applied).toEqual({ attendance: threshold });
  });

  it('still shows risk when attendance only reaches the 75% eligibility bar', () => {
    // 75% clears the institutional rule but sits inside the risk band on
    // purpose — an early-warning system should not call that safe.
    const result = whatIf(base, DEFAULT_RISK_RULES, { attendance: 75 });
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThan(base.score);
  });

  it('reproduces the live score when nothing is overridden', () => {
    const result = whatIf(base, DEFAULT_RISK_RULES, {});
    expect(result.score).toBeCloseTo(base.score, 0);
    expect(result.levelChanged).toBe(false);
  });

  it('makes a previously-missing indicator scoreable, since the question presumes the data', () => {
    const result = whatIf(base, DEFAULT_RISK_RULES, { assessment: 20 });
    // assessment now counts, so it pulls the weighted score.
    expect(result.applied).toHaveProperty('assessment', 20);
    expect(result.score).not.toBeCloseTo(base.score, 1);
  });

  it('carries the caveat', () => {
    expect(whatIf(base, DEFAULT_RISK_RULES, { attendance: 80 }).caveat).toContain(
      'Projection, not a guarantee',
    );
  });
});

describe('classifyOutcome', () => {
  it('treats a falling risk score as improvement', () => {
    expect(classifyOutcome(80, 60)).toBe('improved');
  });
  it('treats a rising risk score as worsening', () => {
    expect(classifyOutcome(60, 80)).toBe('worsened');
  });
  it('treats movement inside the noise floor as no change', () => {
    expect(classifyOutcome(60, 61)).toBe('no_change');
    expect(classifyOutcome(60, 59)).toBe('no_change');
    expect(classifyOutcome(60, 60)).toBe('no_change');
  });
});

describe('resolveInterventionOutcome', () => {
  const baseIntervention: Intervention = {
    interventionId: 'iv-1',
    usn: 'X',
    type: 'mentor_meeting',
    reason: 'Attendance 48% — below the 75% threshold.',
    status: 'completed',
    baselineSnapshotId: 'X__base',
    baselineScore: 80,
    outcomeSnapshotId: null,
    outcomeScore: null,
    outcome: null,
    completedAt: '2026-03-15T10:00:00.000Z',
  };

  const after = snap({ usn: 'X', snapshotId: 'X__after', score: 55, createdAt: '2026-04-01T10:00:00.000Z' });

  it('marks a completed intervention as improved when the score fell', () => {
    const resolved = resolveInterventionOutcome(baseIntervention, after)!;
    expect(resolved.outcome).toBe('improved');
    expect(resolved.scoreDelta).toBe(-25);
    expect(resolved.outcomeSnapshotId).toBe('X__after');
    expect(resolved.summary).toContain('fell 25 points');
    expect(resolved.summary).toContain('80 → 55');
  });

  it('marks it worsened when the score rose', () => {
    const worse = snap({ usn: 'X', snapshotId: 'X__worse', score: 95, createdAt: '2026-04-01T10:00:00.000Z' });
    expect(resolveInterventionOutcome(baseIntervention, worse)!.outcome).toBe('worsened');
  });

  it('ignores an intervention that is not completed', () => {
    for (const status of ['proposed', 'approved', 'in_progress', 'cancelled'] as const) {
      expect(resolveInterventionOutcome({ ...baseIntervention, status }, after)).toBeNull();
    }
  });

  it('does not re-resolve an already-resolved intervention', () => {
    const done = { ...baseIntervention, outcome: 'improved' as const, outcomeSnapshotId: 'X__old' };
    expect(resolveInterventionOutcome(done, after)).toBeNull();
  });

  it('refuses to score against data collected before the work finished', () => {
    // Snapshot predates completedAt — crediting it would manufacture a result.
    const tooEarly = snap({ usn: 'X', snapshotId: 'X__early', score: 50, createdAt: '2026-03-01T10:00:00.000Z' });
    expect(resolveInterventionOutcome(baseIntervention, tooEarly)).toBeNull();
  });

  it('never compares the baseline against itself', () => {
    const same = snap({ usn: 'X', snapshotId: 'X__base', score: 55, createdAt: '2026-04-01T10:00:00.000Z' });
    expect(resolveInterventionOutcome(baseIntervention, same)).toBeNull();
  });

  it('ignores a snapshot for a different student', () => {
    const other = snap({ usn: 'Y', snapshotId: 'Y__after', score: 10, createdAt: '2026-04-01T10:00:00.000Z' });
    expect(resolveInterventionOutcome(baseIntervention, other)).toBeNull();
  });

  it('resolves several pending interventions against one new snapshot', () => {
    const second: Intervention = { ...baseIntervention, interventionId: 'iv-2', type: 'extra_class', baselineScore: 70 };
    const resolved = resolveAllOutcomes([baseIntervention, second, { ...baseIntervention, interventionId: 'iv-3', status: 'approved' }], after);
    expect(resolved.map((r) => r.interventionId)).toEqual(['iv-1', 'iv-2']);
  });
});

describe('buildBeforeAfter', () => {
  it('shapes a baseline/outcome pair for the UI card', () => {
    const before = snap({ usn: 'X', snapshotId: 'b', score: 80, level: 'critical', createdAt: '2026-03-01T10:00:00.000Z' });
    const afterSnap = snap({ usn: 'X', snapshotId: 'a', score: 40, level: 'watch', createdAt: '2026-04-01T10:00:00.000Z' });
    const card = buildBeforeAfter(before, afterSnap);
    expect(card.before.score).toBe(80);
    expect(card.after.score).toBe(40);
    expect(card.outcome).toBe('improved');
    expect(card.scoreDelta).toBe(-40);
  });
});
