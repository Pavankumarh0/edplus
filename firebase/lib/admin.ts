import { getAuth } from 'firebase-admin/auth';
import { getAdminApp, getDb, isUsingEmulator } from '@eduplus/core/repositories';
import { DEMO_USERS } from './demo-data.js';

export { getDb, isUsingEmulator };

export function describeTarget(): string {
  if (isUsingEmulator()) {
    return `the LOCAL EMULATOR at ${process.env.FIRESTORE_EMULATOR_HOST}`;
  }
  return `the LIVE project "${process.env.FIREBASE_PROJECT_ID ?? '(unset)'}"`;
}

/**
 * Creates (or refreshes) the demo accounts and their custom claims.
 *
 * Claims are what the security rules read: `role` for faculty/student, and
 * `usn` so a student's token identifies which records are theirs without an
 * extra lookup.
 *
 * Non-fatal by design. On a brand-new project the Identity Toolkit API may not
 * be enabled yet, and that should leave the data seed intact rather than
 * aborting the whole script — the data is the hard part to rebuild, the users
 * take one click.
 */
export async function ensureDemoUsers(): Promise<{ created: number; updated: number; skipped: boolean }> {
  const auth = getAuth(getAdminApp());
  let created = 0;
  let updated = 0;

  for (const user of DEMO_USERS) {
    try {
      let record;
      try {
        record = await auth.getUserByEmail(user.email);
        await auth.updateUser(record.uid, {
          password: user.password,
          displayName: user.displayName,
        });
        updated += 1;
      } catch {
        record = await auth.createUser({
          email: user.email,
          password: user.password,
          displayName: user.displayName,
          emailVerified: true,
        });
        created += 1;
      }
      await auth.setCustomUserClaims(record.uid, user.claims);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `\n  ! Could not create demo accounts: ${message}\n` +
          '    Enable Email/Password sign-in, then re-run:\n' +
          '    https://console.firebase.google.com/project/' +
          `${process.env.FIREBASE_PROJECT_ID ?? '_'}/authentication/providers\n`,
      );
      return { created, updated, skipped: true };
    }
  }

  return { created, updated, skipped: false };
}

/**
 * Deletes every document in a collection, including subcollections.
 *
 * Used only by demo-reset. `recursiveDelete` is a server-side bulk operation,
 * so this does not pull 3,000 documents through the client to throw them away.
 */
export async function wipeCollection(path: string): Promise<void> {
  const db = getDb();
  await db.recursiveDelete(db.collection(path));
}

/** Guard against pointing a destructive script at an unexpected project. */
export function assertSafeTarget(allowLive: boolean): void {
  if (isUsingEmulator()) return;
  if (allowLive) return;
  throw new Error(
    'Refusing to modify live Firestore without --live.\n' +
      `Target would be ${describeTarget()}.\n` +
      'Re-run with --live if that is genuinely what you want, or set ' +
      'FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 to use the emulator.',
  );
}
