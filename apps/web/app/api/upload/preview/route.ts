import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  RecordTypeSchema,
  buildImport,
  finaliseMapping,
  heuristicMapping,
  heuristicsAreSufficient,
  parseCsv,
  type ColumnMapping,
} from '@eduplus/core';
import { errorResponse, facultyContext } from '@/lib/api';
import { proposeMappingWithClaude } from '@/lib/agents/mapping';

const BodySchema = z.object({
  recordType: RecordTypeSchema,
  fileName: z.string().min(1),
  csv: z.string().min(1).max(8_000_000),
  /** A mapping the faculty member corrected by hand, if any. */
  mapping: z.record(z.string(), z.string().nullable()).optional(),
});

export const maxDuration = 60;

/**
 * Parses an uploaded CSV and returns a preview — nothing is written.
 *
 * The preview always shows the mapping that will be used, where it came from,
 * and every rejected row with a reason, because committing data you have not
 * seen mapped is how a whole cohort ends up scored against the wrong column.
 */
export async function POST(request: Request) {
  try {
    await facultyContext();

    const parsed = BodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join('; ') },
        { status: 400 },
      );
    }

    const { recordType, fileName, csv } = parsed.data;
    const { headers, rows, errors: parseErrors } = parseCsv(csv);

    if (headers.length === 0) {
      return NextResponse.json(
        { error: 'No columns found. Is this a CSV with a header row?' },
        { status: 400 },
      );
    }

    // ── Decide the mapping ────────────────────────────────────────────────
    let mapping: ColumnMapping;
    let mappingSource: 'heuristic' | 'claude' | 'manual' = 'heuristic';
    let mappingConfidence: number | null = null;
    let mappingNote: string | null = null;

    if (parsed.data.mapping) {
      mapping = finaliseMapping(parsed.data.mapping as never, headers);
      mappingSource = 'manual';
      mappingConfidence = 1;
    } else {
      const heuristic = heuristicMapping(headers, recordType);
      mappingConfidence = heuristic.confidence;

      if (heuristicsAreSufficient(heuristic)) {
        // The common case costs no tokens, no latency, and cannot hallucinate.
        mapping = finaliseMapping(heuristic.mapping, headers);
      } else {
        // Only now is Claude asked, and its answer is validated against the
        // real header list before it is trusted.
        const proposal = await proposeMappingWithClaude({
          headers,
          recordType,
          sampleRows: rows.slice(0, 5),
          partial: heuristic.mapping,
        });
        mapping = finaliseMapping(proposal.mapping, headers);
        mappingSource = 'claude';
        mappingConfidence = proposal.confidence;
        mappingNote = proposal.reasoning;
      }
    }

    const result = buildImport(rows, {
      recordType,
      mapping,
      uploadId: 'preview',
      defaultDate: new Date().toISOString().slice(0, 10),
    });

    return NextResponse.json({
      fileName,
      recordType,
      headers,
      mapping,
      mappingSource,
      mappingConfidence,
      mappingNote,
      unusedHeaders: headers.filter((h) => !Object.values(mapping).includes(h)),
      rowsTotal: result.rowsTotal,
      rowsOk: result.rowsOk,
      rowsRejected: result.rowsRejected,
      duplicatesCollapsed: result.duplicatesCollapsed,
      warnings: result.warnings,
      errors: [...parseErrors, ...result.errors].slice(0, 50),
      errorsTruncated: parseErrors.length + result.errors.length > 50,
      affectedUsns: result.affectedUsns,
      sampleRecords: result.records.slice(0, 5),
      studentCount: result.students.length,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
