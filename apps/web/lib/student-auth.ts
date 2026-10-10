import 'server-only';
import { getAuth } from 'firebase-admin/auth';
import { getAdminApp } from '@eduplus/core/repositories';
import type { Actor } from '@eduplus/core';
import { ForbiddenError, UnauthorizedError } from './auth';

export interface StudentPrincipal {
  uid: string;
  usn: string;
  email: string | null;
}

/**
 * Authenticates the Flutter app.
 *
 * The app has no session cookie — it holds a Firebase ID token — so it sends
 * `Authorization: Bearer <idToken>` and the token is verified here.
 *
 * The USN comes from the token's custom claim and NOWHERE else. The request
 * body never gets to say which student it is about: that is what stops one
 * student asking Planly about another by editing a field.
 */
export async function requireStudent(request: Request): Promise<StudentPrincipal> {
  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';

  if (!token) {
    throw new UnauthorizedError('Sign in to the EduPlus app first.');
  }

  let decoded;
  try {
    decoded = await getAuth(getAdminApp()).verifyIdToken(token, true);
  } catch {
    throw new UnauthorizedError('Your session has expired. Sign in again.');
  }

  if (decoded.role !== 'student') {
    throw new ForbiddenError('This is for student accounts.');
  }

  const usn = typeof decoded.usn === 'string' ? decoded.usn : '';
  if (!usn) {
    throw new ForbiddenError(
      'Your account is not linked to a student record yet. Ask your department office.',
    );
  }

  return { uid: decoded.uid, usn, email: decoded.email ?? null };
}

/**
 * The actor Planly runs as.
 *
 * Carries the student's USN, which is what every student-scoped tool reads
 * instead of taking it as an argument.
 */
export function planlyActor(student: StudentPrincipal): Actor {
  return {
    kind: 'agent',
    id: `agent:planly:${student.uid}`,
    agentName: 'planly',
    usn: student.usn,
  };
}

/** The actor for things the student does themselves, e.g. ticking a task. */
export function studentActor(student: StudentPrincipal): Actor {
  return { kind: 'student', id: student.uid, usn: student.usn };
}
