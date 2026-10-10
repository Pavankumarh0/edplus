import { NextResponse } from 'next/server';
import { z } from 'zod';
import { MEETING_PROVIDER_LABELS, UsnSchema, type MeetingProvider } from '@eduplus/core';
import { executeTool } from '@eduplus/core/tools';
import { errorResponse, facultyContext } from '@/lib/api';

/**
 * Mentor–student meetings.
 *
 * Every write goes through the shared tool layer, so a meeting a mentor books
 * from the dashboard and one the copilot proposed land in the same audit log
 * and obey the same approval boundary.
 */

const ScheduleSchema = z.object({
  usn: UsnSchema,
  /** Confirming an existing proposal rather than creating from scratch. */
  meetingId: z.string().min(1).optional(),
  title: z.string().trim().min(3).max(200).optional(),
  reason: z.string().trim().min(10).max(2000).optional(),
  agenda: z.string().trim().max(500).optional(),
  startsAt: z.string().datetime({ offset: true }).optional(),
  endsAt: z.string().datetime({ offset: true }).optional(),
  interventionId: z.string().min(1).optional(),
  attendeeEmails: z.array(z.string().email()).max(10).optional(),
});

const CancelSchema = z.object({
  usn: UsnSchema,
  meetingId: z.string().min(1),
  reason: z.string().trim().max(500).optional(),
});

export async function GET(request: Request) {
  try {
    const ctx = await facultyContext();
    const usn = new URL(request.url).searchParams.get('usn') ?? undefined;

    const result = await executeTool('list_meetings', usn ? { usn } : {}, ctx);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

    return NextResponse.json(result.data);
  } catch (error) {
    return errorResponse(error);
  }
}

/** Books the meeting and returns a link that is live immediately. */
export async function POST(request: Request) {
  try {
    const ctx = await facultyContext();

    const parsed = ScheduleSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join('; ') },
        { status: 400 },
      );
    }

    const result = await executeTool<{
      meetingId: string;
      joinUrl: string;
      provider: MeetingProvider;
      note: string | null;
    }>('schedule_meeting', parsed.data, ctx);

    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

    const { meetingId, joinUrl, provider, note } = result.data!;
    return NextResponse.json({
      meetingId,
      joinUrl,
      provider,
      note,
      message: `${MEETING_PROVIDER_LABELS[provider]} link created. It is on both calendars now.`,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const ctx = await facultyContext();

    const parsed = CancelSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Expected usn and meetingId.' }, { status: 400 });
    }

    const result = await executeTool('cancel_meeting', parsed.data, ctx);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

    return NextResponse.json({ message: 'Meeting cancelled and removed from both calendars.' });
  } catch (error) {
    return errorResponse(error);
  }
}
