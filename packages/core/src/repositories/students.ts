import {
  ParentContactSchema,
  StudentSchema,
  type ParentContact,
  type Student,
  type StudentUpsert,
} from '../schemas/index';
import { commitAll, nowIso, type Firestore } from './firestore';

const COLLECTION = 'students';

function studentRef(db: Firestore, usn: string) {
  return db.collection(COLLECTION).doc(usn);
}

function parentRef(db: Firestore, usn: string) {
  return studentRef(db, usn).collection('private').doc('parent');
}

export async function getStudent(db: Firestore, usn: string): Promise<Student | null> {
  const snap = await studentRef(db, usn).get();
  if (!snap.exists) return null;
  return StudentSchema.parse(snap.data());
}

export async function listStudents(db: Firestore, limit?: number): Promise<Student[]> {
  let query = db.collection(COLLECTION).orderBy('usn');
  if (limit) query = query.limit(limit);
  const snap = await query.get();
  return snap.docs.map((d) => StudentSchema.parse(d.data()));
}

/**
 * Parent contact, from the private subcollection.
 *
 * Server-side only. There is no student-facing code path that reaches this —
 * see the design note in firestore.rules.
 */
export async function getParentContact(
  db: Firestore,
  usn: string,
): Promise<ParentContact | null> {
  const snap = await parentRef(db, usn).get();
  if (!snap.exists) return null;
  return ParentContactSchema.parse(snap.data());
}

/**
 * Upserts students from a CSV import.
 *
 * Only fields actually present are written, so importing an attendance sheet
 * that carries no names never blanks names recorded by an earlier upload. That
 * is why this builds a sparse patch rather than writing the whole object.
 *
 * Parent contacts are split out into `students/{usn}/private/parent`, and the
 * student document gets a `hasParentContact` flag so the dashboard can enable
 * or disable "Call parent" without reading the contact itself.
 */
export async function upsertStudents(
  db: Firestore,
  students: StudentUpsert[],
): Promise<{ studentsWritten: number; parentsWritten: number }> {
  const timestamp = nowIso();

  const studentsWritten = await commitAll(db, students, (batch, student) => {
    const patch: Record<string, unknown> = {
      usn: student.usn,
      updatedAt: timestamp,
    };
    if (student.name !== undefined) patch.name = student.name;
    if (student.semester !== undefined) patch.semester = student.semester;
    if (student.section !== undefined) patch.section = student.section;
    if (student.department !== undefined) patch.department = student.department;
    if (student.mentorId !== undefined) patch.mentorId = student.mentorId;
    if (student.authUid !== undefined) patch.authUid = student.authUid;
    if (student.parent) patch.hasParentContact = true;

    // merge:true makes this an upsert that preserves untouched fields.
    batch.set(studentRef(db, student.usn), patch, { merge: true });
  });

  const withParents = students.filter((s) => s.parent);
  const parentsWritten = await commitAll(db, withParents, (batch, student) => {
    batch.set(
      parentRef(db, student.usn),
      { ...student.parent, updatedAt: timestamp },
      { merge: true },
    );
  });

  return { studentsWritten, parentsWritten };
}

/**
 * Backfills `createdAt` on students that are new.
 *
 * Kept separate from the upsert because `merge: true` cannot express "set this
 * only if absent" in a single write.
 */
export async function ensureCreatedAt(db: Firestore, usns: string[]): Promise<number> {
  const timestamp = nowIso();
  let written = 0;
  for (const usn of usns) {
    const ref = studentRef(db, usn);
    const snap = await ref.get();
    if (snap.exists && !snap.data()?.createdAt) {
      await ref.set({ createdAt: timestamp }, { merge: true });
      written += 1;
    }
  }
  return written;
}

/** Links a Firebase Auth uid to a student, so the mobile app can find itself. */
export async function linkAuthUid(db: Firestore, usn: string, authUid: string): Promise<void> {
  await studentRef(db, usn).set({ authUid, updatedAt: nowIso() }, { merge: true });
}
