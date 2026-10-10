import { z } from 'zod';
import { IsoDateTimeSchema, UsnSchema } from './common';

/**
 * Assignments distributed by QR code.
 *
 * The QR carries one thing: a short opaque code identifying the assignment.
 * No student identity, no credentials, no deadline — a code that travelled
 * across a projector and three phone cameras is not a secret, so nothing is
 * trusted to it. Eligibility is checked server-side against the signed-in
 * student's own semester and section, which means a leaked code still cannot
 * let the wrong student in.
 *
 * The same code is typeable. A camera pointed at a projector in a bright room
 * fails often enough that a six-character fallback is not a nicety.
 */

/** No O/0, I/1 or similar — this gets read off a screen and typed by hand. */
// L is out as well as I/1 and O/0: the normaliser folds L into I, so a code
// containing L could never be resolved once someone typed it.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ASSIGNMENT_CODE_LENGTH = 6;

export function makeAssignmentCode(random: () => number = Math.random): string {
  let code = '';
  for (let i = 0; i < ASSIGNMENT_CODE_LENGTH; i += 1) {
    code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  }
  return code;
}

/** Normalises what a student typed: case, spaces, and the usual misreadings. */
export function normaliseAssignmentCode(input: string): string {
  return input
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[O]/g, '0')
    .replace(/[I|L]/g, '1')
    // Then back into the alphabet, since 0 and 1 are not in it.
    .replace(/0/g, 'O')
    .replace(/1/g, 'I');
}

export const SUBMISSION_STATUSES = ['on_time', 'late'] as const;
export const SubmissionStatusSchema = z.enum(SUBMISSION_STATUSES);
export type SubmissionStatus = z.infer<typeof SubmissionStatusSchema>;

export const ASSIGNMENT_STATUSES = ['open', 'closed'] as const;
export const AssignmentStatusSchema = z.enum(ASSIGNMENT_STATUSES);
export type AssignmentStatus = z.infer<typeof AssignmentStatusSchema>;

export const AssignmentSchema = z.object({
  assignmentId: z.string().min(1),
  /** What the QR encodes and what a student can type instead. */
  code: z.string().length(ASSIGNMENT_CODE_LENGTH),

  title: z.string().trim().min(3).max(200),
  subject: z.string().trim().min(1).max(80),
  instructions: z.string().trim().min(1).max(4000),

  facultyId: z.string().min(1),
  facultyName: z.string().trim().min(1).max(120),

  /** Who may open it. Checked against the student's own record, server-side. */
  semester: z.number().int().min(1).max(8),
  section: z.string().trim().min(1).max(8),

  maxMarks: z.number().int().min(1).max(1000).optional(),
  deadline: IsoDateTimeSchema,

  /**
   * Whether work after the deadline is taken.
   *
   * Late work is recorded as late, never silently discarded — a student who
   * submitted at 17:02 did the work, and throwing it away loses the evidence
   * that they did.
   */
  acceptLate: z.boolean().default(true),

  status: AssignmentStatusSchema.default('open'),
  createdAt: IsoDateTimeSchema,
});

export type Assignment = z.infer<typeof AssignmentSchema>;

export const SubmissionSchema = z.object({
  assignmentId: z.string().min(1),
  usn: UsnSchema,

  /** Typed text or a link. File upload is not supported yet. */
  content: z.string().trim().min(1).max(8000),

  /** Server clock, always. A device clock is an input, not a fact. */
  submittedAt: IsoDateTimeSchema,
  status: SubmissionStatusSchema,

  /** Counts edits. A resubmission replaces the content but not the history. */
  version: z.number().int().min(1).default(1),
  /** Every earlier attempt, so work is never lost by being replaced. */
  history: z
    .array(
      z.object({
        content: z.string().max(8000),
        submittedAt: IsoDateTimeSchema,
        status: SubmissionStatusSchema,
      }),
    )
    .default([]),
});

export type Submission = z.infer<typeof SubmissionSchema>;

/**
 * On time or late, decided by the server's clock against the deadline.
 *
 * Takes `now` so it is testable and so the caller cannot accidentally use a
 * timestamp that came from a request body.
 */
export function classifySubmission(
  assignment: Pick<Assignment, 'deadline'>,
  now: Date,
): SubmissionStatus {
  return now.getTime() <= new Date(assignment.deadline).getTime() ? 'on_time' : 'late';
}

/** True when this student's record makes them eligible for this assignment. */
export function isEligible(
  assignment: Pick<Assignment, 'semester' | 'section'>,
  student: { semester: number; section: string },
): boolean {
  return (
    assignment.semester === student.semester &&
    assignment.section.trim().toUpperCase() === student.section.trim().toUpperCase()
  );
}

/** Milliseconds left, negative once the deadline has passed. */
export function timeRemainingMs(assignment: Pick<Assignment, 'deadline'>, now: Date): number {
  return new Date(assignment.deadline).getTime() - now.getTime();
}

/** "2 days left", "4 hours left", "overdue by 20 minutes". */
export function describeRemaining(ms: number): string {
  const overdue = ms < 0;
  const abs = Math.abs(ms);
  const minutes = Math.round(abs / 60_000);
  const hours = Math.round(abs / 3_600_000);
  const days = Math.round(abs / 86_400_000);

  const amount =
    abs < 90 * 60_000
      ? `${minutes} minute${minutes === 1 ? '' : 's'}`
      : abs < 36 * 3_600_000
        ? `${hours} hour${hours === 1 ? '' : 's'}`
        : `${days} day${days === 1 ? '' : 's'}`;

  return overdue ? `overdue by ${amount}` : `${amount} left`;
}

/** What a faculty member sees while submissions come in. */
export interface AssignmentProgress {
  eligible: number;
  submitted: number;
  onTime: number;
  late: number;
  missing: number;
}
