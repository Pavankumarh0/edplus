import { z } from 'zod';
import { IsoDateTimeSchema, UsnSchema } from './common';

/**
 * A live meeting between a mentor and a student.
 *
 * Stored at `students/{usn}/meetings/{meetingId}` rather than in a top-level
 * collection, so the existing "a student may read their own subcollections"
 * rule gives the student app the read for free — and so a student can never
 * list anybody else's meetings, because the path does not let them express it.
 *
 * `proposed` exists for the same reason it exists on an intervention: an agent
 * may suggest a meeting, but creating a real calendar event with a real
 * joinable link is an effect outside this system, so a human presses the
 * button. A proposed meeting has no `joinUrl` and no calendar event.
 */

export const MEETING_STATUSES = ['proposed', 'scheduled', 'cancelled', 'completed'] as const;
export const MeetingStatusSchema = z.enum(MEETING_STATUSES);
export type MeetingStatus = z.infer<typeof MeetingStatusSchema>;

/**
 * Where the join link comes from.
 *
 * `google_meet` is a real event on the mentor's Google Calendar with a Meet
 * conference attached. `jitsi` needs no account on either side and is what the
 * system falls back to when Google credentials are not configured, so the
 * feature works rather than erroring. `manual` is a link a mentor pasted in.
 */
export const MEETING_PROVIDERS = ['google_meet', 'jitsi', 'manual'] as const;
export const MeetingProviderSchema = z.enum(MEETING_PROVIDERS);
export type MeetingProvider = z.infer<typeof MeetingProviderSchema>;

export const MEETING_PROVIDER_LABELS: Record<MeetingProvider, string> = {
  google_meet: 'Google Meet',
  jitsi: 'Jitsi Meet',
  manual: 'Link added by hand',
};

export const MeetingSchema = z.object({
  meetingId: z.string().min(1),
  usn: UsnSchema,

  /** Shown to both sides, so it must read sensibly to a student. */
  title: z.string().trim().min(3).max(200),
  /** Why this meeting exists. Written for the mentor; the student sees `agenda`. */
  reason: z.string().trim().min(10).max(2000),
  /** One line the student sees on their calendar. Optional. */
  agenda: z.string().trim().max(500).optional(),

  startsAt: IsoDateTimeSchema,
  endsAt: IsoDateTimeSchema,

  status: MeetingStatusSchema,
  provider: MeetingProviderSchema.nullable(),
  /** Null until scheduled. A proposed meeting has nothing to join. */
  joinUrl: z.string().url().nullable(),
  /** The Google Calendar event id, so cancelling can remove it again. */
  calendarEventId: z.string().nullable(),

  /** Set when the meeting came out of an intervention. */
  interventionId: z.string().min(1).nullable(),

  proposedBy: z.string().min(1),
  /** The faculty id that turned it into a real meeting. */
  scheduledBy: z.string().min(1).nullable(),

  createdAt: IsoDateTimeSchema,
  /** Why it could not be scheduled, when the provider refused. */
  failureReason: z.string().max(500).nullable(),
});

export type Meeting = z.infer<typeof MeetingSchema>;

/** True while the meeting is still ahead of `now` and not called off. */
export function isUpcoming(meeting: Meeting, now: Date = new Date()): boolean {
  return meeting.status === 'scheduled' && new Date(meeting.endsAt).getTime() > now.getTime();
}

/**
 * True when the join button should be live.
 *
 * Opens ten minutes early, because a student who clicks at 10:00 sharp and
 * finds a dead button assumes the meeting is cancelled, and closes at the end
 * so a stale link does not sit on the calendar looking joinable.
 */
export function isJoinable(meeting: Meeting, now: Date = new Date()): boolean {
  if (meeting.status !== 'scheduled' || !meeting.joinUrl) return false;
  const opensAt = new Date(meeting.startsAt).getTime() - 10 * 60 * 1000;
  const closesAt = new Date(meeting.endsAt).getTime();
  const t = now.getTime();
  return t >= opensAt && t <= closesAt;
}

/** Sorts soonest first — the order both calendars display. */
export function byStartTime(a: Meeting, b: Meeting): number {
  return a.startsAt.localeCompare(b.startsAt);
}
