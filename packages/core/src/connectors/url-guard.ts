import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Deciding whether a user-supplied MCP URL is safe to fetch.
 *
 * A remote connector means someone pastes a URL and this server makes requests
 * to it. Without these checks that is a server-side request forgery hole
 * pointed at everything the server can reach but the user cannot: the cloud
 * metadata endpoint holding instance credentials, Firestore's local emulator,
 * other services on the private network.
 *
 * A syntax check is not enough, for two reasons this module handles:
 *
 *   1. A hostname can resolve to a private address. `evil.example.com` with an
 *      A record of 169.254.169.254 passes every string test ever written.
 *   2. A name can resolve differently the second time — DNS rebinding. So the
 *      address is pinned at validation and the connection is made to the
 *      pinned IP, never re-resolved.
 *
 * Every rejection says what was wrong in words a person can act on, because
 * "invalid URL" to someone pasting a legitimate address is useless.
 */

export class UrlNotAllowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UrlNotAllowedError';
  }
}

export interface CheckedUrl {
  url: URL;
  /** The address this host resolved to, pinned against rebinding. */
  address: string;
  family: 4 | 6;
}

/** Allows http on loopback only when explicitly opted in, for local testing. */
function allowsPlaintextLoopback(env: NodeJS.ProcessEnv): boolean {
  return env.EDUPLUS_ALLOW_LOCAL_CONNECTORS === '1';
}

/**
 * IPv4 ranges that must never be reachable from a pasted URL.
 *
 * 169.254.169.254 is the big one — on AWS, GCP and Azure it serves instance
 * credentials to anything that asks, which is why it is the canonical SSRF
 * target. The rest are private, loopback, or otherwise not the public internet.
 */
function isBlockedIpv4(address: string): boolean {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    return true;
  }
  const [a, b] = parts as [number, number, number, number];

  if (a === 0) return true; // "this network"
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a === 192 && b === 0) return true; // protocol assignments / test
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast, reserved, broadcast
  return false;
}

function isBlockedIpv6(address: string): boolean {
  const value = address.toLowerCase().split('%')[0]!;

  if (value === '::' || value === '::1') return true; // unspecified, loopback
  if (value.startsWith('fe80')) return true; // link-local
  if (value.startsWith('fc') || value.startsWith('fd')) return true; // unique local
  if (value.startsWith('ff')) return true; // multicast

  // ::ffff:a.b.c.d — an IPv4 address wearing an IPv6 coat, which would
  // otherwise walk straight past the IPv4 rules above.
  const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedIpv4(mapped[1]!);

  return false;
}

export function isBlockedAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isBlockedIpv4(address);
  if (version === 6) return isBlockedIpv6(address);
  return true; // not an IP at all — refuse rather than guess
}

/** Syntax and scheme checks, before any DNS happens. */
export function parseConnectorUrl(raw: string, env: NodeJS.ProcessEnv = process.env): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new UrlNotAllowedError(
      'That is not a valid URL. It should look like https://mcp.example.com/mcp',
    );
  }

  const loopbackNames = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
  const isLoopbackName = loopbackNames.has(url.hostname.toLowerCase());

  if (url.protocol !== 'https:') {
    if (url.protocol === 'http:' && isLoopbackName && allowsPlaintextLoopback(env)) {
      // Local mock servers during development and in the test suite.
    } else {
      throw new UrlNotAllowedError(
        'The server URL must start with https:// — an MCP connection carries ' +
          'student data and will not be made over plain http.',
      );
    }
  }

  // Credentials in a URL get logged, stored and shoulder-surfed. A server that
  // needs auth should take a header, not a username in the address bar.
  if (url.username || url.password) {
    throw new UrlNotAllowedError(
      'Remove the username and password from the URL. Credentials in a URL end up ' +
        'in logs and browser history.',
    );
  }

  if (url.hash) {
    throw new UrlNotAllowedError('Remove the # fragment from the URL — it is never sent.');
  }

  return url;
}

/**
 * Full check: syntax, then DNS, then the resolved address.
 *
 * Returns the pinned address so the caller connects to the IP that was
 * actually vetted. Re-resolving at connection time is exactly the window a
 * rebinding attack needs.
 */
export async function checkConnectorUrl(
  raw: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CheckedUrl> {
  const url = parseConnectorUrl(raw, env);

  // An explicit opt-in for local mock servers, used by the tests. Never on in
  // production, and it is the only path that skips the address check.
  if (allowsPlaintextLoopback(env) && ['localhost', '127.0.0.1'].includes(url.hostname)) {
    return { url, address: '127.0.0.1', family: 4 };
  }

  let resolved: { address: string; family: number };
  try {
    resolved = await lookup(url.hostname, { verbatim: true });
  } catch {
    throw new UrlNotAllowedError(
      `Could not resolve "${url.hostname}". Check the address is spelled correctly ` +
        'and that the server is reachable from the internet.',
    );
  }

  if (isBlockedAddress(resolved.address)) {
    throw new UrlNotAllowedError(
      `"${url.hostname}" resolves to ${resolved.address}, which is a private or ` +
        'reserved address. A connector must point at a public server — this is ' +
        'refused whether the address was typed directly or arrived through DNS.',
    );
  }

  return {
    url,
    address: resolved.address,
    family: resolved.family === 6 ? 6 : 4,
  };
}
