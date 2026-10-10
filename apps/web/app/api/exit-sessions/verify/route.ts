import { NextResponse } from 'next/server';
import { z } from 'zod';
import { parseExitQrPayload } from '@eduplus/core';
import { getDb, getStudent, verifyExit, writeAudit } from '@eduplus/core/repositories';
import { errorResponse } from '@/lib/api';
import { planlyActor, requireStudent } from '@/lib/student-auth';

/**
 * A student recording their exit.
 *
 * The scanned payload is the only thing the client contributes. Who they are
 * comes from the token, when it happened comes from this server's clock, and
 * whether the code is currently valid is recomputed here from the session
 * secret — so there is nothing in the request a student could change to make a
 * rejected scan succeed.
 */

const VerifySchema = z.object({ payload: z.string().trim().min(1).max(300) });

export async function POST(request: Request) {
  try {
    const student = await requireStudent(request);
    const db = getDb();

    const parsed = VerifySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Expected a scanned code.' }, { status: 400 });
    }

    const scanned = parseExitQrPayload(parsed.data.payload);
    if (!scanned) {
      return NextResponse.json(
        { error: 'That is not an EduPlus exit code. Scan the one your mentor is showing.' },
        { status: 400 },
      );
    }

    const record = await getStudent(db, student.usn);
    if (!record) return NextResponse.json({ error: 'No student record.' }, { status: 404 });

    const outcome = await verifyExit(db, {
      sessionId: scanned.sessionId,
      token: scanned.token,
      student: record,
      now: new Date(),
    });

    if (!outcome.ok) {
      // Logged as a refusal, never as a verification. A record that says "no"
      // would eventually be read as if it said something about the student.
      await writeAudit(db, {
        actor: planlyActor(student),
        tool: 'exit_session.verify',
        args: { sessionId: scanned.sessionId },
        status: 'permission_denied',
        errorMessage: outcome.reason,
      });
      return NextResponse.json({ error: outcome.reason }, { status: 403 });
    }

    if (!outcome.repeat) {
      await writeAudit(db, {
        actor: planlyActor(student),
        tool: 'exit_session.verify',
        args: { sessionId: scanned.sessionId },
        status: 'ok',
      });
    }

    return NextResponse.json({
      verifiedAt: outcome.verification.verifiedAt,
      repeat: outcome.repeat,
      message: outcome.repeat
        ? 'Already recorded. You are signed out of this session.'
        : 'Exit recorded. You are signed out of this session.',
    });
  } catch (error) {
    return errorResponse(error);
  }
}
