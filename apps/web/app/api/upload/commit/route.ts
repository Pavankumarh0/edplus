import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  ColumnMappingSchema,
  MappingSourceSchema,
  RecordTypeSchema,
  buildImport,
  computeSnapshot,
  parseCsv,
  type RiskSnapshot,
} from '@eduplus/core';
import {
  ensureCreatedAt,
  getDb,
  getLatestSnapshot,
  getRecords,
  getRiskRules,
  markUploadCommitted,
  saveSnapshots,
  saveUpload,
  upsertStudents,
  writeRecords,
} from '@eduplus/core/repositories';
import { errorResponse, facultyContext } from '@/lib/api';
import { settleOutcomes } from '@/lib/dashboard';
import { requireFaculty } from '@/lib/auth';

const BodySchema = z.object({
  recordType: RecordTypeSchema,
  fileName: z.string().min(1),
  csv: z.string().min(1).max(8_000_000),
  mapping: ColumnMappingSchema,
  mappingSource: MappingSourceSchema,
  mappingConfidence: z.number().min(0).max(1).nullable().optional(),
});

export const maxDuration = 120;

/**
 * Commits an import: writes students and records, recomputes risk for exactly
 * the students touched, and settles any intervention waiting on a verdict.
 *
 * This is the step that closes the loop the problem statement describes — new
 * data arrives, scores move, and a completed intervention finally gets an
 * honest answer about whether it worked.
 */
export async function POST(request: Request) {
  try {
    await facultyContext();
    const session = await requireFaculty();
    const db = getDb();

    const parsed = BodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join('; ') },
        { status: 400 },
      );
    }

    const { recordType, fileName, csv, mapping, mappingSource } = parsed.data;
    const uploadId = `up_${Date.now().toString(36)}`;
    const today = new Date().toISOString().slice(0, 10);

    const { rows } = parseCsv(csv);
    const result = buildImport(rows, { recordType, mapping, uploadId, defaultDate: today });

    if (result.rowsOk === 0) {
      return NextResponse.json(
        { error: 'No rows could be imported. Check the mapping and the row errors.' },
        { status: 400 },
      );
    }

    // ── Write ─────────────────────────────────────────────────────────────
    await upsertStudents(db, result.students);
    await ensureCreatedAt(db, result.affectedUsns);
    await writeRecords(db, result.records);

    await saveUpload(db, {
      uploadId,
      fileName,
      recordType,
      uploadedBy: session.email ?? session.uid,
      mapping,
      mappingSource,
      mappingConfidence: parsed.data.mappingConfidence ?? null,
      rowsTotal: result.rowsTotal,
      rowsOk: result.rowsOk,
      rowsRejected: result.rowsRejected,
      errors: result.errors.slice(0, 200),
      affectedUsns: result.affectedUsns,
      committedAt: null,
      createdAt: new Date().toISOString(),
    });

    // ── Rescore exactly the students this upload touched ──────────────────
    const rules = await getRiskRules(db);
    const snapshots: RiskSnapshot[] = [];
    const now = new Date();

    for (const usn of result.affectedUsns) {
      const [records, previous] = await Promise.all([
        getRecords(db, usn),
        getLatestSnapshot(db, usn),
      ]);
      snapshots.push(
        computeSnapshot({ usn, records, rules, previousSnapshot: previous, now }),
      );
    }

    await saveSnapshots(db, snapshots);
    await markUploadCommitted(db, uploadId);

    // ── Did any intervention work? ────────────────────────────────────────
    const settled = await settleOutcomes(result.affectedUsns);

    const levels = snapshots.reduce<Record<string, number>>((acc, snapshot) => {
      acc[snapshot.level] = (acc[snapshot.level] ?? 0) + 1;
      return acc;
    }, {});

    return NextResponse.json({
      uploadId,
      message:
        `Imported ${result.rowsOk} row${result.rowsOk === 1 ? '' : 's'} and rescored ` +
        `${snapshots.length} student${snapshots.length === 1 ? '' : 's'}` +
        (settled > 0
          ? `. ${settled} intervention${settled === 1 ? '' : 's'} now have an outcome.`
          : '.'),
      rowsOk: result.rowsOk,
      rowsRejected: result.rowsRejected,
      studentsScored: snapshots.length,
      interventionsSettled: settled,
      levels,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
