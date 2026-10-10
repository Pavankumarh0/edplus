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
  /**
   * The exact redirect_uri this flow was started with.
   *
   * Stored rather than recomputed because the token exchange must send the
   * identical value, and because it is derived from the origin the mentor was
   * actually browsing — which is not necessarily the one in PUBLIC_BASE_URL.
   */
  redirectUri: string;
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
    return (
      this.mutations.clientInformation ??
      this.options.existingClientInformation ??
      preRegisteredClient()
    );
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

/**
 * A client id and secret registered by hand, for authorization servers that
 * do not support dynamic registration.
 *
 * Google is the case that forces this: accounts.google.com will not register a
 * client on demand, so connecting Google's own Drive MCP requires an OAuth
 * client someone created in the Cloud console. Servers that do support dynamic
 * registration never reach this — the SDK registers and `saveClientInformation`
 * takes precedence.
 */
export function preRegisteredClient(
  env: NodeJS.ProcessEnv = process.env,
): { client_id: string; client_secret?: string } | undefined {
  const clientId = env.MCP_OAUTH_CLIENT_ID?.trim() || env.GOOGLE_CLIENT_ID?.trim();
  if (!clientId) return undefined;
  const clientSecret = env.MCP_OAUTH_CLIENT_SECRET?.trim() || env.GOOGLE_CLIENT_SECRET?.trim();
  return clientSecret ? { client_id: clientId, client_secret: clientSecret } : { client_id: clientId };
}

/**
 * Where a server publishes its protected-resource metadata.
 *
 * RFC 9728 puts it under the path, not at the root: a server at /mcp/v1
 * advertises at /.well-known/oauth-protected-resource/mcp/v1. Google's Drive
 * MCP does exactly this, and because it answers `initialize` without a token
 * there is no 401 carrying a WWW-Authenticate pointer to find it by. So both
 * spellings are tried, path-scoped first.
 */
export function resourceMetadataUrls(serverUrl: string): string[] {
  const url = new URL(serverUrl);
  const path = url.pathname.replace(/\/+$/, '');
  const scoped = `${url.origin}/.well-known/oauth-protected-resource${path}`;
  const root = `${url.origin}/.well-known/oauth-protected-resource`;
  return scoped === root ? [root] : [scoped, root];
}
