import { z } from 'zod';
import { UsnSchema, type Meeting } from '../schemas/index';
import { getStudent } from '../repositories/students';
import {
  getMeeting,
  listMeetings,
  listUpcomingMeetings,
  saveMeeting,
  updateMeeting,
} from '../repositories/meetings';
import { createMeetingLink, deleteCalendarEvent } from '../meetings/provider';
import type { ToolContext, ToolDefinition } from './types';

/**
 * Mentor–student meetings.
 *
 * The split here follows `propose_intervention` / `schedule_parent_call`: an
 * agent may draft a meeting and read the calendar, but turning a proposal into
 * a real event with a real joinable link reaches outside this system — it
 * writes to a mentor's actual Google Calendar and emails the invitees — so it
 * is consequential and a human presses the button. The copilot can therefore
 * run the whole flow conversationally and still never book anyone's time by
 * itself.
 */

function nowIso(ctx: ToolContext): string {
  return (ctx.now?.() ?? new Date()).toISOString();
}

/** Rejects a slot that is backwards, zero-length, or implausibly long. */
const SlotSchema = z
  .object({
    startsAt: z.string().datetime({ offset: true }),
    endsAt: z.string().datetime({ offset: true }),
  })
  .refine((s) => new Date(s.endsAt) > new Date(s.startsAt), {
    message: 'endsAt must be after startsAt',
    path: ['endsAt'],
  })
  .refine(
    (s) => new Date(s.endsAt).getTime() - new Date(s.startsAt).getTime() <= 4 * 60 * 60 * 1000,
    { message: 'A meeting longer than four hours is almost certainly a mistake', path: ['endsAt'] },
  );

// ─────────────────────────────────────────────────────────────────────────────

const proposeMeetingTool: ToolDefinition<
  {
    usn: string;
    title: string;
    reason: string;
    agenda?: string;
    startsAt: string;
    endsAt: string;
    interventionId?: string;
  },
  { meetingId: string; status: string }
> = {
  name: 'propose_meeting',
  title: 'Propose meeting',
  description:
    'Propose a live video meeting between the mentor and a student. The proposal is ' +
    'recorded with status "proposed" and has no join link until a faculty member ' +
    'confirms it in the dashboard — you cannot confirm it, and you must not tell anyone ' +
    'the meeting is booked. Give times in ISO 8601 with an offset (for example ' +
    '2026-10-14T10:00:00+05:30), keep it inside college hours, and give a reason that ' +
    'cites the numbers justifying it.',
  inputSchema: z
    .object({
      usn: UsnSchema,
      title: z.string().trim().min(3).max(200),
      reason: z.string().trim().min(10).max(2000),
      agenda: z.string().trim().max(500).optional(),
      startsAt: z.string().datetime({ offset: true }),
      endsAt: z.string().datetime({ offset: true }),
      interventionId: z.string().min(1).optional(),
    })
    .superRefine((value, ctx) => {
      const slot = SlotSchema.safeParse(value);
      if (!slot.success) {
        for (const issue of slot.error.issues) ctx.addIssue(issue);
      }
    }),
  consequential: false,
  readOnly: false,
  async handler(input, ctx) {
    const student = await getStudent(ctx.db, input.usn);
    if (!student) throw new Error(`No student with USN ${input.usn}.`);

    const meetingId = `mt_${input.usn}_${Date.now().toString(36)}`;
    const meeting: Meeting = {
      meetingId,
      usn: input.usn,
      title: input.title,
      reason: input.reason,
      agenda: input.agenda,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      // The only status an agent can create. A proposal is not a booking.
      status: 'proposed',
      provider: null,
      joinUrl: null,
      calendarEventId: null,
      interventionId: input.interventionId ?? null,
      proposedBy: ctx.actor.agentName ?? ctx.actor.id,
      scheduledBy: null,
      createdAt: nowIso(ctx),
      failureReason: null,
    };

    await saveMeeting(ctx.db, meeting);
    return { meetingId, status: 'proposed' };
  },
};

const listMeetingsTool: ToolDefinition<
  { usn?: string; limit?: number },
  { meetings: Meeting[] }
> = {
  name: 'list_meetings',
  title: 'List meetings',
  description:
    'Read meetings. With a usn, every meeting for that student, soonest first. Without ' +
    'one, the mentor\'s upcoming agenda across all students. Use this before proposing a ' +
    'time so you do not double-book the mentor or propose a slot that already exists.',
  inputSchema: z.object({
    usn: UsnSchema.optional(),
    limit: z.number().int().min(1).max(100).optional(),
  }),
  consequential: false,
  readOnly: true,
  async handler(input, ctx) {
    if (input.usn) {
      const meetings = await listMeetings(ctx.db, input.usn);
      return { meetings: meetings.slice(0, input.limit ?? 50) };
    }
    const meetings = await listUpcomingMeetings(ctx.db, {
      from: ctx.now?.() ?? new Date(),
      limit: input.limit ?? 50,
    });
    return { meetings };
  },
};

const scheduleMeetingTool: ToolDefinition<
  {
    usn: string;
    meetingId?: string;
    title?: string;
    reason?: string;
    agenda?: string;
    startsAt?: string;
    endsAt?: string;
    interventionId?: string;
    attendeeEmails?: string[];
  },
  { meetingId: string; status: string; joinUrl: string; provider: string; note: string | null }
> = {
  name: 'schedule_meeting',
  title: 'Schedule meeting',
  description:
    'Create the real meeting: a calendar event with a live video link that both the mentor ' +
    'and the student can join from their dashboards. Requires faculty approval and is not ' +
    'available to agents — an agent should propose_meeting instead and let a faculty member ' +
    'press the button. Pass a meetingId to confirm an existing proposal, or the full details ' +
    'to create and confirm in one step.',
  inputSchema: z.object({
    usn: UsnSchema,
    meetingId: z.string().min(1).optional(),
    title: z.string().trim().min(3).max(200).optional(),
    reason: z.string().trim().min(10).max(2000).optional(),
    agenda: z.string().trim().max(500).optional(),
    startsAt: z.string().datetime({ offset: true }).optional(),
    endsAt: z.string().datetime({ offset: true }).optional(),
    interventionId: z.string().min(1).optional(),
    attendeeEmails: z.array(z.string().email()).max(10).optional(),
  }),
  consequential: true,
  readOnly: false,
  async handler(input, ctx) {
    if (ctx.actor.kind !== 'faculty') {
      throw new Error('Only a faculty member may schedule a meeting.');
    }

    const student = await getStudent(ctx.db, input.usn);
    if (!student) throw new Error(`No student with USN ${input.usn}.`);

    // Either confirm a proposal, or build one here and confirm it immediately.
    const existing = input.meetingId
      ? await getMeeting(ctx.db, input.usn, input.meetingId)
      : null;
    if (input.meetingId && !existing) {
      throw new Error(`No meeting ${input.meetingId} for ${input.usn}.`);
    }
    if (existing?.status === 'scheduled') {
      throw new Error('That meeting is already scheduled.');
    }

    const title = input.title ?? existing?.title;
    const reason = input.reason ?? existing?.reason;
    const startsAt = input.startsAt ?? existing?.startsAt;
    const endsAt = input.endsAt ?? existing?.endsAt;

    if (!title || !reason || !startsAt || !endsAt) {
      throw new Error(
        'A new meeting needs a title, a reason, a start and an end. ' +
          'Pass a meetingId to confirm an existing proposal instead.',
      );
    }
    const slot = SlotSchema.safeParse({ startsAt, endsAt });
    if (!slot.success) {
      throw new Error(slot.error.issues.map((i) => i.message).join('; '));
    }

    const meetingId = existing?.meetingId ?? `mt_${input.usn}_${Date.now().toString(36)}`;

    const link = await createMeetingLink({
      meetingId,
      title,
      // The mentor's reason is written for a mentor. The description reaches
      // the student's calendar invite, so it carries the agenda instead.
      description:
        `${input.agenda ?? existing?.agenda ?? 'A check-in with your mentor.'}\n\n` +
        `Student: ${student.name ?? input.usn} (${input.usn})`,
      startsAt,
      endsAt,
      attendeeEmails: input.attendeeEmails,
    });

    const meeting: Meeting = {
      meetingId,
      usn: input.usn,
      title,
      reason,
      agenda: input.agenda ?? existing?.agenda,
      startsAt,
      endsAt,
      status: 'scheduled',
      provider: link.provider,
      joinUrl: link.joinUrl,
      calendarEventId: link.calendarEventId,
      interventionId: input.interventionId ?? existing?.interventionId ?? null,
      proposedBy: existing?.proposedBy ?? ctx.actor.id,
      scheduledBy: ctx.actor.id,
      createdAt: existing?.createdAt ?? nowIso(ctx),
      failureReason: link.note,
    };

    await saveMeeting(ctx.db, meeting);
    return {
      meetingId,
      status: 'scheduled',
      joinUrl: link.joinUrl,
      provider: link.provider,
      note: link.note,
    };
  },
};

const cancelMeetingTool: ToolDefinition<
  { usn: string; meetingId: string; reason?: string },
  { meetingId: string; status: string }
> = {
  name: 'cancel_meeting',
  title: 'Cancel meeting',
  description:
    'Call off a scheduled meeting and remove its calendar event. Requires faculty ' +
    'approval and is not available to agents. The meeting stays on record as cancelled ' +
    'rather than disappearing, so the student can see it was called off.',
  inputSchema: z.object({
    usn: UsnSchema,
    meetingId: z.string().min(1),
    reason: z.string().trim().max(500).optional(),
  }),
  consequential: true,
  readOnly: false,
  async handler(input, ctx) {
    if (ctx.actor.kind !== 'faculty') {
      throw new Error('Only a faculty member may cancel a meeting.');
    }

    const meeting = await getMeeting(ctx.db, input.usn, input.meetingId);
    if (!meeting) throw new Error(`No meeting ${input.meetingId} for ${input.usn}.`);

    // Remove the calendar event first. If that fails the meeting stays
    // scheduled, because a cancelled record with a live invite still on the
    // student's calendar is worse than no change at all.
    if (meeting.calendarEventId) {
      await deleteCalendarEvent(meeting.calendarEventId);
    }

    await updateMeeting(ctx.db, input.usn, input.meetingId, {
      status: 'cancelled',
      joinUrl: null,
      calendarEventId: null,
      failureReason: input.reason ?? null,
    });

    return { meetingId: input.meetingId, status: 'cancelled' };
  },
};

export const MEETING_TOOLS: Record<string, ToolDefinition<any, any>> = {
  propose_meeting: proposeMeetingTool,
  list_meetings: listMeetingsTool,
  schedule_meeting: scheduleMeetingTool,
  cancel_meeting: cancelMeetingTool,
};
