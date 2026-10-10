import { NextResponse } from 'next/server';
import { buildCatalogue } from '@eduplus/core/connectors';
import { getConnectorSettings, getDb, listMeetings } from '@eduplus/core/repositories';
import { errorResponse } from '@/lib/api';
import { planlyActor, requireStudent } from '@/lib/student-auth';

/**
 * What the student app shows on its Connections screen.
 *
 * Built from the SAME catalogue the faculty page renders and from Planly's own
 * allowlist, so a tool a mentor switches off disappears from the student's
 * screen too. Telling a student "Planly can read your attendance" while a
 * mentor has switched that off would be the page lying to the person with the
 * most at stake.
 *
 * Scoped by the token's `usn` claim, never by the request body.
 */
export async function GET(request: Request) {
  try {
    const student = await requireStudent(request);
    const db = getDb();

    const settings = await getConnectorSettings(db);
    // Planly's actor, not the student's: these are the tools that run on the
    // student's behalf, which is the thing they actually want listed.
    const actor = planlyActor(student);
    const cards = buildCatalogue(actor, settings);

    const tools = cards
      .flatMap((card) => card.tools)
      .map((tool) => ({
        name: tool.name,
        title: tool.title,
        description: tool.description,
        enabled: tool.enabled,
        toolClass: tool.toolClass,
      }));

    const meetings = await listMeetings(db, student.usn);
    const upcoming = meetings.filter(
      (m) => m.status === 'scheduled' && new Date(m.endsAt) > new Date(),
    );

    return NextResponse.json({
      usn: student.usn,
      tools,
      /**
       * Stated plainly rather than implied by absence. A student reading a list
       * of what an AI can do should also be told what it cannot, because that
       * is the part they would otherwise have to take on trust.
       */
      limits: [
        'Planly cannot see any other student’s record.',
        'Planly cannot contact your parents or change your marks.',
        'Planly cannot tick your tasks off for you.',
        'Only your mentor can book, move or cancel a meeting.',
      ],
      meetings: {
        upcoming: upcoming.length,
        // A meeting link exists for this student, so the calendar screen has
        // something to show. The link itself stays on the calendar screen.
        nextAt: upcoming[0]?.startsAt ?? null,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
