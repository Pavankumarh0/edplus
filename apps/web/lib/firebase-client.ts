'use client';

import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  browserLocalPersistence,
  connectAuthEmulator,
  getAuth,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  type Auth,
} from 'firebase/auth';

/**
 * Browser-side Firebase, used for sign-in only.
 *
 * These config values are public by design — they identify the project, they
 * do not authorise anything. Access is controlled by Firestore security rules
 * and by the server-side session cookie, not by keeping this secret.
 *
 * Note what this client does NOT do: it never reads Firestore. Every read in
 * the dashboard happens in a server component through the Admin SDK, so the
 * browser is never trusted to decide what it may see.
 */
const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
};

let cachedAuth: Auth | null = null;

function app(): FirebaseApp {
  return getApps().length ? getApp() : initializeApp(config);
}

export function clientAuth(): Auth {
  if (cachedAuth) return cachedAuth;
  const auth = getAuth(app());

  const emulator = process.env.NEXT_PUBLIC_AUTH_EMULATOR_HOST;
  if (emulator) {
    connectAuthEmulator(auth, `http://${emulator}`, { disableWarnings: true });
  }

  cachedAuth = auth;
  return auth;
}

/**
 * Signs in, then trades the ID token for an httpOnly session cookie.
 *
 * The client's own auth state is deliberately short-lived; the cookie is what
 * the server trusts.
 */
async function exchangeForSession(idToken: string): Promise<void> {
  const response = await fetch('/api/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? 'Could not start a session. Try again.');
  }
}

export async function signInWithPassword(email: string, password: string): Promise<void> {
  const auth = clientAuth();
  await setPersistence(auth, browserLocalPersistence);
  const credential = await signInWithEmailAndPassword(auth, email, password);
  await exchangeForSession(await credential.user.getIdToken());
}

export async function signInWithGoogle(): Promise<void> {
  const auth = clientAuth();
  await setPersistence(auth, browserLocalPersistence);
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const credential = await signInWithPopup(auth, provider);
  await exchangeForSession(await credential.user.getIdToken());
}

/** Turns Firebase's error codes into something a person can act on. */
export function describeAuthError(error: unknown): string {
  const code = (error as { code?: string } | null)?.code ?? '';
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'That email and password do not match an account.';
    case 'auth/invalid-email':
      return 'That does not look like an email address.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a minute and try again.';
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'Sign-in was cancelled.';
    case 'auth/popup-blocked':
      return 'Your browser blocked the sign-in popup. Allow popups and try again.';
    case 'auth/network-request-failed':
      return 'Could not reach Firebase. Check your connection.';
    case 'auth/operation-not-allowed':
      return 'That sign-in method is not enabled on this Firebase project.';
    default:
      return error instanceof Error ? error.message : 'Sign-in failed. Try again.';
  }
}
