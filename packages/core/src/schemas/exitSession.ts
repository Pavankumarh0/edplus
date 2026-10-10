import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { IsoDateTimeSchema, UsnSchema } from './common';

/**
 * Classroom exit verification.
 *
 * WHAT THIS CANNOT DO, stated here because the feature is easy to oversell:
 * a QR code cannot prove a student was in the room, and it cannot prove they
 * left it. It proves that a signed-in student's phone sent a token that was
 * valid at that moment. A student who photographs the screen and sends it to a
 * friend defeats it; so does one who scans and sits back down.
 *
 * What it does give is a timestamped, server-verified record that is hard to
 * forge after the fact and impossible to replay later — which is a real thing,
 * just not attendance. It is deliberately kept out of the risk engine for the
 * same reason: a missing exit scan is not evidence about a student's academics.
 *
 * The token rotates. A static code shown on a projector for ten minutes is a
 * code the whole year group has by minute two; this one changes every
 * ROTATION_SECONDS, so a photograph is stale almost immediately.
 */

export const ROTATION_SECONDS = 15;
/** The previous window is accepted too, so a scan mid-rotation is not lost. */
const ACCEPTED_WINDOWS = 2;

export const EXIT_SESSION_STATUSES = ['open', 'ended'] as const;
export const ExitSessionStatusSchema = z.enum(EXIT_SESSION_STATUSES);
export type ExitSessionStatus = z.infer<typeof ExitSessionStatusSchema>;

export const ExitSessionSchema = z.object({
  sessionId: z.string().min(1),
  /**
   * Never leaves the server.
   *
   * The rotating codes are derived from it, so anyone holding it could mint
   * valid tokens forever. It is stripped from every API response.
   */
  secret: z.string().min(32),

  facultyId: z.string().min(1),
  /** Who may verify. Checked against the student's own record. */
  semester: z.number().int().min(1).max(8),
  section: z.string().trim().min(1).max(8),
  /** Free text — "DBMS lab", "Tuesday tutorial". Shown to the student. */
  label: z.string().trim().min(1).max(120),

  createdAt: IsoDateTimeSchema,
  expiresAt: IsoDateTimeSchema,
  /** Set when a mentor ends it early. */
  endedAt: IsoDateTimeSchema.nullable().default(null),
  status: ExitSessionStatusSchema.default('open'),
});

export type ExitSession = z.infer<typeof ExitSessionSchema>;

/** What a client is allowed to see. Note the absence of `secret`. */
export type PublicExitSession = Omit<ExitSession, 'secret'>;

export function stripSecret(session: ExitSession): PublicExitSession {
  const { secret: _secret, ...rest } = session;
  return rest;
}

export const ExitVerificationSchema = z.object({
  sessionId: z.string().min(1),
  usn: UsnSchema,
  /** Server clock. A device never gets to say when it scanned. */
  verifiedAt: IsoDateTimeSchema,
});

export type ExitVerification = z.infer<typeof ExitVerificationSchema>;

export function newSessionSecret(): string {
  return randomBytes(32).toString('base64url');
}

/** Which rotation window a moment falls in. */
function windowFor(now: Date): number {
  return Math.floor(now.getTime() / (ROTATION_SECONDS * 1000));
}

/**
 * The code to display right now.
 *
 * An HMAC of the window number under the session secret, truncated. Truncated
 * because it has to fit in a QR a phone can read across a classroom, and 8
 * base32-ish characters is 40 bits — forging one inside a 15-second window is
 * not a thing anyone is doing from the back row.
 */
export function currentToken(secret: string, now: Date = new Date()): string {
  return tokenForWindow(secret, windowFor(now));
}

function tokenForWindow(secret: string, window: number): string {
  return createHmac('sha256', secret)
    .update(String(window))
    .digest('base64url')
    .slice(0, 10);
}

/**
 * Whether a scanned token is currently valid.
 *
 * Accepts the current window and the one before it: a student who scans just
 * as the code rotates would otherwise fail for no reason they could understand
 * or fix. Compared in constant time, because this is a secret-derived value
 * and a timing oracle on it would let someone brute-force a window.
 */
export function isTokenValid(
  secret: string,
  token: string,
  now: Date = new Date(),
): boolean {
  const current = windowFor(now);
  for (let back = 0; back < ACCEPTED_WINDOWS; back += 1) {
    const expected = tokenForWindow(secret, current - back);
    const a = Buffer.from(expected);
    const b = Buffer.from(token);
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  return false;
}

/** The QR payload: which session, and the code valid this instant. */
export function exitQrPayload(sessionId: string, token: string): string {
  return `eduplus-exit:${sessionId}:${token}`;
}

export function parseExitQrPayload(
  raw: string,
): { sessionId: string; token: string } | null {
  const match = raw.trim().match(/^eduplus-exit:([^:]+):([^:]+)$/);
  return match ? { sessionId: match[1]!, token: match[2]! } : null;
}

/** True while a session can still accept scans. */
export function isSessionLive(session: ExitSession, now: Date = new Date()): boolean {
  return (
    session.status === 'open' &&
    session.endedAt === null &&
    new Date(session.expiresAt).getTime() > now.getTime()
  );
}

/** Why a session is not accepting scans, in words a student can act on. */
export function describeSessionState(session: ExitSession, now: Date = new Date()): string {
  if (session.endedAt !== null || session.status === 'ended') {
    return 'Your mentor has ended this session.';
  }
  if (new Date(session.expiresAt).getTime() <= now.getTime()) {
    return 'This exit code has expired. Ask your mentor to start a new one.';
  }
  return 'Open.';
}
