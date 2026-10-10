import {
  ExitSessionSchema,
  ExitVerificationSchema,
  isSessionLive,
  isTokenValid,
  type ExitSession,
  type ExitVerification,
} from '../schemas/index';
import { listStudents } from './students';
import { type Firestore } from './firestore';

/**
 * Exit sessions at `exitSessions/{sessionId}`, with each student's
 * verification at `exitSessions/{sessionId}/verifications/{usn}`.
 *
 * The USN as the document id is the uniqueness rule, not a constraint bolted
 * on beside it: one student cannot hold two verifications for one session
 * because there is nowhere to put the second. A repeat scan returns what is
 * already there.
 *
 * Clients never read these collections. The session document carries the
 * secret that mints valid codes, so it is server-only, and the API returns a
 * stripped copy.
 */

const SESSIONS = 'exitSessions';

export async function saveExitSession(db: Firestore, session: ExitSession): Promise<void> {
  await db.collection(SESSIONS).doc(session.sessionId).set(ExitSessionSchema.parse(session));
}

export async function getExitSession(
  db: Firestore,
  sessionId: string,
): Promise<ExitSession | null> {
  const doc = await db.collection(SESSIONS).doc(sessionId).get();
  return doc.exists ? ExitSessionSchema.parse(doc.data()) : null;
}

export async function listExitSessions(
  db: Firestore,
  opts: { facultyId?: string } = {},
): Promise<ExitSession[]> {
  const snap = await db.collection(SESSIONS).get();
  return snap.docs
    .map((d) => ExitSessionSchema.parse(d.data()))
    .filter((s) => !opts.facultyId || s.facultyId === opts.facultyId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function endExitSession(
  db: Firestore,
  sessionId: string,
  now: Date = new Date(),
): Promise<void> {
  await db
    .collection(SESSIONS)
    .doc(sessionId)
    .set({ status: 'ended', endedAt: now.toISOString() }, { merge: true });
}

export async function listVerifications(
  db: Firestore,
  sessionId: string,
): Promise<ExitVerification[]> {
  const snap = await db.collection(SESSIONS).doc(sessionId).collection('verifications').get();
  return snap.docs
    .map((d) => ExitVerificationSchema.parse(d.data()))
    .sort((a, b) => a.verifiedAt.localeCompare(b.verifiedAt));
}

export type VerifyOutcome =
  | { ok: true; verification: ExitVerification; repeat: boolean }
  | { ok: false; reason: string };

/**
 * Records one student's exit, or explains why not.
 *
 * Every check is here rather than spread across the caller: the session must
 * exist, be live, the token must be currently valid, and the student must be
 * in the authorised class. A rejected scan writes nothing — there is no such
 * thing as a failed verification record, because a record that says "no" would
 * eventually be read as if it said something about the student.
 */
export async function verifyExit(
  db: Firestore,
  input: {
    sessionId: string;
    token: string;
    student: { usn: string; semester: number; section: string };
    now: Date;
  },
): Promise<VerifyOutcome> {
  const session = await getExitSession(db, input.sessionId);
  if (!session) return { ok: false, reason: 'That exit code is not one of ours.' };

  if (!isSessionLive(session, input.now)) {
    return {
      ok: false,
      reason:
        session.endedAt !== null || session.status === 'ended'
          ? 'Your mentor has ended this session.'
          : 'That exit code has expired. Ask your mentor for a new one.',
    };
  }

  if (!isTokenValid(session.secret, input.token, input.now)) {
    // Almost always a photograph of the screen taken more than a few seconds
    // ago, which is exactly what the rotation is for.
    return {
      ok: false,
      reason: 'That code has already changed. Scan the one on the screen now.',
    };
  }

  if (
    session.semester !== input.student.semester ||
    session.section.trim().toUpperCase() !== input.student.section.trim().toUpperCase()
  ) {
    return { ok: false, reason: 'This exit session is not for your class.' };
  }

  const ref = db
    .collection(SESSIONS)
    .doc(input.sessionId)
    .collection('verifications')
    .doc(input.student.usn);

  return db.runTransaction(async (tx) => {
    const existing = await tx.get(ref);
    if (existing.exists) {
      // Scanning twice is not an error and must not move the timestamp — the
      // first one is the fact.
      return {
        ok: true as const,
        verification: ExitVerificationSchema.parse(existing.data()),
        repeat: true,
      };
    }

    const verification = ExitVerificationSchema.parse({
      sessionId: input.sessionId,
      usn: input.student.usn,
      verifiedAt: input.now.toISOString(),
    });
    tx.set(ref, verification);
    return { ok: true as const, verification, repeat: false };
  });
}

/** Who has verified and who has not, for the mentor's screen. */
export async function getExitProgress(
  db: Firestore,
  session: ExitSession,
): Promise<{
  verified: number;
  eligible: number;
  rows: { usn: string; name: string; verifiedAt: string | null }[];
}> {
  const [students, verifications] = await Promise.all([
    listStudents(db),
    listVerifications(db, session.sessionId),
  ]);

  const eligible = students.filter(
    (s) =>
      s.semester === session.semester &&
      s.section.trim().toUpperCase() === session.section.trim().toUpperCase(),
  );
  const byUsn = new Map(verifications.map((v) => [v.usn, v]));

  const rows = eligible
    .map((s) => ({
      usn: s.usn,
      name: s.name,
      verifiedAt: byUsn.get(s.usn)?.verifiedAt ?? null,
    }))
    // Not verified first: that is the list a mentor scans the room against.
    .sort((a, b) => {
      const aDone = a.verifiedAt !== null;
      const bDone = b.verifiedAt !== null;
      if (aDone !== bDone) return aDone ? 1 : -1;
      return a.name.localeCompare(b.name);
    });

  return { verified: byUsn.size, eligible: eligible.length, rows };
}

/**
 * A mentor recording a scan that genuinely failed — a flat phone, a broken
 * camera. Written the same way as any other verification so it cannot be told
 * apart later by shape, but the audit log records who did it and why.
 */
export async function overrideVerification(
  db: Firestore,
  sessionId: string,
  usn: string,
  now: Date = new Date(),
): Promise<ExitVerification> {
  const ref = db.collection(SESSIONS).doc(sessionId).collection('verifications').doc(usn);
  const existing = await ref.get();
  if (existing.exists) return ExitVerificationSchema.parse(existing.data());

  const verification = ExitVerificationSchema.parse({
    sessionId,
    usn,
    verifiedAt: now.toISOString(),
  });
  await ref.set(verification);
  return verification;
}
