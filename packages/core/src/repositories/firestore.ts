import { cert, getApp, getApps, initializeApp, type App } from 'firebase-admin/app';
import { FieldValue, getFirestore, type Firestore } from 'firebase-admin/firestore';

export { FieldValue };
export type { Firestore };

const APP_NAME = 'eduplus-admin';

export interface AdminCredentials {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

/**
 * Reads Admin SDK credentials from the environment.
 *
 * The private key is stored as a single line with literal `\n` sequences
 * (which is how it survives a .env file), so those are expanded back into real
 * newlines here. Getting this wrong produces an opaque "error:0909006C" from
 * OpenSSL, so it is handled in exactly one place.
 */
export function readAdminCredentials(env: NodeJS.ProcessEnv = process.env): AdminCredentials | null {
  const projectId = env.FIREBASE_PROJECT_ID?.trim();
  const clientEmail = env.FIREBASE_CLIENT_EMAIL?.trim();
  const rawKey = env.FIREBASE_PRIVATE_KEY;

  if (!projectId || !clientEmail || !rawKey) return null;

  const privateKey = rawKey
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/\\n/g, '\n');

  if (!privateKey.includes('BEGIN PRIVATE KEY')) return null;

  return { projectId, clientEmail, privateKey };
}

/** True when the Admin SDK will talk to a local emulator rather than live Firestore. */
export function isUsingEmulator(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.FIRESTORE_EMULATOR_HOST);
}

/**
 * Initialises (once) and returns the Admin app.
 *
 * Against the emulator, `FIRESTORE_EMULATOR_HOST` is enough and no service
 * account is needed — which is what makes `npm run seed` work on a laptop
 * with no credentials file.
 */
export function getAdminApp(env: NodeJS.ProcessEnv = process.env): App {
  const existing = getApps().find((a) => a.name === APP_NAME);
  if (existing) return existing;

  const credentials = readAdminCredentials(env);

  if (!credentials) {
    if (isUsingEmulator(env)) {
      return initializeApp(
        { projectId: env.FIREBASE_PROJECT_ID?.trim() || 'eduplus-local' },
        APP_NAME,
      );
    }
    throw new Error(
      'Firebase Admin credentials are missing. Set FIREBASE_PROJECT_ID, ' +
        'FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY in .env.local, or set ' +
        'FIRESTORE_EMULATOR_HOST to use the local emulator.',
    );
  }

  return initializeApp(
    {
      credential: cert({
        projectId: credentials.projectId,
        clientEmail: credentials.clientEmail,
        privateKey: credentials.privateKey,
      }),
      projectId: credentials.projectId,
    },
    APP_NAME,
  );
}

let cachedDb: Firestore | null = null;

/**
 * The shared Firestore handle.
 *
 * `settings()` may be called at most once per Firestore instance, and only
 * before any other method. A module-level cache is not enough to guarantee
 * that: Next.js dev builds, route handlers and server components can each get
 * their own copy of this module, while `getFirestore(app)` hands all of them
 * the SAME underlying instance. The second registry would then call
 * `settings()` on an already-configured object and throw.
 *
 * So the call is attempted and the "already initialized" case is treated as
 * success — the setting we wanted is, by definition, already applied.
 */
export function getDb(env: NodeJS.ProcessEnv = process.env): Firestore {
  if (cachedDb) return cachedDb;

  const app = getAdminApp(env);
  const db = getFirestore(app);

  try {
    // Undefined fields are dropped rather than throwing, so an optional field
    // left unset by a CSV import does not abort the whole write.
    db.settings({ ignoreUndefinedProperties: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/already been initialized|already initialized/i.test(message)) throw error;
  }

  cachedDb = db;
  return db;
}

/** Test seam — forces the next getDb() to rebuild. */
export function resetDbCache(): void {
  cachedDb = null;
}

/** Firestore refuses batches over 500 operations. */
export const MAX_BATCH_OPS = 450;

/** Splits work into Firestore-safe chunks. */
export function chunk<T>(items: T[], size = MAX_BATCH_OPS): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/**
 * Runs many writes in chunked batches.
 *
 * Returns the number of operations committed. Not transactional across
 * chunks — an import of 2,000 records is three batches, and a failure in the
 * third leaves the first two applied. That is acceptable here precisely
 * because record ids are deterministic: re-running the same import converges
 * rather than duplicating.
 */
export async function commitAll<T>(
  db: Firestore,
  items: T[],
  apply: (batch: ReturnType<Firestore['batch']>, item: T) => void,
): Promise<number> {
  let committed = 0;
  for (const group of chunk(items)) {
    const batch = db.batch();
    for (const item of group) apply(batch, item);
    await batch.commit();
    committed += group.length;
  }
  return committed;
}

export function nowIso(): string {
  return new Date().toISOString();
}
