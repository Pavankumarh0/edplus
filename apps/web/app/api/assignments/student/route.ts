import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  describeRemaining,
  isEligible,
  normaliseAssignmentCode,
  timeRemainingMs,
  type Assignment,
  type Submission,
} from '@eduplus/core';
import {
  getAssignmentByCode,
  getAssignment,
  getDb,
  getStudent,
  getSubmission,
  listAssignmentsForStudent,
  listSubmissionsForStudent,
  recordSubmission,
  writeAudit,
} from '@eduplus/core/repositories';
import { errorResponse } from '@/lib/api';
import { planlyActor, requireStudent } from '@/lib/student-auth';

/**
 * Assignments, for the student app.
 *
 * Two rules run through everything here:
 *
 *   1. The USN comes from the verified token, never from the request. A
 *      student cannot submit as someone else because there is no field to say
 *      who they are.
 *   2. The deadline is decided by this server's clock. A phone with its date
 *      wound back submits late and is told so.
 */

const SubmitSchema = z.object({
  assignmentId: z.string().min(1),
  content: z.string().trim().min(1).max(8000),
});

/**
 * What a scan sends.
 *
 * Generous on length because the QR encodes a URL, not the bare code — a
 * phone's own camera app should show a human something meaningful. The handler
 * strips it to the last path segment. Capping this at the code's own length
 * rejected every scan before the stripping ever ran.
 */
const ResolveSchema = z.object({ code: z.string().trim().min(1).max(300) });

function present(assignment: Assignment, submission: Submission | null, now: Date) {
  const remaining = timeRemainingMs(assignment, now);
  return {
    assignmentId: assignment.assignmentId,
    code: assignment.code,
    title: assignment.title,
    subject: assignment.subject,
    instructions: assignment.instructions,
    facultyName: assignment.facultyName,
    deadline: assignment.deadline,
    maxMarks: assignment.maxMarks ?? null,
    acceptLate: assignment.acceptLate,
    overdue: remaining < 0,
    remaining: describeRemaining(remaining),
    submission: submission
      ? {
          content: submission.content,
          submittedAt: submission.submittedAt,
          status: submission.status,
          version: submission.version,
          history: submission.history,
        }
      : null,
    /** One of: not_started, submitted_on_time, submitted_late, overdue. */
    state: submission
      ? submission.status === 'on_time'
        ? 'submitted_on_time'
        : 'submitted_late'
      : remaining < 0
        ? 'overdue'
        : 'not_started',
  };
}

/** Everything this student is eligible for, with their own status on each. */
export async function GET(request: Request) {
  try {
    const student = await requireStudent(request);
    const db = getDb();

    const record = await getStudent(db, student.usn);
    if (!record) return NextResponse.json({ error: 'No student record.' }, { status: 404 });

    const [assignments, submissions] = await Promise.all([
      listAssignmentsForStudent(db, record),
      listSubmissionsForStudent(db, student.usn),
    ]);

    const byId = new Map(submissions.map((s) => [s.assignmentId, s]));
    const now = new Date();

    return NextResponse.json({
      assignments: assignments.map((a) => present(a, byId.get(a.assignmentId) ?? null, now)),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Resolves a scanned or typed code.
 *
 * Eligibility is checked here, against the student's own record. A code that
 * travelled across a projector is not a secret, so finding it is not the same
 * as being allowed to open it.
 */
export async function PUT(request: Request) {
  try {
    const student = await requireStudent(request);
    const db = getDb();

    const parsed = ResolveSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'That scan did not contain a readable code. Try again, or type the code.' },
        { status: 400 },
      );
    }

    // A QR may carry a full URL; take the last path segment either way.
    const raw = parsed.data.code.trim();
    const candidate = raw.includes('/') ? raw.split('/').filter(Boolean).pop()! : raw;
    const code = normaliseAssignmentCode(candidate);

    const assignment = await getAssignmentByCode(db, code);
    if (!assignment) {
      return NextResponse.json(
        { error: `No assignment with code ${code}. Check the code on the board.` },
        { status: 404 },
      );
    }

    const record = await getStudent(db, student.usn);
    if (!record || !isEligible(assignment, record)) {
      await writeAudit(db, {
        actor: planlyActor(student),
        tool: 'assignment.resolve',
        args: { code, assignmentId: assignment.assignmentId },
        status: 'permission_denied',
        errorMessage: 'Not in the eligible class.',
      });
      return NextResponse.json(
        {
          error:
            `That assignment is for semester ${assignment.semester}, section ` +
            `${assignment.section}. It is not for your class.`,
        },
        { status: 403 },
      );
    }

    const submission = await getSubmission(db, student.usn, assignment.assignmentId);
    // Scanning is not submitting. This only opens it.
    return NextResponse.json({ assignment: present(assignment, submission, new Date()) });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Submits, or replaces an earlier attempt. */
export async function POST(request: Request) {
  try {
    const student = await requireStudent(request);
    const db = getDb();

    const parsed = SubmitSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join('; ') },
        { status: 400 },
      );
    }

    const assignment = await getAssignment(db, parsed.data.assignmentId);
    if (!assignment) {
      return NextResponse.json({ error: 'No such assignment.' }, { status: 404 });
    }

    const record = await getStudent(db, student.usn);
    if (!record || !isEligible(assignment, record)) {
      return NextResponse.json({ error: 'That assignment is not for your class.' }, { status: 403 });
    }

    // The server's clock, taken once, used for both the decision and the stamp.
    const now = new Date();
    const willBeLate = now.getTime() > new Date(assignment.deadline).getTime();

    if (willBeLate && !assignment.acceptLate) {
      return NextResponse.json(
        {
          error:
            'The deadline has passed and this assignment does not accept late work. ' +
            'Talk to your mentor — your work is not lost, it just cannot be submitted here.',
        },
        { status: 409 },
      );
    }

    if (assignment.status === 'closed') {
      return NextResponse.json(
        { error: 'Your mentor has closed this assignment.' },
        { status: 409 },
      );
    }

    const submission = await recordSubmission(db, {
      assignment,
      usn: student.usn,
      content: parsed.data.content,
      now,
    });

    await writeAudit(db, {
      actor: planlyActor(student),
      tool: 'assignment.submit',
      args: {
        assignmentId: assignment.assignmentId,
        status: submission.status,
        version: submission.version,
      },
      status: 'ok',
    });

    return NextResponse.json({
      assignment: present(assignment, submission, now),
      message:
        submission.status === 'on_time'
          ? submission.version > 1
            ? `Replaced. Your work is in, on time — attempt ${submission.version}.`
            : 'Submitted on time.'
          : 'Submitted late. Your mentor can see it, marked late.',
    });
  } catch (error) {
    return errorResponse(error);
  }
}
