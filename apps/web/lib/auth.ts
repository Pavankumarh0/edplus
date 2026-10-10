import 'server-only';
import { cookies } from 'next/headers';
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';
import { getAdminApp } from '@eduplus/core/repositories';
import type { Actor } from '@eduplus/core';

export const SESSION_COOKIE = 'eduplus_session';
/** Five days, the Firebase maximum for a session cookie. */
export const SESSION_MAX_AGE_MS = 60 * 60 * 24 * 5 * 1000;

export interface Session {
  uid: string;
  email: string | null;
  name: string | null;
  role: 'faculty' | 'student' | null;
  /** Present on student accounts — which records are theirs. */
  usn: string | null;
}

function toSession(token: DecodedIdToken): Session {
  const role = token.role === 'faculty' || token.role === 'student' ? token.role : null;
  return {
    uid: token.uid,
    email: typeof token.email === 'string' ? token.email : null,
    name: typeof token.name === 'string' ? token.name : null,
    role,
    usn: typeof token.usn === 'string' ? token.usn : null,
  };
}

/**
 * Mints a session cookie from a client ID token.
 *
 * A session cookie rather than a bearer token in localStorage: it is
 * httpOnly, so no client script can read it, and it is checked server-side on
 * every request — which is what lets server components query Firestore with
 * the Admin SDK without trusting anything the browser said about its own role.
 */
export async function createSessionCookie(idToken: string): Promise<string> {
  const auth = getAuth(getAdminApp());
  return auth.createSessionCookie(idToken, { expiresIn: SESSION_MAX_AGE_MS });
}

/**
 * The current session, or null.
 *
 * `checkRevoked: true` costs a lookup but means disabling an account takes
 * effect immediately rather than when the cookie happens to expire.
 */
export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  const cookie = store.get(SESSION_COOKIE)?.value;
  if (!cookie) return null;

  try {
    const auth = getAuth(getAdminApp());
    const decoded = await auth.verifySessionCookie(cookie, true);
    return toSession(decoded);
  } catch {
    // Expired, revoked or forged — all the same answer.
    return null;
  }
}

/** The session, or throw. For API routes that must not proceed anonymously. */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) throw new UnauthorizedError('Not signed in.');
  return session;
}

export async function requireFaculty(): Promise<Session> {
  const session = await requireSession();
  if (session.role !== 'faculty') {
    throw new ForbiddenError(
      'This action is for faculty accounts. ' +
        (session.role === null
          ? 'Your account has no role assigned yet — ask an administrator to set one.'
          : 'You are signed in as a student.'),
    );
  }
  return session;
}

/** The actor to pass into the shared tool layer. */
export function actorFor(session: Session): Actor {
  return {
    kind: session.role === 'faculty' ? 'faculty' : session.role === 'student' ? 'student' : 'system',
    id: session.uid,
  };
}

export class UnauthorizedError extends Error {
  readonly status = 401;
}

export class ForbiddenError extends Error {
  readonly status = 403;
}
