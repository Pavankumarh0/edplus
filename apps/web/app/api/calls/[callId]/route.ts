import { NextResponse } from 'next/server';
import { getCall, getDb } from '@eduplus/core/repositories';
import { errorResponse, facultyContext } from '@/lib/api';

/** Live call status, polled while a real Vobiz call is in flight. */
export async function GET(_request: Request, context: { params: Promise<{ callId: string }> }) {
  try {
    await facultyContext();
    const { callId } = await context.params;

    const call = await getCall(getDb(), callId);
    if (!call) return NextResponse.json({ error: 'No such call.' }, { status: 404 });

    return NextResponse.json({
      callId: call.callId,
      status: call.status,
      provider: call.provider,
      parentResponse: call.parentResponse,
      summary: call.summary,
      failureReason: call.failureReason,
      transcript: call.transcript,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
