import 'server-only';
import Anthropic from '@anthropic-ai/sdk';

/**
 * The shared Anthropic client.
 *
 * The model id is read from ANTHROPIC_MODEL and nowhere else — no model name
 * is hard-coded anywhere in this codebase, so moving to a different model is
 * an env change rather than a search-and-replace.
 */
let cached: Anthropic | null = null;

export function anthropic(): Anthropic {
  if (cached) return cached;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new MissingApiKeyError(
      'ANTHROPIC_API_KEY is not set, so the AI features are unavailable. ' +
        'Add it to .env.local and restart the dev server.',
    );
  }
  cached = new Anthropic({ apiKey });
  return cached;
}

export function model(): string {
  const id = process.env.ANTHROPIC_MODEL;
  if (!id) {
    throw new MissingApiKeyError(
      'ANTHROPIC_MODEL is not set. Set it to the current Claude Sonnet model id.',
    );
  }
  return id;
}

export class MissingApiKeyError extends Error {
  readonly status = 503;
}

/**
 * Turns an Anthropic failure into something a faculty member can act on.
 *
 * Deliberately specific about the two that actually happen during a demo — a
 * missing key and a rate limit — because "request failed" sends someone
 * looking in the wrong place.
 */
export function describeModelError(error: unknown): { message: string; status: number } {
  if (error instanceof MissingApiKeyError) {
    return { message: error.message, status: error.status };
  }

  if (error instanceof Anthropic.APIError) {
    if (error.status === 401) {
      return { message: 'The Anthropic API key was rejected. Check ANTHROPIC_API_KEY.', status: 502 };
    }
    if (error.status === 429) {
      return { message: 'Rate limited by the Anthropic API. Wait a moment and try again.', status: 429 };
    }
    if (error.status === 400) {
      return { message: `The request was rejected: ${error.message}`, status: 502 };
    }
    return { message: `The model request failed (${error.status}).`, status: 502 };
  }

  return {
    message: error instanceof Error ? error.message : 'The model request failed.',
    status: 500,
  };
}
