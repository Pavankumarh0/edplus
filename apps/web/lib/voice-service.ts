import 'server-only';

/**
 * Thin proxy to the voice service.
 *
 * The browser never talks to :8787 directly. Everything goes through Next,
 * which means no CORS configuration to get wrong during a demo, and the voice
 * service can move to another host without touching the client.
 */
export function voiceServiceUrl(): string {
  return (process.env.VOICE_SERVICE_URL ?? 'http://127.0.0.1:8787').replace(/\/+$/, '');
}

export class VoiceServiceDown extends Error {
  readonly status = 503;
  constructor(url: string) {
    super(
      `The voice service is not running at ${url}. Start it with \`npm run dev:voice\`.`,
    );
  }
}

export async function voicePost<T = unknown>(
  path: string,
  body: unknown,
  timeoutMs = 45_000,
): Promise<{ ok: boolean; status: number; data: T }> {
  const base = voiceServiceUrl();
  try {
    const response = await fetch(base + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return {
      ok: response.ok,
      status: response.status,
      data: (await response.json().catch(() => ({}))) as T,
    };
  } catch {
    throw new VoiceServiceDown(base);
  }
}
