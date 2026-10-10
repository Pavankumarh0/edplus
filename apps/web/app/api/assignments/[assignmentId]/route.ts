import { NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { getAssignment, getAssignmentProgress } from '@eduplus/core/repositories';
import { errorResponse, facultyContext } from '@/lib/api';
import { qrPayload } from '../route';

/** One assignment: its QR, who has submitted, and who has not. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ assignmentId: string }> },
) {
  try {
    const ctx = await facultyContext();
    const { assignmentId } = await params;

    const assignment = await getAssignment(ctx.db, assignmentId);
    if (!assignment) {
      return NextResponse.json({ error: 'No such assignment.' }, { status: 404 });
    }

    const { progress, rows } = await getAssignmentProgress(ctx.db, assignment);

    const qr = await QRCode.toDataURL(qrPayload(assignment.code), {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 512,
      color: { dark: '#121110', light: '#FFFFFF' },
    });

    return NextResponse.json({
      assignment,
      qr,
      progress,
      // Content is included so a mentor can read the work. It is the student's
      // own submission to their own mentor, which is the point of the page.
      rows: rows.map((row) => ({
        usn: row.usn,
        name: row.name,
        status: row.submission?.status ?? null,
        submittedAt: row.submission?.submittedAt ?? null,
        version: row.submission?.version ?? 0,
        content: row.submission?.content ?? null,
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
