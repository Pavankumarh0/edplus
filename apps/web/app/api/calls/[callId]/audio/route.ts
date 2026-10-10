import { NextResponse } from 'next/server';
import { requireFaculty } from '@/lib/auth';
import { voiceServiceUrl } from '@/lib/voice-service';

/**
 * Streams a generated clip through Next.
 *
 * Keeps the <audio> element same-origin, so nothing depends on the voice
 * service's CORS headers during a live demo.
 */
export async function GET(request: Request, context: { params: Promise<{ callId: string }> }) {
  try {
    await requireFaculty();
    await context.params;

    const key = new URL(request.url).searchParams.get('key');
    if (!key || !/^[a-f0-9]{32}$/.test(key)) {
      return NextResponse.json({ error: 'Bad audio key.' }, { status: 400 });
    }

    const upstream = await fetch(`${voiceServiceUrl()}/audio/${key}.wav`, {
      signal: AbortSignal.timeout(20_000),
    });
    if (!upstream.ok) {
      return NextResponse.json({ error: 'Audio not found.' }, { status: upstream.status });
    }

    return new NextResponse(await upstream.arrayBuffer(), {
      headers: { 'content-type': 'audio/wav', 'cache-control': 'public, max-age=3600' },
    });
  } catch {
    return NextResponse.json({ error: 'Could not fetch the audio.' }, { status: 502 });
  }
}
