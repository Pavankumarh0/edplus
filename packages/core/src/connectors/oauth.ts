import { randomBytes } from 'node:crypto';
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import { seal, open, type SealedSecret } from './secrets';

/**
 * OAuth for remote MCP connectors, in a web app.
 *
 * The SDK's OAuthClientProvider is written for a client that can simply open a
 * browser. A Next.js route cannot: the authorization happens in the faculty
 * member's browser, across two separate HTTP requests, with the server holding
 * nothing in memory between them.
 *
 * So `redirectToAuthorization` throws instead of navigating. The caller
 * catches that, persists what the second request will need, and hands the URL
 * to the browser. When the provider redirects back, the state parameter finds
 * the stored record and the SDK finishes the exchange.
 *
 * Nothing token-shaped ever reaches the client. The browser sees an
 * authorization URL and, later, a connector that is connected — never an
 * access token, a refresh token or a code verifier.
 */

/** Thrown to hand an authorization URL back out of the SDK's auth flow. */
export class NeedsAuthorizationError extends Error {
  constructor(readonly authorizationUrl: string) {
    super('This server requires authorization.');
    this.name = 'NeedsAuthorizationError';
  }
}

/** What the callback request needs in order to finish. Stored server-side. */
export interface PendingAuthorization {
  state: string;
  serverUrl: string;
  displayName: string;
  description?: string;
  /** Who started it. The callback must be completed by the same person. */
  ownerId: string;
  codeVerifier: SealedSecret | null;
  clientInformation: SealedSecret | null;
  createdAt: string;
  /** Short — an authorization left half-finished is abandoned, not pending. */
  expiresAt: string;
}

export interface StoredTokens {
  tokens: SealedSecret;
  clientInformation: SealedSecret | null;
  updatedAt: string;
}

/** A fresh, unguessable `state`, which is the CSRF defence for the callback. */
export function newState(): string {
  return randomBytes(24).toString('base64url');
}

export function isExpired(pending: PendingAuthorization, now: Date = new Date()): boolean {
  return new Date(pending.expiresAt).getTime() <= now.getTime();
}

/**
 * What EduPlus tells an authorization server about itself.
 *
 * Only the scopes an MCP connector needs are requested. There is no refresh
 * flow worth having without `offline_access` where a server honours it, but we
 * do not ask for anything beyond what the server's own metadata advertises.
 */
function clientMetadataFor(redirectUrl: string): OAuthClientMetadata {
  return {
    client_name: 'EduPlus AI',
    redirect_uris: [redirectUrl],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'client_secret_post',
  };
}

/**
 * A provider that works across two requests.
 *
 * `mutations` collects everything the SDK saves during a flow, so the caller
 * can persist it once at the end rather than writing to Firestore from inside
 * a library callback.
 */
export class WebOAuthProvider implements OAuthClientProvider {
  readonly mutations: {
    codeVerifier?: string;
    clientInformation?: OAuthClientInformationMixed;
    tokens?: OAuthTokens;
  } = {};

  constructor(
    private readonly options: {
      redirectUrl: string;
      state: string;
      /** Set on the callback leg, from the stored pending record. */
      existingCodeVerifier?: string;
      existingClientInformation?: OAuthClientInformationMixed;
      existingTokens?: OAuthTokens;
    },
  ) {}

  get redirectUrl(): string {
    return this.options.redirectUrl;
  }

  get clientMetadata(): OAuthClientMetadata {
    return clientMetadataFor(this.options.redirectUrl);
  }

  state(): string {
    return this.options.state;
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    return this.mutations.clientInformation ?? this.options.existingClientInformation;
  }

  saveClientInformation(info: OAuthClientInformationMixed): void {
    this.mutations.clientInformation = info;
  }

  tokens(): OAuthTokens | undefined {
    return this.mutations.tokens ?? this.options.existingTokens;
  }

  saveTokens(tokens: OAuthTokens): void {
    this.mutations.tokens = tokens;
  }

  saveCodeVerifier(codeVerifier: string): void {
    this.mutations.codeVerifier = codeVerifier;
  }

  codeVerifier(): string {
    const verifier = this.mutations.codeVerifier ?? this.options.existingCodeVerifier;
    if (!verifier) {
      // Without PKCE the authorization code is bearer-grade on its own. Failing
      // here is correct; proceeding would be downgrading the flow silently.
      throw new Error('No PKCE code verifier for this authorization. Start the flow again.');
    }
    return verifier;
  }

  /**
   * The browser does the redirecting, not this process.
   *
   * Throwing is how the URL escapes the SDK's internal flow. The caller treats
   * this as "authorization needed", not as a failure.
   */
  redirectToAuthorization(authorizationUrl: URL): never {
    throw new NeedsAuthorizationError(authorizationUrl.href);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sealing helpers — the only places tokens are turned into stored values
// ─────────────────────────────────────────────────────────────────────────────

export function sealTokens(tokens: OAuthTokens, env?: NodeJS.ProcessEnv): SealedSecret {
  return seal(JSON.stringify(tokens), env);
}

export function openTokens(sealed: SealedSecret, env?: NodeJS.ProcessEnv): OAuthTokens {
  return JSON.parse(open(sealed, env)) as OAuthTokens;
}

export function sealClientInformation(
  info: OAuthClientInformationMixed,
  env?: NodeJS.ProcessEnv,
): SealedSecret {
  return seal(JSON.stringify(info), env);
}

export function openClientInformation(
  sealed: SealedSecret,
  env?: NodeJS.ProcessEnv,
): OAuthClientInformationMixed {
  return JSON.parse(open(sealed, env)) as OAuthClientInformationMixed;
}
