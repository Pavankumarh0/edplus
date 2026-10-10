import { MeetingSchema, byStartTime, type Meeting } from '../schemas/index';
import type { Firestore } from './firestore';

/**
 * Meetings live under the student they are about.
 *
 * `students/{usn}/meetings/{meetingId}` — the same shape as plans and tasks,
 * so the student app reads its own meetings under the existing security rule
 * and cannot phrase a request for anyone else's.
 */
function meetingsRef(db: Firestore, usn: string) {
  return db.collection('students').doc(usn).collection('meetings');
}

export async function saveMeeting(db: Firestore, meeting: Meeting): Promise<void> {
  await meetingsRef(db, meeting.usn)
    .doc(meeting.meetingId)
    .set(MeetingSchema.parse(meeting));
}

export async function getMeeting(
  db: Firestore,
  usn: string,
  meetingId: string,
): Promise<Meeting | null> {
  const doc = await meetingsRef(db, usn).doc(meetingId).get();
  return doc.exists ? MeetingSchema.parse(doc.data()) : null;
}

/**
 * Every meeting for one student, soonest first.
 *
 * Sorted in memory rather than with `orderBy`, like the other repositories
 * here: a filter plus a sort would need a composite index for what is at most
 * a handful of documents per student.
 */
export async function listMeetings(
  db: Firestore,
  usn: string,
  opts: { status?: Meeting['status'] } = {},
): Promise<Meeting[]> {
  const snap = await meetingsRef(db, usn).get();
  const meetings = snap.docs.map((d) => MeetingSchema.parse(d.data()));
  const filtered = opts.status ? meetings.filter((m) => m.status === opts.status) : meetings;
  return filtered.sort(byStartTime);
}

/** Applies a partial change and returns the stored result. */
export async function updateMeeting(
  db: Firestore,
  usn: string,
  meetingId: string,
  patch: Partial<Meeting>,
): Promise<Meeting> {
  const current = await getMeeting(db, usn, meetingId);
  if (!current) throw new Error(`No meeting ${meetingId} for ${usn}.`);

  const next = MeetingSchema.parse({ ...current, ...patch });
  await meetingsRef(db, usn).doc(meetingId).set(next);
  return next;
}

/**
 * The mentor's agenda across every student.
 *
 * A collection-group query, because the mentor's calendar is the one view that
 * genuinely crosses students. Only the Admin SDK runs this — the security
 * rules deny collection-group reads to clients, so a student cannot use the
 * same query to see the cohort's meetings.
 */
export async function listUpcomingMeetings(
  db: Firestore,
  opts: { from?: Date; limit?: number } = {},
): Promise<Meeting[]> {
  const from = (opts.from ?? new Date()).toISOString();
  const snap = await db.collectionGroup('meetings').get();

  return snap.docs
    .map((d) => MeetingSchema.parse(d.data()))
    .filter((m) => m.status === 'scheduled' && m.endsAt >= from)
    .sort(byStartTime)
    .slice(0, opts.limit ?? 50);
}

/** Meetings a mentor has been asked to confirm, newest proposal first. */
export async function listProposedMeetings(db: Firestore): Promise<Meeting[]> {
  const snap = await db.collectionGroup('meetings').get();
  return snap.docs
    .map((d) => MeetingSchema.parse(d.data()))
    .filter((m) => m.status === 'proposed')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
