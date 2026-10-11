import { NextResponse } from 'next/server';
import { z } from 'zod';
import QRCode from 'qrcode';
import { AssignmentSchema, type Assignment } from '@eduplus/core';
import {
  getAssignmentProgress,
  listAssignments,
  reserveAssignmentCode,
  saveAssignment,
  writeAudit,
} from '@eduplus/core/repositories';
import { errorResponse, facultyContext, facultyDisplayName } from '@/lib/api';

/**
 * Assignments, for faculty.
 *
 * The QR is generated here rather than stored: it is a pure function of the
 * code, so keeping an image in the database would just be a second copy that
 * can go stale.
 */

const CreateSchema = z.object({
  title: z.string().trim().min(3).max(200),
  subject: z.string().trim().min(1).max(80),
  instructions: z.string().trim().min(1).max(4000),
  semester: z.number().int().min(1).max(8),
  section: z.string().trim().min(1).max(8),
  deadline: z.string().datetime({ offset: true }),
  maxMarks: z.number().int().min(1).max(1000).optional(),
  acceptLate: z.boolean().optional(),
});

/** What the QR encodes: the code, and a hint about where it came from. */
export function qrPayload(code: string): string {
  const base = process.env.PUBLIC_BASE_URL?.replace(/\/+$/, '') ?? 'https://eduplus.local';
  // A URL rather than a bare code, so a phone's built-in camera app shows
  // something meaningful to someone who scans it outside the EduPlus app. The
  // app itself only reads the code at the end.
  return `${base}/a/${code}`;
}

export async function GET() {
  try {
    const ctx = await facultyContext();
    const assignments = await listAssignments(ctx.db);

    // Counts for the list view. Thirty students per assignment, so this is a
    // handful of reads rather than something that needs denormalising.
    const withProgress = await Promise.all(
      assignments.map(async (assignment) => ({
        assignment,
        progress: (await getAssignmentProgress(ctx.db, assignment)).progress,
      })),
    );

    return NextResponse.json({ assignments: withProgress });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await facultyContext();

    const parsed = CreateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') },
        { status: 400 },
      );
    }

    // A deadline already in the past would mark every submission late before
    // anyone had a chance to start.
    if (new Date(parsed.data.deadline) <= new Date()) {
      return NextResponse.json(
        { error: 'The deadline is already in the past. Pick a time ahead of now.' },
        { status: 400 },
      );
    }

    const code = await reserveAssignmentCode(ctx.db);
    const facultyName = await facultyDisplayName();
    const now = new Date().toISOString();

    const assignment: Assignment = AssignmentSchema.parse({
      assignmentId: `as_${code}_${Date.now().toString(36).slice(-4)}`,
      code,
      ...parsed.data,
      facultyId: ctx.actor.id,
      facultyName,
      acceptLate: parsed.data.acceptLate ?? true,
      status: 'open',
      createdAt: now,
    } satisfies Assignment);

    await saveAssignment(ctx.db, assignment);
    await writeAudit(ctx.db, {
      actor: ctx.actor,
      tool: 'assignment.create',
      args: { assignmentId: assignment.assignmentId, semester: assignment.semester, section: assignment.section },
      status: 'ok',
    });

    const qr = await QRCode.toDataURL(qrPayload(code), {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 512,
      color: { dark: '#121110', light: '#FFFFFF' },
    });

    return NextResponse.json({
      assignment,
      qr,
      message: `${assignment.title} created. Show the code ${code} to semester ${assignment.semester}, section ${assignment.section}.`,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
