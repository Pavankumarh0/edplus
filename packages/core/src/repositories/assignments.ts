import {
  AssignmentSchema,
  SubmissionSchema,
  classifySubmission,
  isEligible,
  makeAssignmentCode,
  type Assignment,
  type AssignmentProgress,
  type Submission,
} from '../schemas/index';
import { listStudents } from './students';
import { nowIso, type Firestore } from './firestore';

/**
 * Assignments live at `assignments/{assignmentId}`; a student's work lives at
 * `students/{usn}/submissions/{assignmentId}`.
 *
 * The submission hangs off the student for the same reason everything else
 * does: the existing rule gives them their own, and makes another student's
 * inexpressible rather than merely refused. One document per assignment per
 * student is also the uniqueness constraint the brief asks for — you cannot
 * create a duplicate when the id is the assignment's.
 */

const ASSIGNMENTS = 'assignments';

export async function saveAssignment(db: Firestore, assignment: Assignment): Promise<void> {
  await db
    .collection(ASSIGNMENTS)
    .doc(assignment.assignmentId)
    .set(AssignmentSchema.parse(assignment));
}

export async function getAssignment(
  db: Firestore,
  assignmentId: string,
): Promise<Assignment | null> {
  const doc = await db.collection(ASSIGNMENTS).doc(assignmentId).get();
  return doc.exists ? AssignmentSchema.parse(doc.data()) : null;
}

/** Resolves the code from a QR or typed by hand. */
export async function getAssignmentByCode(
  db: Firestore,
  code: string,
): Promise<Assignment | null> {
  const snap = await db
    .collection(ASSIGNMENTS)
    .where('code', '==', code.toUpperCase())
    .limit(1)
    .get();
  return snap.empty ? null : AssignmentSchema.parse(snap.docs[0]!.data());
}

/**
 * A code nothing else is using.
 *
 * Six characters from a 32-letter alphabet is a billion combinations, so a
 * collision is vanishingly unlikely — but "vanishingly unlikely" applied to a
 * student opening the wrong assignment is worth five lines of checking.
 */
export async function reserveAssignmentCode(db: Firestore): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = makeAssignmentCode();
    if (!(await getAssignmentByCode(db, code))) return code;
  }
  throw new Error('Could not allocate an unused assignment code. Try again.');
}

export async function listAssignments(
  db: Firestore,
  opts: { facultyId?: string } = {},
): Promise<Assignment[]> {
  const snap = await db.collection(ASSIGNMENTS).get();
  // Sorted in memory, like the other repositories here: a filter plus a sort
  // would need a composite index for what is a handful of documents.
  return snap.docs
    .map((d) => AssignmentSchema.parse(d.data()))
    .filter((a) => !opts.facultyId || a.facultyId === opts.facultyId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Assignments one student may see, newest first. */
export async function listAssignmentsForStudent(
  db: Firestore,
  student: { semester: number; section: string },
): Promise<Assignment[]> {
  const all = await listAssignments(db);
  return all.filter((assignment) => isEligible(assignment, student));
}

// ─────────────────────────────────────────────────────────────────────────────
// Submissions
// ─────────────────────────────────────────────────────────────────────────────

function submissionsRef(db: Firestore, usn: string) {
  return db.collection('students').doc(usn).collection('submissions');
}

export async function getSubmission(
  db: Firestore,
  usn: string,
  assignmentId: string,
): Promise<Submission | null> {
  const doc = await submissionsRef(db, usn).doc(assignmentId).get();
  return doc.exists ? SubmissionSchema.parse(doc.data()) : null;
}

export async function listSubmissionsForStudent(
  db: Firestore,
  usn: string,
): Promise<Submission[]> {
  const snap = await submissionsRef(db, usn).get();
  return snap.docs
    .map((d) => SubmissionSchema.parse(d.data()))
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
}

/**
 * Records a submission, with the deadline enforced here and nowhere else.
 *
 * `now` is the server's clock. The student's device never gets a say in
 * whether their work was on time — that is the one thing a client could lie
 * about that actually matters.
 *
 * Resubmitting replaces the content and keeps the previous attempt in
 * `history`, so a student who overwrites good work with bad has not lost it.
 */
export async function recordSubmission(
  db: Firestore,
  input: {
    assignment: Assignment;
    usn: string;
    content: string;
    now: Date;
  },
): Promise<Submission> {
  const ref = submissionsRef(db, input.usn).doc(input.assignment.assignmentId);
  const status = classifySubmission(input.assignment, input.now);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const existing = snap.exists ? SubmissionSchema.parse(snap.data()) : null;

    const next: Submission = SubmissionSchema.parse({
      assignmentId: input.assignment.assignmentId,
      usn: input.usn,
      content: input.content,
      submittedAt: input.now.toISOString(),
      status,
      version: (existing?.version ?? 0) + 1,
      history: existing
        ? [
            ...existing.history,
            {
              content: existing.content,
              submittedAt: existing.submittedAt,
              status: existing.status,
            },
          ].slice(-10)
        : [],
    });

    tx.set(ref, next);
    return next;
  });
}

/**
 * Who has submitted and who has not.
 *
 * A collection-group query would be one call instead of N, but the rules deny
 * collection-group reads to clients and the cohort is thirty students — the
 * simple version is fast enough and cannot accidentally become a path that
 * serves one student another's work.
 */
export async function getAssignmentProgress(
  db: Firestore,
  assignment: Assignment,
): Promise<{
  progress: AssignmentProgress;
  rows: {
    usn: string;
    name: string;
    submission: Submission | null;
  }[];
}> {
  const students = (await listStudents(db)).filter((student) =>
    isEligible(assignment, student),
  );

  const rows = await Promise.all(
    students.map(async (student) => ({
      usn: student.usn,
      name: student.name,
      submission: await getSubmission(db, student.usn, assignment.assignmentId),
    })),
  );

  const submitted = rows.filter((r) => r.submission !== null);

  return {
    progress: {
      eligible: rows.length,
      submitted: submitted.length,
      onTime: submitted.filter((r) => r.submission!.status === 'on_time').length,
      late: submitted.filter((r) => r.submission!.status === 'late').length,
      missing: rows.length - submitted.length,
    },
    rows: rows.sort((a, b) => {
      // Who has not submitted comes first: that is the list a mentor acts on.
      const aDone = a.submission !== null;
      const bDone = b.submission !== null;
      if (aDone !== bDone) return aDone ? 1 : -1;
      return a.name.localeCompare(b.name);
    }),
  };
}

/**
 * Assignments this student missed — past deadline with nothing submitted.
 *
 * Reported as evidence a mentor can see, not written into the risk score.
 * Turning a missed assignment into an academic record is a separate, deliberate
 * step: a deadline passed during a power cut is not the same fact as a student
 * who did not do the work, and the engine cannot tell those apart.
 */
export async function listMissedAssignments(
  db: Firestore,
  student: { usn: string; semester: number; section: string },
  now: Date = new Date(),
): Promise<Assignment[]> {
  const [assignments, submissions] = await Promise.all([
    listAssignmentsForStudent(db, student),
    listSubmissionsForStudent(db, student.usn),
  ]);

  const submittedIds = new Set(submissions.map((s) => s.assignmentId));
  return assignments.filter(
    (assignment) =>
      new Date(assignment.deadline) < now && !submittedIds.has(assignment.assignmentId),
  );
}

export async function closeAssignment(db: Firestore, assignmentId: string): Promise<void> {
  await db
    .collection(ASSIGNMENTS)
    .doc(assignmentId)
    .set({ status: 'closed', updatedAt: nowIso() }, { merge: true });
}
