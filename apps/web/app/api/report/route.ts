import { NextResponse } from 'next/server';
import { z } from 'zod';
import { UsnSchema } from '@eduplus/core';
import { generateReport } from '@/lib/agents/report';
import { errorResponse, facultyContext } from '@/lib/api';

const BodySchema = z.object({ usn: UsnSchema });

/** A report run is several model calls; allow room before the platform cuts it. */
export const maxDuration = 120;

/**
 * Generates and stores a student report.
 *
 * Faculty-only: the agent is allowed to write a report, but a human decides
 * when one is written and for whom.
 */
export async function POST(request: Request) {
  try {
    const ctx = await facultyContext();

    const parsed = BodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Expected a usn.' }, { status: 400 });
    }

    const report = await generateReport(parsed.data.usn, ctx);

    return NextResponse.json({
      reportId: report.reportId,
      message: `Report written using ${report.toolsUsed.length} tool call${
        report.toolsUsed.length === 1 ? '' : 's'
      }.`,
      toolsUsed: report.toolsUsed,
      usage: { inputTokens: report.inputTokens, outputTokens: report.outputTokens },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
