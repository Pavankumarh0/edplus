import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RISK_RULES,
  makeRecordId,
  type AcademicRecord,
  type RecordType,
  type RiskRules,
  type RiskSnapshot,
} from '../schemas/index';
import { computeSnapshot, detectConflicts } from './engine';
import { aggregateRecords } from './aggregate';
import { bandSubScore, levelForScore } from './score';

const NOW = new Date('2026-03-01T10:00:00.000Z');
const LATER = new Date('2026-04-01T10:00:00.000Z');
const USN = '1OX21IS045';

/** Builds a valid record with sensible defaults. */
function rec(
  type: RecordType,
  subject: string,
  value: number,
  maxValue: number,
  overrides: Partial<AcademicRecord> = {},
): AcademicRecord {
  const date = overrides.date ?? '2026-02-20';
  return {
    recordId: makeRecordId({ usn: USN, type, subject, date }),
    usn: USN,
    type,
    subject,
    value,
    maxValue,
    date,
    sourceUploadId: 'upload-1',
    ...overrides,
  };
}

/** A full set of records producing roughly the given percentages. */
function fullRecords(opts: {
  attendance?: [number, number];
  assessment?: [number, number];
  submission?: [number, number];
}): AcademicRecord[] {
  const out: AcademicRecord[] = [];
  if (opts.attendance) out.push(rec('attendance', 'DBMS', ...opts.attendance));
  if (opts.assessment) out.push(rec('assessment', 'DBMS', ...opts.assessment));
  if (opts.submission) out.push(rec('submission', 'DBMS', ...opts.submission));
  return out;
}

describe('bandSubScore', () => {
  it('is zero at or above the threshold', () => {
    expect(bandSubScore(75, { threshold: 75, criticalAt: 40 })).toBe(0);
    expect(bandSubScore(100, { threshold: 75, criticalAt: 40 })).toBe(0);
  });

  it('is 100 at or below the critical floor', () => {
    expect(bandSubScore(40, { threshold: 75, criticalAt: 40 })).toBe(100);
    expect(bandSubScore(0, { threshold: 75, criticalAt: 40 })).toBe(100);
  });

  it('interpolates linearly between the two', () => {
    // Midpoint of 75..40 is 57.5 → 50 risk.
    expect(bandSubScore(57.5, { threshold: 75, criticalAt: 40 })).toBeCloseTo(50, 5);
  });

  it('handles a negative critical floor, which is what makes trend work', () => {
    // trend: threshold 0, criticalAt -15. A 5-point fall is a third of the way.
    expect(bandSubScore(-5, { threshold: 0, criticalAt: -15 })).toBeCloseTo(33.33, 1);
    expect(bandSubScore(3, { threshold: 0, criticalAt: -15 })).toBe(0);
    expect(bandSubScore(-20, { threshold: 0, criticalAt: -15 })).toBe(100);
  });

  it('refuses an inverted rule rather than scoring nonsense', () => {
    expect(() => bandSubScore(50, { threshold: 10, criticalAt: 90 })).toThrow(/must exceed/);
  });
});

describe('levelForScore', () => {
  const cutoffs = DEFAULT_RISK_RULES.levelCutoffs;

  it('maps scores onto levels at the configured boundaries', () => {
    expect(levelForScore(0, cutoffs)).toBe('stable');
    expect(levelForScore(24.9, cutoffs)).toBe('stable');
    expect(levelForScore(25, cutoffs)).toBe('watch');
    expect(levelForScore(44.9, cutoffs)).toBe('watch');
    expect(levelForScore(45, cutoffs)).toBe('at_risk');
    expect(levelForScore(69.9, cutoffs)).toBe('at_risk');
    expect(levelForScore(70, cutoffs)).toBe('critical');
    expect(levelForScore(100, cutoffs)).toBe('critical');
  });
});

describe('aggregateRecords', () => {
  it('sums numerators and denominators instead of averaging percentages', () => {
    // 5/50 and 10/10. Averaging percentages gives 55%; the honest answer is
    // 15/60 = 25%. A small subject must not mask a large failure.
    const agg = aggregateRecords([
      rec('attendance', 'DBMS', 5, 50),
      rec('attendance', 'OS', 10, 10, { date: '2026-02-21' }),
    ]);
    expect(agg.value).toBeCloseTo(25, 5);
    expect(agg.recordCount).toBe(2);
    expect(agg.subjects).toEqual(['DBMS', 'OS']);
  });

  it('returns a null value, not zero, when there are no records', () => {
    const agg = aggregateRecords([]);
    expect(agg.value).toBeNull();
    expect(agg.recordCount).toBe(0);
  });
});

describe('computeSnapshot — a healthy student', () => {
  const snapshot = computeSnapshot({
    usn: USN,
    records: fullRecords({ attendance: [92, 100], assessment: [78, 100], submission: [95, 100] }),
    rules: DEFAULT_RISK_RULES,
    now: NOW,
  });

  it('scores zero risk when every indicator clears its threshold', () => {
    expect(snapshot.score).toBe(0);
    expect(snapshot.level).toBe('stable');
  });

  it('reports a healthy academic composite in the opposite direction', () => {
    // Higher composite = healthier, unlike score.
    expect(snapshot.academicComposite).toBeGreaterThan(80);
  });

  it('stamps the rules version that produced it', () => {
    expect(snapshot.rulesVersion).toBe(DEFAULT_RISK_RULES.rulesVersion);
  });

  it('has no previous snapshot to compare against', () => {
    expect(snapshot.previousSnapshotId).toBeNull();
    expect(snapshot.scoreDelta).toBeNull();
    expect(snapshot.indicators.trend.available).toBe(false);
  });
});

describe('computeSnapshot — a critical student', () => {
  const snapshot = computeSnapshot({
    usn: USN,
    records: fullRecords({ attendance: [35, 100], assessment: [12, 100], submission: [20, 100] }),
    rules: DEFAULT_RISK_RULES,
    now: NOW,
  });

  it('reaches the critical level', () => {
    expect(snapshot.score).toBeGreaterThanOrEqual(DEFAULT_RISK_RULES.levelCutoffs.critical);
    expect(snapshot.level).toBe('critical');
  });

  it('explains each indicator with the real numbers', () => {
    expect(snapshot.indicators.attendance.reason).toContain('35%');
    expect(snapshot.indicators.attendance.reason).toContain('critical floor');
    expect(snapshot.indicators.assessment.subScore).toBe(100);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EDGE CASE 1 — missing academic data
// ─────────────────────────────────────────────────────────────────────────────
describe('EDGE CASE: missing academic data', () => {
  const snapshot = computeSnapshot({
    usn: USN,
    // Attendance only. No assessment, no submission, no previous snapshot.
    records: fullRecords({ attendance: [50, 100] }),
    rules: DEFAULT_RISK_RULES,
    now: NOW,
  });

  it('never invents a value for a missing indicator', () => {
    expect(snapshot.indicators.assessment.value).toBeNull();
    expect(snapshot.indicators.assessment.subScore).toBeNull();
    expect(snapshot.indicators.submission.value).toBeNull();
  });

  it('excludes missing indicators from the score rather than scoring them as zero risk', () => {
    // Attendance 50% in a 90..40 band is 80 risk. If the three missing
    // indicators were treated as 0 risk, the score would be ~28 and the
    // student would look merely "watch" instead of critical.
    expect(snapshot.score).toBeCloseTo(80, 1);
    expect(snapshot.indicators.attendance.weight).toBe(1);
  });

  it('lowers confidence to the share of rule weight it could actually use', () => {
    // Only attendance (weight 0.35) of a total 1.0 was scoreable.
    expect(snapshot.confidence).toBeCloseTo(0.35, 2);
  });

  it('lists every gap in plain language', () => {
    expect(snapshot.dataGaps).toHaveLength(3);
    expect(snapshot.dataGaps.join(' ')).toContain('No assessment data uploaded.');
    expect(snapshot.dataGaps.join(' ')).toContain('No submission data uploaded.');
    expect(snapshot.dataGaps.join(' ')).toContain('trend');
  });

  it('flags insufficientData when fewer indicators than the minimum are scoreable', () => {
    // 1 scoreable < minIndicatorsForScore of 2.
    expect(snapshot.insufficientData).toBe(true);
  });

  it('clears the insufficientData flag once the minimum is met', () => {
    const better = computeSnapshot({
      usn: USN,
      records: fullRecords({ attendance: [50, 100], assessment: [30, 100] }),
      rules: DEFAULT_RISK_RULES,
      now: NOW,
    });
    expect(better.insufficientData).toBe(false);
    expect(better.dataGaps.length).toBeGreaterThan(0); // submission still missing
  });

  it('produces a zero score and no crash for a student with no records at all', () => {
    const empty = computeSnapshot({
      usn: USN,
      records: [],
      rules: DEFAULT_RISK_RULES,
      now: NOW,
    });
    expect(empty.score).toBe(0);
    expect(empty.confidence).toBe(0);
    expect(empty.insufficientData).toBe(true);
    expect(empty.academicComposite).toBeNull();
    expect(empty.dataGaps).toHaveLength(4);
  });

  it('respects minRecords — one stray mark must not drive an indicator', () => {
    const strict: RiskRules = {
      ...DEFAULT_RISK_RULES,
      indicators: {
        ...DEFAULT_RISK_RULES.indicators,
        assessment: { ...DEFAULT_RISK_RULES.indicators.assessment!, minRecords: 3 },
      },
    };
    const snap = computeSnapshot({
      usn: USN,
      records: fullRecords({ attendance: [90, 100], assessment: [5, 100] }),
      rules: strict,
      now: NOW,
    });
    expect(snap.indicators.assessment.available).toBe(false);
    expect(snap.indicators.assessment.reason).toContain('below the 3 needed');
    // The single catastrophic mark did not drag the score down.
    expect(snap.score).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EDGE CASE 2 — conflicting indicators
// ─────────────────────────────────────────────────────────────────────────────
describe('EDGE CASE: conflicting indicators', () => {
  // The brief's example: high attendance, collapsing marks.
  const snapshot = computeSnapshot({
    usn: USN,
    records: fullRecords({ attendance: [96, 100], assessment: [18, 100], submission: [90, 100] }),
    rules: DEFAULT_RISK_RULES,
    now: NOW,
  });

  it('records the conflict instead of averaging it away', () => {
    expect(snapshot.conflicts.length).toBeGreaterThan(0);
    const conflict = snapshot.conflicts.find((c) => c.weakIndicator === 'assessment');
    expect(conflict).toBeDefined();
    expect(['attendance', 'submission']).toContain(conflict!.strongIndicator);
  });

  it('describes the conflict in terms a mentor can act on', () => {
    const conflict = snapshot.conflicts[0]!;
    expect(conflict.description).toMatch(/healthy/);
    expect(conflict.description).toMatch(/serious concern/);
    expect(conflict.description).toMatch(/different causes/);
    expect(conflict.gap).toBeGreaterThan(0);
  });

  it('still reports every indicator separately', () => {
    expect(snapshot.indicators.attendance.subScore).toBe(0);
    // 18% is above the 15% critical floor, so the band gives 94, not 100.
    expect(snapshot.indicators.assessment.subScore).toBe(94);
    expect(snapshot.indicators.attendance.available).toBe(true);
    expect(snapshot.indicators.assessment.available).toBe(true);
  });

  it('orders conflicts by the size of the disagreement', () => {
    const gaps = snapshot.conflicts.map((c) => c.gap);
    expect(gaps).toEqual([...gaps].sort((a, b) => b - a));
  });

  it('reports no conflict when indicators agree', () => {
    const agreeing = computeSnapshot({
      usn: USN,
      records: fullRecords({ attendance: [45, 100], assessment: [22, 100], submission: [35, 100] }),
      rules: DEFAULT_RISK_RULES,
      now: NOW,
    });
    expect(agreeing.conflicts).toHaveLength(0);
  });

  it('excludes trend from conflict detection', () => {
    // trend is derived from the other three, so pairing it against them would
    // report arithmetic as disagreement.
    const conflicts = detectConflicts({
      attendance: {
        key: 'attendance', available: true, value: 96, subScore: 0,
        weight: 0.35, recordCount: 1, reason: '',
      },
      assessment: {
        key: 'assessment', available: true, value: 18, subScore: 100,
        weight: 0.35, recordCount: 1, reason: '',
      },
      submission: {
        key: 'submission', available: false, value: null, subScore: null,
        weight: 0, recordCount: 0, reason: '',
      },
      trend: {
        key: 'trend', available: true, value: -14, subScore: 93,
        weight: 0.1, recordCount: 1, reason: '',
      },
    });
    expect(conflicts.every((c) => c.weakIndicator !== 'trend')).toBe(true);
    expect(conflicts.every((c) => c.strongIndicator !== 'trend')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EDGE CASE 3 — student improves after an intervention
// ─────────────────────────────────────────────────────────────────────────────
describe('EDGE CASE: improvement after intervention', () => {
  const before = computeSnapshot({
    usn: USN,
    records: fullRecords({ attendance: [48, 100], assessment: [22, 100], submission: [40, 100] }),
    rules: DEFAULT_RISK_RULES,
    now: NOW,
  });

  const after = computeSnapshot({
    usn: USN,
    records: fullRecords({ attendance: [82, 100], assessment: [55, 100], submission: [88, 100] }),
    rules: DEFAULT_RISK_RULES,
    previousSnapshot: before,
    now: LATER,
  });

  it('shows the risk score falling', () => {
    expect(before.level).toBe('critical');
    expect(after.score).toBeLessThan(before.score);
    expect(after.scoreDelta).toBeLessThan(0);
    expect(after.previousSnapshotId).toBe(before.snapshotId);
  });

  it('credits the improvement through a positive trend indicator', () => {
    expect(after.indicators.trend.available).toBe(true);
    expect(after.indicators.trend.value).toBeGreaterThan(0);
    // An improving trend contributes no risk.
    expect(after.indicators.trend.subScore).toBe(0);
    expect(after.indicators.trend.reason).toContain('rose');
  });

  it('penalises a worsening trend', () => {
    const worse = computeSnapshot({
      usn: USN,
      records: fullRecords({ attendance: [40, 100], assessment: [18, 100], submission: [30, 100] }),
      rules: DEFAULT_RISK_RULES,
      previousSnapshot: after,
      now: new Date('2026-05-01T10:00:00.000Z'),
    });
    expect(worse.indicators.trend.value).toBeLessThan(0);
    expect(worse.indicators.trend.subScore).toBeGreaterThan(0);
    expect(worse.indicators.trend.reason).toContain('fell');
    expect(worse.scoreDelta).toBeGreaterThan(0);
  });

  it('leaves trend unavailable when the earlier snapshot had no composite', () => {
    const blind = computeSnapshot({ usn: USN, records: [], rules: DEFAULT_RISK_RULES, now: NOW });
    expect(blind.academicComposite).toBeNull();
    const next = computeSnapshot({
      usn: USN,
      records: fullRecords({ attendance: [80, 100], assessment: [60, 100] }),
      rules: DEFAULT_RISK_RULES,
      previousSnapshot: blind,
      now: LATER,
    });
    expect(next.indicators.trend.available).toBe(false);
  });
});

describe('configurable rules', () => {
  const records = fullRecords({ attendance: [70, 100], assessment: [60, 100], submission: [85, 100] });

  it('changes the score when a threshold moves', () => {
    const lenient: RiskRules = {
      ...DEFAULT_RISK_RULES,
      rulesVersion: 2,
      indicators: {
        ...DEFAULT_RISK_RULES.indicators,
        attendance: { ...DEFAULT_RISK_RULES.indicators.attendance!, threshold: 65 },
      },
    };

    const strictSnap = computeSnapshot({ usn: USN, records, rules: DEFAULT_RISK_RULES, now: NOW });
    const lenientSnap = computeSnapshot({ usn: USN, records, rules: lenient, now: NOW });

    // At 70% attendance: below a 75 threshold, but above a 65 one.
    expect(strictSnap.indicators.attendance.subScore).toBeGreaterThan(0);
    expect(lenientSnap.indicators.attendance.subScore).toBe(0);
    expect(lenientSnap.score).toBeLessThan(strictSnap.score);
    expect(lenientSnap.rulesVersion).toBe(2);
  });

  it('changes the score when a weight moves', () => {
    const attendanceHeavy: RiskRules = {
      ...DEFAULT_RISK_RULES,
      rulesVersion: 3,
      indicators: {
        ...DEFAULT_RISK_RULES.indicators,
        attendance: { ...DEFAULT_RISK_RULES.indicators.attendance!, weight: 0.9 },
      },
    };
    const base = computeSnapshot({ usn: USN, records, rules: DEFAULT_RISK_RULES, now: NOW });
    const heavy = computeSnapshot({ usn: USN, records, rules: attendanceHeavy, now: NOW });
    expect(heavy.score).not.toBeCloseTo(base.score, 3);
  });

  it('changes the level when cut-offs move, without changing the score', () => {
    const harsh: RiskRules = {
      ...DEFAULT_RISK_RULES,
      rulesVersion: 4,
      levelCutoffs: { watch: 1, atRisk: 2, critical: 3 },
    };
    const base = computeSnapshot({ usn: USN, records, rules: DEFAULT_RISK_RULES, now: NOW });
    const harshSnap = computeSnapshot({ usn: USN, records, rules: harsh, now: NOW });
    expect(harshSnap.score).toBeCloseTo(base.score, 5);
    expect(harshSnap.level).toBe('critical');
    expect(base.level).not.toBe('critical');
  });

  it('rejects rules missing an indicator rather than scoring a partial model', () => {
    const broken = {
      ...DEFAULT_RISK_RULES,
      indicators: { attendance: DEFAULT_RISK_RULES.indicators.attendance! },
    } as unknown as RiskRules;
    expect(() => computeSnapshot({ usn: USN, records, rules: broken, now: NOW })).toThrow(
      /missing a configuration/,
    );
  });
});

describe('determinism and isolation', () => {
  const records = fullRecords({ attendance: [61, 100], assessment: [38, 100], submission: [72, 100] });

  it('produces an identical snapshot for identical input', () => {
    const a = computeSnapshot({ usn: USN, records, rules: DEFAULT_RISK_RULES, now: NOW });
    const b = computeSnapshot({ usn: USN, records, rules: DEFAULT_RISK_RULES, now: NOW });
    expect(a).toEqual(b);
  });

  it('ignores records belonging to a different student', () => {
    const polluted: AcademicRecord[] = [
      ...records,
      { ...rec('attendance', 'DBMS', 0, 100), usn: 'OTHER999', recordId: 'other' },
    ];
    const clean = computeSnapshot({ usn: USN, records, rules: DEFAULT_RISK_RULES, now: NOW });
    const filtered = computeSnapshot({ usn: USN, records: polluted, rules: DEFAULT_RISK_RULES, now: NOW });
    expect(filtered.score).toBeCloseTo(clean.score, 5);
  });

  it('does not mutate the records it was given', () => {
    const snapshot = structuredClone(records);
    computeSnapshot({ usn: USN, records, rules: DEFAULT_RISK_RULES, now: NOW });
    expect(records).toEqual(snapshot);
  });

  it('keeps the score within 0..100 for extreme input', () => {
    const extreme = computeSnapshot({
      usn: USN,
      records: fullRecords({ attendance: [0, 100], assessment: [0, 100], submission: [0, 100] }),
      rules: DEFAULT_RISK_RULES,
      now: NOW,
    });
    expect(extreme.score).toBeLessThanOrEqual(100);
    expect(extreme.score).toBeGreaterThanOrEqual(0);
    expect(extreme.score).toBe(100);
  });
});

describe('normalised weights', () => {
  it('sums applied weights to 1 across available indicators', () => {
    const snap = computeSnapshot({
      usn: USN,
      records: fullRecords({ attendance: [60, 100], assessment: [30, 100] }),
      rules: DEFAULT_RISK_RULES,
      now: NOW,
    });
    const total = (['attendance', 'assessment', 'submission', 'trend'] as const)
      .map((k) => snap.indicators[k]!.weight)
      .reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 2);
    expect(snap.indicators.submission.weight).toBe(0);
  });
});

describe('snapshot ids', () => {
  it('sort chronologically as strings', () => {
    const first = computeSnapshot({ usn: USN, records: [], rules: DEFAULT_RISK_RULES, now: NOW });
    const second = computeSnapshot({ usn: USN, records: [], rules: DEFAULT_RISK_RULES, now: LATER });
    expect([second.snapshotId, first.snapshotId].sort()).toEqual([
      first.snapshotId,
      second.snapshotId,
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Escalation — one catastrophic indicator must not be averaged away
// ─────────────────────────────────────────────────────────────────────────────
describe('escalation', () => {
  // Present almost every class, submitting everything, failing every test.
  const diluted = computeSnapshot({
    usn: USN,
    records: fullRecords({ attendance: [96, 100], assessment: [18, 100], submission: [96, 100] }),
    rules: DEFAULT_RISK_RULES,
    now: NOW,
  });

  it('raises the level when one indicator alone is severe', () => {
    expect(diluted.escalation).not.toBeNull();
    expect(diluted.escalation!.triggeredBy).toContain('assessment');
    expect(diluted.level).toBe('at_risk');
  });

  it('leaves the score untouched, so it stays an honest weighted mean', () => {
    // The weighted mean alone would only have reached "watch".
    expect(diluted.escalation!.fromLevel).toBe('watch');
    expect(diluted.escalation!.toLevel).toBe('at_risk');
    expect(diluted.score).toBeLessThan(DEFAULT_RISK_RULES.levelCutoffs.atRisk);
  });

  it('explains itself in plain language', () => {
    expect(diluted.escalation!.reason).toMatch(/assessment average/i);
    expect(diluted.escalation!.reason).toMatch(/other indicators pull the overall score down/);
  });

  it('does not fire when no single indicator is severe', () => {
    const even = computeSnapshot({
      usn: USN,
      records: fullRecords({ attendance: [70, 100], assessment: [50, 100], submission: [75, 100] }),
      rules: DEFAULT_RISK_RULES,
      now: NOW,
    });
    expect(even.escalation).toBeNull();
  });

  it('never lowers a level that is already higher', () => {
    const alreadyCritical = computeSnapshot({
      usn: USN,
      records: fullRecords({ attendance: [20, 100], assessment: [8, 100], submission: [10, 100] }),
      rules: DEFAULT_RISK_RULES,
      now: NOW,
    });
    expect(alreadyCritical.level).toBe('critical');
    expect(alreadyCritical.escalation).toBeNull();
  });

  it('can be switched off from the rules', () => {
    const off: RiskRules = {
      ...DEFAULT_RISK_RULES,
      escalation: { ...DEFAULT_RISK_RULES.escalation, enabled: false },
    };
    const snap = computeSnapshot({
      usn: USN,
      records: fullRecords({ attendance: [96, 100], assessment: [18, 100], submission: [96, 100] }),
      rules: off,
      now: NOW,
    });
    expect(snap.escalation).toBeNull();
    expect(snap.level).toBe('watch');
  });

  it('ignores trend, which is derived from the academic indicators', () => {
    const base = computeSnapshot({
      usn: USN,
      records: fullRecords({ attendance: [95, 100], assessment: [90, 100], submission: [98, 100] }),
      rules: DEFAULT_RISK_RULES,
      now: NOW,
    });
    // A fall steep enough to saturate the trend sub-score, while every
    // academic indicator stays below the escalation bar. If trend were
    // eligible to escalate, this snapshot would trip it — it must not.
    const fell = computeSnapshot({
      usn: USN,
      records: fullRecords({ attendance: [85, 100], assessment: [40, 100], submission: [90, 100] }),
      rules: DEFAULT_RISK_RULES,
      previousSnapshot: base,
      now: LATER,
    });
    const bar = DEFAULT_RISK_RULES.escalation.singleIndicatorSubScore;
    expect(fell.indicators.trend.subScore).toBeGreaterThanOrEqual(bar);
    for (const key of ['attendance', 'assessment', 'submission'] as const) {
      expect(fell.indicators[key].subScore!).toBeLessThan(bar);
    }
    expect(fell.escalation).toBeNull();
  });

  it('reports every triggering indicator', () => {
    const twoBad = computeSnapshot({
      usn: USN,
      records: fullRecords({ attendance: [20, 100], assessment: [10, 100], submission: [99, 100] }),
      rules: {
        ...DEFAULT_RISK_RULES,
        // Push the scored level down so escalation has room to fire.
        levelCutoffs: { watch: 80, atRisk: 90, critical: 95 },
      },
      now: NOW,
    });
    expect(twoBad.escalation!.triggeredBy).toEqual(
      expect.arrayContaining(['attendance', 'assessment']),
    );
  });
});
