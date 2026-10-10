import { z } from 'zod';
import type { PlaceCallRequest, PlaceCallResult, TelephonyProvider } from './types';

/**
 * Vobiz telephony provider.
 *
 * Contract verified against Vobiz's own docs:
 *   POST {base}/Account/{auth_id}/Call/
 *   headers X-Auth-ID / X-Auth-Token  (an id + token pair, not a single key)
 *   body    from, to (E.164), answer_url, answer_method
 *   the answer_url must return XML that drives the call
 *
 * Callbacks: ring_url, hangup_url, fallback_url.
 */

const PlaceCallResponseSchema = z.object({
  message: z.string().optional(),
  // Vobiz returns a uuid per destination; a single `call_uuid` for one `to`.
  request_uuid: z.string().optional(),
  call_uuid: z.string().optional(),
  api_id: z.string().optional(),
});

export class VobizProvider implements TelephonyProvider {
  readonly name = 'vobiz' as const;

  private get authId(): string | undefined {
    const value = process.env.VOBIZ_AUTH_ID;
    return value && !value.startsWith('PASTE') ? value : undefined;
  }

  private get authToken(): string | undefined {
    const value = process.env.VOBIZ_AUTH_TOKEN;
    return value && !value.startsWith('PASTE') ? value : undefined;
  }

  private get callerId(): string | undefined {
    const value = process.env.VOBIZ_CALLER_ID;
    return value && !value.startsWith('PASTE') ? value : undefined;
  }

  private get base(): string {
    return process.env.VOBIZ_API_BASE ?? 'https://api.vobiz.ai/api/v1';
  }

  isConfigured(): boolean {
    return Boolean(this.authId && this.authToken && this.callerId && isPublicUrl(publicBaseUrl()));
  }

  describeConfiguration(): string {
    const missing: string[] = [];
    if (!this.authId) missing.push('VOBIZ_AUTH_ID');
    if (!this.authToken) missing.push('VOBIZ_AUTH_TOKEN');
    if (!this.callerId) missing.push('VOBIZ_CALLER_ID');
    if (!isPublicUrl(publicBaseUrl())) {
      missing.push(
        'PUBLIC_BASE_URL (Vobiz fetches the answer URL and the audio over the public internet — ' +
          'run `ngrok http 8787` and paste the https URL)',
      );
    }
    return missing.length === 0
      ? 'Vobiz is configured.'
      : `Vobiz cannot place calls yet. Missing: ${missing.join(', ')}.`;
  }

  async placeCall(request: PlaceCallRequest): Promise<PlaceCallResult> {
    if (!this.isConfigured()) throw new Error(this.describeConfiguration());

    const response = await fetch(`${this.base}/Account/${this.authId}/Call/`, {
      method: 'POST',
      headers: {
        'X-Auth-ID': this.authId!,
        'X-Auth-Token': this.authToken!,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: this.callerId,
        to: request.to,
        answer_url: request.answerUrl,
        // Documented as optional with a POST default, but the OpenAPI schema
        // marks it required — send it explicitly rather than rely on either.
        answer_method: 'POST',
        hangup_url: request.hangupUrl,
        hangup_method: 'POST',
        ...(request.fallbackUrl
          ? { fallback_url: request.fallbackUrl, fallback_method: 'POST' }
          : {}),
        // Stop a call ringing forever if nobody is home.
        time_limit: 300,
      }),
    });

    const text = await response.text();

    if (!response.ok) {
      throw new Error(`Vobiz rejected the call (${response.status}): ${text.slice(0, 300)}`);
    }

    let parsed: z.infer<typeof PlaceCallResponseSchema> = {};
    try {
      parsed = PlaceCallResponseSchema.parse(JSON.parse(text));
    } catch {
      // A 2xx with an unexpected body still means the call was accepted; we
      // just have no id to correlate with. Better than failing the call.
    }

    return {
      providerCallId: parsed.call_uuid ?? parsed.request_uuid ?? `vobiz-${request.callId}`,
      status: 'dialing',
    };
  }
}

export function publicBaseUrl(): string {
  return (process.env.PUBLIC_BASE_URL ?? `http://localhost:${process.env.VOICE_SERVICE_PORT ?? 8787}`).replace(
    /\/+$/,
    '',
  );
}

/**
 * Vobiz must be able to reach the answer URL and the audio file itself, so a
 * loopback address cannot work however correct it looks locally.
 */
export function isPublicUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname;
    return !(
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host.endsWith('.local') ||
      host.endsWith('.localhost')
    );
  } catch {
    return false;
  }
}
