import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuth } from 'firebase-admin/auth';
import { getAdminApp, getDb } from '@eduplus/core/repositories';
import { linkAuthUid } from '@eduplus/core/repositories';
import { SESSION_COOKIE, SESSION_MAX_AGE_MS, createSessionCookie } from '@/lib/auth';

const BodySchema = z.object({ idToken: z.string().min(20) });

/**
 * Trades a Firebase ID token for an httpOnly session cookie.
 *
 * The role is read from the token's custom claims, never from the request
 * body — a client cannot ask to be faculty.
 */
export async function POST(request: Request) {
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Expected an idToken.' }, { status: 400 });
  }

  try {
    const auth = getAuth(getAdminApp());
    const decoded = await auth.verifyIdToken(parsed.data.idToken, true);

    const role = decoded.role;
    if (role !== 'faculty' && role !== 'student') {
      // Signed in to Firebase, but nobody has granted a role. Common with
      // Google sign-in on a fresh account, so say exactly what is missing.
      return NextResponse.json(
        {
          error:
            'Your account has no role assigned. An administrator needs to set ' +
            'role=faculty (or role=student) on it before you can sign in.',
        },
        { status: 403 },
      );
    }

    // Keep the student record pointed at the right auth uid, so the mobile app
    // can find itself after a first Google sign-in.
    if (role === 'student' && typeof decoded.usn === 'string' && decoded.usn) {
      await linkAuthUid(getDb(), decoded.usn, decoded.uid).catch(() => {
        /* non-fatal: sign-in should not fail because a backfill did */
      });
    }

    const cookie = await createSessionCookie(parsed.data.idToken);
    const store = await cookies();
    store.set(SESSION_COOKIE, cookie, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_MAX_AGE_MS / 1000,
    });

    return NextResponse.json({ role, usn: decoded.usn ?? null });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // The commonest local failure by far: no service account configured.
    if (/credential|private_key|FIREBASE_PRIVATE_KEY|Admin credentials/i.test(message)) {
      return NextResponse.json(
        {
          error:
            'The server has no Firebase Admin credentials, so it cannot verify sign-in. ' +
            'Add FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY to .env.local, or run ' +
            'against the emulator.',
        },
        { status: 500 },
      );
    }

    return NextResponse.json({ error: 'Could not verify that sign-in.' }, { status: 401 });
  }
}

/** Signs out by clearing the cookie. */
export async function DELETE() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  return NextResponse.json({ ok: true });
}
