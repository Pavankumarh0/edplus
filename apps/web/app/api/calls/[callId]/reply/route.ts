import { NextResponse } from 'next/server';
import { z } from 'zod';
import { errorResponse, facultyContext } from '@/lib/api';
import { voicePost } from '@/lib/voice-service';

const BodySchema = z.object({
  digit: z.string().max(2).optional(),
  said: z.string().max(1000).optional(),
});

export const maxDuration = 90;

/** The simulated parent presses a key, or speaks. */
export async function POST(request: Request, context: { params: Promise<{ callId: string }> }) {
  try {
    await facultyContext();
    const { callId } = await context.params;

    const parsed = BodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Send a digit or something said.' }, { status: 400 });
    }

    const result = await voicePost<Record<string, unknown>>('/simulator/reply', {
      callId,
      ...parsed.data,
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: (result.data as { error?: string }).error ?? 'The call failed.' },
        { status: result.status },
      );
    }

    return NextResponse.json(result.data);
  } catch (error) {
    return errorResponse(error);
  }
}
