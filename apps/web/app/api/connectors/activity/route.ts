import { NextResponse } from 'next/server';
import { listAudit } from '@eduplus/core/repositories';
import { errorResponse, facultyContext } from '@/lib/api';

/**
 * Tool activity, read from the audit log the system already writes.
 *
 * Arguments were redacted when the row was written, not here — a phone number
 * that reached the log would stay in it. This endpoint reshapes what is
 * already safe and adds nothing.
 */
export async function GET(request: Request) {
  try {
    const ctx = await facultyContext();
    const limit = Number(new URL(request.url).searchParams.get('limit') ?? 60);

    const entries = await listAudit(ctx.db, Math.min(Math.max(limit, 1), 200));

    return NextResponse.json({
      entries: entries.map((entry) => ({
        auditId: entry.auditId,
        tool: entry.tool,
        caller: entry.actor.agentName ?? entry.actor.kind,
        callerKind: entry.actor.kind,
        // Present for Planly and student sign-ins; it is the scope the call ran
        // under, and seeing it is how a reviewer checks the confinement held.
        scopedTo: entry.actor.usn ?? null,
        status: entry.status,
        errorMessage: entry.errorMessage,
        durationMs: entry.durationMs ?? null,
        at: entry.at,
        // A short shape of the arguments rather than the arguments: enough to
        // tell two calls apart without putting a student's record in a list.
        argKeys: Object.keys(entry.args).slice(0, 6),
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
