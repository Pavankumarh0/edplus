import 'server-only';
import { auth } from '@modelcontextprotocol/sdk/client/auth.js';
import {
  NeedsAuthorizationError,
  WebOAuthProvider,
  canStoreSecrets,
  handshakeAndDiscover,
  newState,
  resourceMetadataUrls,
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

/**
 * Where providers send the browser back.
 *
 * Derived from the origin the mentor is actually on, NOT from PUBLIC_BASE_URL.
 * That variable points at the public tunnel because the telephony provider has
 * to reach us from the internet; using it here would send the browser back to
 * a different origin than the one holding its session cookie, and the callback
 * would see a signed-out visitor. Same origin in, same origin out.
 */
export function redirectUrlFor(request: Request): string {
  const origin = new URL(request.url).origin;
  return `${origin}/api/connectors/remote/callback`;
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
  input: {
    serverUrl: string;
    displayName: string;
    description?: string;
    ownerId: string;
    redirectUri: string;
  },
): Promise<ConnectAttempt> {
  const state = newState();
  const provider = new WebOAuthProvider({ redirectUrl: input.redirectUri, state });

  // Ask whether the server advertises OAuth BEFORE connecting anonymously.
  //
  // Checking only whether the handshake fails is not enough, and Google's
  // Drive MCP is the case that proves it: it answers tools/list to an
  // anonymous caller and then refuses every actual call. Connecting it
  // "successfully" with eight unusable tools is worse than not connecting it.
  // A server that publishes authorization metadata is telling us it expects a
  // token, so that is what we go on.
  let needsAuthorization: NeedsAuthorizationError | null = null;
  let authFailure: string | null = null;

  const metadataUrl = await findResourceMetadata(input.serverUrl);
  if (metadataUrl) {
    try {
      await auth(provider, {
        serverUrl: input.serverUrl,
        // Passed explicitly: without a 401 there is no WWW-Authenticate header
        // to find this by, and the root well-known is a 404 on these servers.
        resourceMetadataUrl: new URL(metadataUrl),
      });
    } catch (error) {
      if (error instanceof NeedsAuthorizationError) {
        needsAuthorization = error;
      } else {
        authFailure = error instanceof Error ? error.message : String(error);
      }
    }
  }

  // The server said it wants a token and we could not even build the request.
  // Connecting anyway would mean a connector whose every tool call fails.
  if (metadataUrl && !needsAuthorization) {
    throw new Error(
      redactSecrets(
        `${input.displayName} requires authorization and its authorization server ` +
          'does not register clients on demand, so EduPlus needs an OAuth client of ' +
          'its own. Set MCP_OAUTH_CLIENT_ID and MCP_OAUTH_CLIENT_SECRET (a Google ' +
          'OAuth client works for Google servers) with the redirect URI ' +
          `${input.redirectUri}, then try again.` +
          (authFailure ? ` (${authFailure})` : ''),
      ),
    );
  }

  if (!needsAuthorization) {
    try {
      return { kind: 'connected', result: await handshakeAndDiscover(input.serverUrl) };
    } catch (error) {
      if (!looksLikeAuthRequired(error)) throw error;
      throw new Error(
        redactSecrets(
          'That server requires authorization but does not publish the OAuth metadata ' +
            'needed to request it, so there is no way to sign you in. ' +
            (error instanceof Error ? error.message : ''),
        ),
      );
    }
  }

  if (!canStoreSecrets()) {
    throw new Error(
      'That server requires authorization, but CONNECTOR_ENCRYPTION_KEY is not set, ' +
        'so its tokens could not be stored safely. Set it and try again.',
    );
  }

  {
    const error = needsAuthorization;

    await savePendingAuthorization(db, {
      state,
      serverUrl: input.serverUrl,
      displayName: input.displayName,
      description: input.description,
      ownerId: input.ownerId,
      redirectUri: input.redirectUri,
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
    redirectUri: string;
    codeVerifier: ReturnType<typeof sealTokensLike> | null;
    clientInformation: ReturnType<typeof sealClientInformation> | null;
  },
  code: string,
): Promise<{ result: HandshakeResult; sealedTokens: ReturnType<typeof sealTokens> }> {
  const provider = new WebOAuthProvider({
    // The same value the flow began with; the token exchange is rejected if it
    // differs by so much as a trailing slash.
    redirectUrl: pending.redirectUri,
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
    // Unused on this path: a refresh does not redirect anywhere.
    redirectUrl: '',
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

/**
 * Finds a server's protected-resource metadata, or null if it publishes none.
 *
 * A HEAD-like probe rather than trusting a 401: a server can answer
 * `initialize` anonymously and still require a token for every real call, and
 * connecting such a server "successfully" gives a mentor a connector whose
 * every tool fails. What it publishes is the honest signal.
 */
async function findResourceMetadata(serverUrl: string): Promise<string | null> {
  for (const candidate of resourceMetadataUrls(serverUrl)) {
    try {
      const response = await fetch(candidate, {
        redirect: 'error',
        signal: AbortSignal.timeout(8000),
      });
      if (response.ok) return candidate;
    } catch {
      // Unreachable or refused: try the next spelling.
    }
  }
  return null;
}
