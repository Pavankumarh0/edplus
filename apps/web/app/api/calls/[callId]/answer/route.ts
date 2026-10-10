import { NextResponse } from 'next/server';
import { errorResponse, facultyContext } from '@/lib/api';
import { voicePost } from '@/lib/voice-service';

export const maxDuration = 60;

/**
 * Answers a simulated call and returns what the parent hears.
 *
 * Separate from scheduling so the dashboard can play the call inline the
 * instant it is approved, rather than sending a presenter to another tab.
 */
export async function POST(_request: Request, context: { params: Promise<{ callId: string }> }) {
  try {
    await facultyContext();
    const { callId } = await context.params;

    const result = await voicePost<Record<string, unknown>>('/simulator/start', { callId });
    if (!result.ok) {
      return NextResponse.json(
        { error: (result.data as { error?: string }).error ?? 'Could not answer the call.' },
        { status: result.status },
      );
    }

    return NextResponse.json(result.data);
  } catch (error) {
    return errorResponse(error);
  }
}
