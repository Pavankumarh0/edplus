import { NextResponse } from 'next/server';
import { voiceServiceUrl } from '@/lib/voice-service';

/**
 * Serves generated speech to the telephony provider.
 *
 * Vobiz's <Play> verb fetches the clip itself over the public internet, so it
 * must sit on the same public domain as the answer XML — see the note in
 * app/vobiz/[action]/route.ts for why there is only one.
 *
 * Unauthenticated for the same reason, and safe for the same reason: the file
 * name is a content hash, so it cannot be guessed or enumerated.
 */
export async function GET(_request: Request, context: { params: Promise<{ file: string }> }) {
  const { file } = await context.params;

  const key = file.replace(/\.wav$/i, '');
  if (!/^[a-f0-9]{32}$/.test(key)) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }

  try {
    const upstream = await fetch(`${voiceServiceUrl()}/audio/${key}.wav`, {
      signal: AbortSignal.timeout(25_000),
    });
    if (!upstream.ok) {
      return NextResponse.json({ error: 'Not found.' }, { status: upstream.status });
    }

    return new NextResponse(await upstream.arrayBuffer(), {
      headers: {
        'content-type': 'audio/wav',
        'cache-control': 'public, max-age=3600',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Audio unavailable.' }, { status: 502 });
  }
}
