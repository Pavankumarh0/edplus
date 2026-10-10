import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  EscalationRuleSchema,
  IndicatorRuleSchema,
  LevelCutoffsSchema,
  computeSnapshot,
  type RiskSnapshot,
} from '@eduplus/core';
import {
  getDb,
  getRecords,
  getLatestSnapshot,
  getRiskRules,
  listStudents,
  saveRiskRules,
  saveSnapshots,
} from '@eduplus/core/repositories';
import { errorResponse, facultyContext } from '@/lib/api';
import { settleOutcomes } from '@/lib/dashboard';
import { requireFaculty } from '@/lib/auth';

const BodySchema = z.object({
  indicators: z.object({
    attendance: IndicatorRuleSchema,
    assessment: IndicatorRuleSchema,
    submission: IndicatorRuleSchema,
    trend: IndicatorRuleSchema,
  }),
  levelCutoffs: LevelCutoffsSchema,
  minIndicatorsForScore: z.number().int().min(1).max(4),
  escalation: EscalationRuleSchema,
  /** Rescore the whole cohort under the new rules. */
  recalculateAll: z.boolean().optional(),
});

export const maxDuration = 300;

/**
 * Saves edited risk rules and optionally rescores everyone.
 *
 * `rulesVersion` is bumped server-side on every save, and every snapshot
 * records the version that produced it. Without the recompute the cohort is
 * scored under mixed versions, which is why the UI pairs the two.
 */
export async function PUT(request: Request) {
  try {
    await facultyContext();
    const session = await requireFaculty();
    const db = getDb();

    const parsed = BodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') },
        { status: 400 },
      );
    }

    const { recalculateAll, ...rules } = parsed.data;
    const saved = await saveRiskRules(db, rules, session.email ?? session.uid);

    if (!recalculateAll) {
      return NextResponse.json({
        rulesVersion: saved.rulesVersion,
        message:
          `Rules saved as v${saved.rulesVersion}. Existing scores still use the old version — ` +
          'recalculate to bring everyone onto it.',
      });
    }

    // ── Rescore the cohort ────────────────────────────────────────────────
    const students = await listStudents(db);
    const snapshots: RiskSnapshot[] = [];
    const now = new Date();

    for (const student of students) {
      const [records, previous] = await Promise.all([
        getRecords(db, student.usn),
        getLatestSnapshot(db, student.usn),
      ]);
      if (records.length === 0) continue;
      snapshots.push(
        computeSnapshot({ usn: student.usn, records, rules: saved, previousSnapshot: previous, now }),
      );
    }

    await saveSnapshots(db, snapshots);
    const settled = await settleOutcomes(snapshots.map((s) => s.usn));

    const levels = snapshots.reduce<Record<string, number>>((acc, snapshot) => {
      acc[snapshot.level] = (acc[snapshot.level] ?? 0) + 1;
      return acc;
    }, {});

    return NextResponse.json({
      rulesVersion: saved.rulesVersion,
      message:
        `Rules saved as v${saved.rulesVersion} and ${snapshots.length} student` +
        `${snapshots.length === 1 ? '' : 's'} rescored.` +
        (settled > 0 ? ` ${settled} intervention outcome${settled === 1 ? '' : 's'} updated.` : ''),
      studentsScored: snapshots.length,
      levels,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Current rules, for the editor. */
export async function GET() {
  try {
    await facultyContext();
    return NextResponse.json(await getRiskRules(getDb()));
  } catch (error) {
    return errorResponse(error);
  }
}
