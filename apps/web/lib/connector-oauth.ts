import 'server-only';
import { auth } from '@modelcontextprotocol/sdk/client/auth.js';
import {
  NeedsAuthorizationError,
  WebOAuthProvider,
  canStoreSecrets,
  handshakeAndDiscover,
  newState,
  openClientInformation,
  openTokens,
  redactSecrets,
  sealClientInformation,
  sealTokens,
  type HandshakeResult,
} from '@eduplus/core/connectors';
import {
  getConnectorTokens,
  savePendingAuthorization,
  saveConnectorTokens,
  type Firestore,
} from '@eduplus/core/repositories';

/**
 * The two legs of an OAuth-protected MCP connection.
 *
 * Leg one runs when a mentor presses Add: try the handshake, and if the server
 * demands authorization, stash the PKCE verifier and hand an authorization URL
 * to the browser. Leg two runs when the provider redirects back: find the
 * stashed record by `state`, exchange the code, and finish the handshake with
 * the token in hand.
 *
 * The server holds nothing in memory between the two. Everything the second
 * leg needs is in Firestore, encrypted.
 */

/** Where providers send the browser back. Must match the registered URI. */
export function redirectUrl(): string {
  const base =
    process.env.PUBLIC_BASE_URL?.replace(/\/+$/, '') ?? 'http://localhost:3000';
  return `${base}/api/connectors/remote/callback`;
}

export type ConnectAttempt =
  | { kind: 'connected'; result: HandshakeResult }
  | { kind: 'needs_authorization'; authorizeUrl: string };

/**
 * Leg one.
 *
 * A server that needs no authorization connects exactly as it did before —
 * the OAuth machinery only engages when the server asks for it.
 */
export async function beginConnection(
  db: Firestore,
  input: { serverUrl: string; displayName: string; description?: string; ownerId: string },
): Promise<ConnectAttempt> {
  // Try unauthenticated first. Most MCP servers need nothing, and starting an
  // OAuth flow against one that does not would be gratuitous.
  try {
    return { kind: 'connected', result: await handshakeAndDiscover(input.serverUrl) };
  } catch (error) {
    if (!looksLikeAuthRequired(error)) throw error;
  }

  if (!canStoreSecrets()) {
    throw new Error(
      'That server requires authorization, but CONNECTOR_ENCRYPTION_KEY is not set, ' +
        'so its tokens could not be stored safely. Set it and try again.',
    );
  }

  const state = newState();
  const provider = new WebOAuthProvider({ redirectUrl: redirectUrl(), state });

  try {
    await auth(provider, { serverUrl: input.serverUrl });
    // Reaching here means the SDK believed it was already authorized, which
    // cannot be true on a first connection.
    throw new Error('The server asked for authorization but did not say where to send you.');
  } catch (error) {
    if (!(error instanceof NeedsAuthorizationError)) {
      throw new Error(redactSecrets(error instanceof Error ? error.message : String(error)));
    }

    await savePendingAuthorization(db, {
      state,
      serverUrl: input.serverUrl,
      displayName: input.displayName,
      description: input.description,
      ownerId: input.ownerId,
      codeVerifier: provider.mutations.codeVerifier
        ? sealTokensLike(provider.mutations.codeVerifier)
        : null,
      clientInformation: provider.mutations.clientInformation
        ? sealClientInformation(provider.mutations.clientInformation)
        : null,
      createdAt: new Date().toISOString(),
      // Ten minutes. An authorization a mentor walked away from is abandoned,
      // and a stale PKCE verifier sitting in the database is just a liability.
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    });

    return { kind: 'needs_authorization', authorizeUrl: error.authorizationUrl };
  }
}

/** Leg two: exchange the code and complete the handshake. */
export async function completeConnection(
  db: Firestore,
  pending: {
    state: string;
    serverUrl: string;
    codeVerifier: ReturnType<typeof sealTokensLike> | null;
    clientInformation: ReturnType<typeof sealClientInformation> | null;
  },
  code: string,
): Promise<{ result: HandshakeResult; sealedTokens: ReturnType<typeof sealTokens> }> {
  const provider = new WebOAuthProvider({
    redirectUrl: redirectUrl(),
    state: pending.state,
    existingCodeVerifier: pending.codeVerifier ? openTokensLike(pending.codeVerifier) : undefined,
    existingClientInformation: pending.clientInformation
      ? openClientInformation(pending.clientInformation)
      : undefined,
  });

  await auth(provider, { serverUrl: pending.serverUrl, authorizationCode: code });

  const tokens = provider.tokens();
  if (!tokens) {
    throw new Error('The provider did not return a token. Start the connection again.');
  }

  // Handshake again, now authorized, so the tool list reflects what this
  // account can actually see rather than what an anonymous caller could.
  const result = await handshakeAndDiscover(pending.serverUrl, process.env, provider);

  return { result, sealedTokens: sealTokens(tokens) };
}

/**
 * An auth provider for a connector that is already connected.
 *
 * Used when the agent calls one of its tools: the stored tokens are unsealed,
 * and a refresh the SDK performs is written back so the next call benefits.
 */
export async function providerForConnector(
  db: Firestore,
  connectorId: string,
): Promise<WebOAuthProvider | undefined> {
  const stored = await getConnectorTokens(db, connectorId);
  if (!stored) return undefined;

  const provider = new WebOAuthProvider({
    redirectUrl: redirectUrl(),
    state: '',
    existingTokens: openTokens(stored.tokens),
    existingClientInformation: stored.clientInformation
      ? openClientInformation(stored.clientInformation)
      : undefined,
  });

  return provider;
}

/** Persists a refreshed token, if the SDK rotated one during a call. */
export async function persistRefreshedTokens(
  db: Firestore,
  connectorId: string,
  provider: WebOAuthProvider,
): Promise<void> {
  const tokens = provider.mutations.tokens;
  if (!tokens) return;

  await saveConnectorTokens(db, connectorId, {
    tokens: sealTokens(tokens),
    clientInformation: provider.mutations.clientInformation
      ? sealClientInformation(provider.mutations.clientInformation)
      : null,
    updatedAt: new Date().toISOString(),
  });
}

// A code verifier is a string, not a token object, but it deserves the same
// encryption — it is half of the proof that redeems the authorization code.
function sealTokensLike(value: string) {
  return sealTokens({ access_token: value, token_type: 'verifier' });
}

function openTokensLike(sealed: ReturnType<typeof sealTokens>): string {
  return openTokens(sealed).access_token;
}

/**
 * Whether a failed handshake was really "you need to log in".
 *
 * The SDK surfaces this as an UnauthorizedError, but a transport wraps it, so
 * the message is checked too. Guessing wrong only costs a clearer error: a
 * server that genuinely cannot be reached still fails, just one step later.
 */
function looksLikeAuthRequired(error: unknown): boolean {
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error);
  return (
    name === 'UnauthorizedError' ||
    /\b401\b|unauthoriz|www-authenticate|invalid_token/i.test(message)
  );
}
