import { NextResponse } from 'next/server';
import { z } from 'zod';
import { CallPurposeSchema, UsnSchema } from '@eduplus/core';
import { executeTool } from '@eduplus/core/tools';
import { errorResponse, facultyContext } from '@/lib/api';

const BodySchema = z.object({
  usn: UsnSchema,
  purpose: CallPurposeSchema,
  /** The exact words the agent is allowed to say. */
  approvedMessage: z.string().trim().min(10).max(2000),
  language: z.string().optional(),
  interventionId: z.string().min(1).optional(),
});

/**
 * Queues an outbound call to a parent.
 *
 * This is the system's one consequential action, so it is faculty-only by
 * construction: `schedule_parent_call` is in no agent's allowlist, and the
 * tool itself refuses any actor that is not faculty. A call is created here
 * and dialled by services/voice, never directly from a model turn.
 */
export async function POST(request: Request) {
  try {
    const ctx = await facultyContext();

    const parsed = BodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join('; ') },
        { status: 400 },
      );
    }

    const result = await executeTool<{ callId: string; status: string }>(
      'schedule_parent_call',
      parsed.data,
      ctx,
    );
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

    const callId = result.data!.callId;
    const usingVobiz = process.env.TELEPHONY_PROVIDER === 'vobiz';
    const voiceService = (process.env.VOICE_SERVICE_URL ?? 'http://127.0.0.1:8787').replace(/\/+$/, '');

    // Hand off to the voice service. Deliberately non-fatal: the call record
    // is already approved and saved, so a voice service that is down means
    // "not dialled yet", not "the approval was lost".
    let dialled = false;
    let dialNote: string | null = null;
    try {
      const response = await fetch(`${voiceService}/calls/dial`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ callId }),
        signal: AbortSignal.timeout(10_000),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (response.ok) dialled = true;
      else dialNote = body.error ?? `The voice service refused the call (${response.status}).`;
    } catch {
      dialNote = `The voice service is not reachable at ${voiceService}. Start it with \`npm run dev:voice\`.`;
    }

    const message = dialled
      ? usingVobiz
        ? 'Call approved and being placed through Vobiz.'
        : 'Call approved. Open the simulator to answer it as the parent.'
      : `Call approved and queued. ${dialNote ?? ''}`.trim();

    return NextResponse.json({
      callId,
      dialled,
      // Tells the dashboard which experience to open: a live phone call to
      // watch, or a simulated one to play and answer inline.
      provider: usingVobiz ? 'vobiz' : 'simulated',
      simulatorUrl: usingVobiz ? null : `${voiceService}/simulator?callId=${encodeURIComponent(callId)}`,
      message,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
