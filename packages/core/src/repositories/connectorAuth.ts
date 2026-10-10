import type { PendingAuthorization, StoredTokens } from '../connectors/oauth';
import { nowIso, type Firestore } from './firestore';

/**
 * OAuth state for remote connectors.
 *
 * Two collections, both of which no client may read:
 *
 *   connectorAuth/{state}       — a flow in progress, for a few minutes
 *   connectorSecrets/{id}       — the sealed tokens for a connected server
 *
 * Kept out of `connectors/{id}` on purpose. That document is what the API
 * returns to the dashboard; if the tokens lived on it, every future change to
 * that endpoint would be one careless spread away from serving a refresh token
 * to a browser. Separating them makes the safe thing the default.
 */

const PENDING = 'connectorAuth';
const SECRETS = 'connectorSecrets';

export async function savePendingAuthorization(
  db: Firestore,
  pending: PendingAuthorization,
): Promise<void> {
  await db.collection(PENDING).doc(pending.state).set(pending);
}

export async function takePendingAuthorization(
  db: Firestore,
  state: string,
): Promise<PendingAuthorization | null> {
  const ref = db.collection(PENDING).doc(state);

  // Read and delete together: an authorization code is single-use, and a
  // pending record that survives its own callback is a replay waiting to
  // happen.
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    tx.delete(ref);
    return snap.data() as PendingAuthorization;
  });
}

/** Clears abandoned flows. Cheap, and bounded by how many were ever started. */
export async function purgeExpiredAuthorizations(db: Firestore): Promise<number> {
  const snap = await db.collection(PENDING).where('expiresAt', '<', nowIso()).get();
  if (snap.empty) return 0;

  const batch = db.batch();
  for (const doc of snap.docs) batch.delete(doc.ref);
  await batch.commit();
  return snap.size;
}

export async function saveConnectorTokens(
  db: Firestore,
  connectorId: string,
  tokens: StoredTokens,
): Promise<void> {
  await db.collection(SECRETS).doc(connectorId).set(tokens);
}

export async function getConnectorTokens(
  db: Firestore,
  connectorId: string,
): Promise<StoredTokens | null> {
  const doc = await db.collection(SECRETS).doc(connectorId).get();
  return doc.exists ? (doc.data() as StoredTokens) : null;
}

/**
 * Deletes the stored tokens.
 *
 * Called when a connector is disconnected. The tokens are useless to us then,
 * and keeping a working refresh token for a server nobody uses is exactly the
 * credential that turns up in a breach three years later.
 */
export async function deleteConnectorTokens(
  db: Firestore,
  connectorId: string,
): Promise<void> {
  await db.collection(SECRETS).doc(connectorId).delete();
}
