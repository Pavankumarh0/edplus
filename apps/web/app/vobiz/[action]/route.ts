import { NextResponse } from 'next/server';
import { voiceServiceUrl } from '@/lib/voice-service';

/**
 * Forwards Vobiz's call-control webhooks to the voice service.
 *
 * Why this exists: a free ngrok account has ONE public domain, and two
 * services need to be publicly reachable — the dashboard (so the mobile app
 * can reach Planly) and the voice service (so Vobiz can fetch the answer XML
 * and the audio). Pointing two tunnels at one domain makes ngrok round-robin
 * between them, so roughly half of every request lands on the wrong service.
 *
 * So everything goes through the dashboard's domain and is proxied here.
 * The voice service keeps its own routes and still works directly on :8787.
 *
 * NOT authenticated, deliberately: Vobiz is a third party that cannot carry a
 * session. Safety comes from the call id being an unguessable server-issued
 * string, and from the voice service refusing any call that a faculty member
 * has not approved.
 */
const ALLOWED = new Set(['answer', 'gather', 'hangup', 'fallback']);

export async function POST(request: Request, context: { params: Promise<{ action: string }> }) {
  const { action } = await context.params;
  if (!ALLOWED.has(action)) {
    return NextResponse.json({ error: 'Unknown webhook.' }, { status: 404 });
  }

  const incoming = new URL(request.url);
  const target = `${voiceServiceUrl()}/vobiz/${action}${incoming.search}`;

  // Vobiz posts application/x-www-form-urlencoded; forward it byte for byte.
  const body = await request.text();
  const contentType = request.headers.get('content-type') ?? 'application/x-www-form-urlencoded';

  try {
    const upstream = await fetch(target, {
      method: 'POST',
      headers: { 'content-type': contentType },
      body,
      signal: AbortSignal.timeout(30_000),
    });

    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: {
        'content-type': upstream.headers.get('content-type') ?? 'text/xml; charset=utf-8',
      },
    });
  } catch {
    // A silent call is the worst outcome, so answer with something speakable
    // rather than letting the provider see a 5xx and hang up abruptly.
    return new NextResponse(
      '<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n' +
        '  <Speak>Sorry, we cannot complete this call right now. Goodbye.</Speak>\n' +
        '  <Hangup/>\n</Response>',
      { status: 200, headers: { 'content-type': 'text/xml; charset=utf-8' } },
    );
  }
}
