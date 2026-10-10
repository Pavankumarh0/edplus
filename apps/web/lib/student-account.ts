import 'server-only';
import { getAuth } from 'firebase-admin/auth';
import { getAdminApp } from '@eduplus/core/repositories';

export interface StudentAccount {
  exists: boolean;
  email: string | null;
  /** Null until they sign in for the first time. */
  lastSignInAt: string | null;
  createdAt: string | null;
  disabled: boolean;
  /** True when the token carries the usn claim the security rules need. */
  claimsOk: boolean;
}

/**
 * Whether a student can actually use the mobile app.
 *
 * Faculty ask "has she got the app yet?" and, when a student says the app
 * shows nothing, the answer is almost always one of two things: no account, or
 * an account without the `usn` claim that the Firestore rules check. Both are
 * invisible from the data alone, so they are surfaced here.
 *
 * Never throws — an Auth lookup failing must not take down a student page.
 */
export async function getStudentAccount(
  usn: string,
  authUid?: string,
): Promise<StudentAccount> {
  const empty: StudentAccount = {
    exists: false,
    email: null,
    lastSignInAt: null,
    createdAt: null,
    disabled: false,
    claimsOk: false,
  };

  try {
    const auth = getAuth(getAdminApp());

    // Prefer the uid recorded on the student document; fall back to scanning
    // by claim is not possible, so a student with no linked uid reads as "no
    // account yet", which is the honest answer.
    if (!authUid) return empty;

    const user = await auth.getUser(authUid);
    const claims = (user.customClaims ?? {}) as { role?: string; usn?: string };

    return {
      exists: true,
      email: user.email ?? null,
      lastSignInAt: user.metadata.lastSignInTime
        ? new Date(user.metadata.lastSignInTime).toISOString()
        : null,
      createdAt: user.metadata.creationTime
        ? new Date(user.metadata.creationTime).toISOString()
        : null,
      disabled: user.disabled,
      claimsOk: claims.role === 'student' && claims.usn === usn,
    };
  } catch {
    return empty;
  }
}
