import { afterEach, describe, expect, it } from 'vitest';
import { auth } from '@modelcontextprotocol/sdk/client/auth.js';
import { NeedsAuthorizationError, WebOAuthProvider, newState } from './oauth';
import { handshakeAndDiscover } from './mcp-client';
import { startMockMcpServer, type RunningMockServer } from './mock-server';

/**
 * The whole authorization round trip, against a server that really demands it.
 *
 * This is the leg that cannot be checked by reading the code: the SDK runs
 * discovery, dynamic registration, PKCE and the token exchange, and a mistake
 * in any of them looks like success right up until a real provider refuses.
 */

const ENV = { EDUPLUS_ALLOW_LOCAL_CONNECTORS: '1' } as NodeJS.ProcessEnv;
const REDIRECT = 'http://localhost:3000/api/connectors/remote/callback';

let running: RunningMockServer | null = null;

afterEach(async () => {
  await running?.close();
  running = null;
});

/** Leg one: ask, and catch the authorization URL on its way out. */
async function begin(serverUrl: string, state: string) {
  const provider = new WebOAuthProvider({ redirectUrl: REDIRECT, state });
  try {
    await auth(provider, { serverUrl });
    throw new Error('expected an authorization redirect');
  } catch (error) {
    if (!(error instanceof NeedsAuthorizationError)) throw error;
    return { provider, authorizationUrl: new URL(error.authorizationUrl) };
  }
}

describe('the authorization round trip', () => {
  it('discovers, registers, redirects, exchanges and then connects', async () => {
    running = await startMockMcpServer({ requireAuth: true, serverName: 'protected-mcp' });

    // ── Leg one ───────────────────────────────────────────────────────────
    const state = newState();
    const { provider, authorizationUrl } = await begin(running.url, state);

    expect(authorizationUrl.searchParams.get('response_type')).toBe('code');
    expect(authorizationUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorizationUrl.searchParams.get('state')).toBe(state);
    expect(authorizationUrl.searchParams.get('redirect_uri')).toBe(REDIRECT);
    expect(provider.mutations.codeVerifier).toBeTruthy();

    // ── The browser's trip to the provider and back ───────────────────────
    const consent = await fetch(authorizationUrl, { redirect: 'manual' });
    const back = new URL(consent.headers.get('location')!);
    expect(back.origin + back.pathname).toBe(REDIRECT);
    expect(back.searchParams.get('state')).toBe(state);
    const code = back.searchParams.get('code')!;
    expect(code).toBeTruthy();

    // ── Leg two, in a fresh provider ──────────────────────────────────────
    // A new object on purpose: the real callback is a separate request with
    // nothing in memory, so anything the first leg forgot to persist shows up
    // here as a failure rather than quietly working in a test.
    const second = new WebOAuthProvider({
      redirectUrl: REDIRECT,
      state,
      existingCodeVerifier: provider.mutations.codeVerifier,
      existingClientInformation: provider.mutations.clientInformation,
    });

    await auth(second, { serverUrl: running.url, authorizationCode: code });

    const tokens = second.tokens();
    expect(tokens?.access_token).toBe('mock-access-token');
    expect(tokens?.refresh_token).toBe('mock-refresh-token');

    // The exchange must carry PKCE and the identical redirect_uri; the mock
    // refuses without them, so getting here proves both were sent.
    const sent = running.tokenRequest()!;
    expect(sent.get('code_verifier')).toBe(provider.mutations.codeVerifier);
    expect(sent.get('redirect_uri')).toBe(REDIRECT);

    // ── And the connection that was refused now succeeds ──────────────────
    const result = await handshakeAndDiscover(running.url, ENV, second);
    expect(result.serverName).toBe('protected-mcp');
    expect(result.tools.length).toBeGreaterThan(0);
  }, 30_000);

  it('still refuses an unauthorized connection to the same server', async () => {
    // The guard is the server's, not ours — but if this ever passed without a
    // token, the test above would be proving nothing.
    running = await startMockMcpServer({ requireAuth: true });

    await expect(handshakeAndDiscover(running.url, ENV)).rejects.toThrow();
  }, 20_000);

  it('cannot exchange without the PKCE verifier the first leg created', async () => {
    running = await startMockMcpServer({ requireAuth: true });

    const state = newState();
    const { authorizationUrl } = await begin(running.url, state);
    const consent = await fetch(authorizationUrl, { redirect: 'manual' });
    const code = new URL(consent.headers.get('location')!).searchParams.get('code')!;

    // A callback that lost the stored verifier — the shape of a replay from a
    // different browser, or of a pending record that was never persisted.
    const second = new WebOAuthProvider({ redirectUrl: REDIRECT, state });

    await expect(
      auth(second, { serverUrl: running.url, authorizationCode: code }),
    ).rejects.toThrow();
  }, 20_000);
});
