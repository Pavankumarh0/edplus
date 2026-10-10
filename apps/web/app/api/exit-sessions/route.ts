import { NextResponse } from 'next/server';
import { z } from 'zod';
import QRCode from 'qrcode';
import {
  ExitSessionSchema,
  currentToken,
  exitQrPayload,
  isSessionLive,
  newSessionSecret,
  stripSecret,
  type ExitSession,
} from '@eduplus/core';
import {
  endExitSession,
  getExitProgress,
  getExitSession,
  listExitSessions,
  overrideVerification,
  saveExitSession,
  writeAudit,
} from '@eduplus/core/repositories';
import { errorResponse, facultyContext } from '@/lib/api';

/**
 * Classroom exit sessions, for faculty.
 *
 * Separate from assignments on purpose: an assignment QR identifies a piece of
 * work and is meant to be shared, while an exit QR is a momentary credential.
 * Reusing one as the other would turn a code written on a whiteboard into a
 * way to mark yourself present.
 */

const CreateSchema = z.object({
  label: z.string().trim().min(1).max(120),
  semester: z.number().int().min(1).max(8),
  section: z.string().trim().min(1).max(8),
  /** How long the session stays open. Short by default. */
  minutes: z.number().int().min(1).max(120).optional(),
});

const ActionSchema = z.object({
  sessionId: z.string().min(1),
  /** Record a scan that genuinely failed — a flat phone, a broken camera. */
  overrideUsn: z.string().min(1).optional(),
});

async function qrFor(session: ExitSession): Promise<string> {
  return QRCode.toDataURL(exitQrPayload(session.sessionId, currentToken(session.secret)), {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 512,
    color: { dark: '#121110', light: '#FFFFFF' },
  });
}

export async function GET(request: Request) {
  try {
    const ctx = await facultyContext();
    const sessionId = new URL(request.url).searchParams.get('sessionId');

    if (sessionId) {
      const session = await getExitSession(ctx.db, sessionId);
      if (!session) return NextResponse.json({ error: 'No such session.' }, { status: 404 });

      const progress = await getExitProgress(ctx.db, session);
      return NextResponse.json({
        // Stripped: the secret mints valid codes and must never reach a browser.
        session: stripSecret(session),
        live: isSessionLive(session),
        // Regenerated on every poll, which is what makes the code rotate on
        // the projector without the page doing any crypto itself.
        qr: isSessionLive(session) ? await qrFor(session) : null,
        ...progress,
      });
    }

    const sessions = await listExitSessions(ctx.db);
    return NextResponse.json({
      sessions: sessions.map((s) => ({ ...stripSecret(s), live: isSessionLive(s) })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await facultyContext();

    const parsed = CreateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join('; ') },
        { status: 400 },
      );
    }

    const now = new Date();
    const minutes = parsed.data.minutes ?? 10;
    const session: ExitSession = ExitSessionSchema.parse({
      sessionId: `ex_${now.getTime().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      secret: newSessionSecret(),
      facultyId: ctx.actor.id,
      semester: parsed.data.semester,
      section: parsed.data.section,
      label: parsed.data.label,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + minutes * 60_000).toISOString(),
      endedAt: null,
      status: 'open',
    } satisfies ExitSession);

    await saveExitSession(ctx.db, session);
    await writeAudit(ctx.db, {
      actor: ctx.actor,
      tool: 'exit_session.open',
      args: { sessionId: session.sessionId, semester: session.semester, section: session.section, minutes },
      status: 'ok',
    });

    return NextResponse.json({
      session: stripSecret(session),
      qr: await qrFor(session),
      message: `Exit code open for ${minutes} minutes. It changes every 15 seconds.`,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/** End a session early, or record a manual override. */
export async function PATCH(request: Request) {
  try {
    const ctx = await facultyContext();

    const parsed = ActionSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Expected a sessionId.' }, { status: 400 });
    }

    const session = await getExitSession(ctx.db, parsed.data.sessionId);
    if (!session) return NextResponse.json({ error: 'No such session.' }, { status: 404 });

    if (parsed.data.overrideUsn) {
      await overrideVerification(ctx.db, session.sessionId, parsed.data.overrideUsn);
      // Audited as an override, not as a scan. The record itself is identical
      // by design; the log is where the difference lives.
      await writeAudit(ctx.db, {
        actor: ctx.actor,
        tool: 'exit_session.override',
        args: { sessionId: session.sessionId, usn: parsed.data.overrideUsn },
        status: 'ok',
      });
      return NextResponse.json({ message: `Recorded for ${parsed.data.overrideUsn} by hand.` });
    }

    await endExitSession(ctx.db, session.sessionId);
    await writeAudit(ctx.db, {
      actor: ctx.actor,
      tool: 'exit_session.end',
      args: { sessionId: session.sessionId },
      status: 'ok',
    });

    return NextResponse.json({ message: 'Session ended. The code no longer works.' });
  } catch (error) {
    return errorResponse(error);
  }
}
