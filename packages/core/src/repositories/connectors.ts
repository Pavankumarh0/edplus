import {
  RemoteConnectorSchema,
  type RemoteConnector,
} from '../schemas/index';
import { nowIso, type Firestore } from './firestore';

/**
 * Remote MCP connectors, at `connectors/{connectorId}`.
 *
 * Institution-wide rather than per-user: a connector is a decision about what
 * the whole system may reach, which is a faculty decision. Firestore rules
 * deny clients this collection entirely — it is read through the API, which
 * applies the faculty check first.
 *
 * Nothing stored here is a credential. A server needing auth is out of scope
 * for now, and the schema has no field for a secret precisely so that nobody
 * adds one in plaintext later by accident.
 */

const CONNECTORS = 'connectors';

export async function saveRemoteConnector(
  db: Firestore,
  connector: RemoteConnector,
): Promise<void> {
  await db
    .collection(CONNECTORS)
    .doc(connector.connectorId)
    .set(RemoteConnectorSchema.parse(connector));
}

export async function getRemoteConnector(
  db: Firestore,
  connectorId: string,
): Promise<RemoteConnector | null> {
  const doc = await db.collection(CONNECTORS).doc(connectorId).get();
  return doc.exists ? RemoteConnectorSchema.parse(doc.data()) : null;
}

export async function listRemoteConnectors(db: Firestore): Promise<RemoteConnector[]> {
  const snap = await db.collection(CONNECTORS).get();
  return snap.docs
    .map((d) => RemoteConnectorSchema.parse(d.data()))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export async function deleteRemoteConnector(db: Firestore, connectorId: string): Promise<void> {
  await db.collection(CONNECTORS).doc(connectorId).delete();
}

/** Applies a partial change and returns the stored result. */
export async function updateRemoteConnector(
  db: Firestore,
  connectorId: string,
  patch: Partial<RemoteConnector>,
): Promise<RemoteConnector> {
  const current = await getRemoteConnector(db, connectorId);
  if (!current) throw new Error(`No connector "${connectorId}".`);

  const next = RemoteConnectorSchema.parse({ ...current, ...patch, updatedAt: nowIso() });
  await db.collection(CONNECTORS).doc(connectorId).set(next);
  return next;
}

/**
 * Turns one discovered tool on or off.
 *
 * Separate from `updateRemoteConnector` because it is the common case and
 * because reading-then-writing the whole document for a single boolean is
 * where two mentors clicking at once would lose one of the changes.
 */
export async function setRemoteToolEnabled(
  db: Firestore,
  connectorId: string,
  toolName: string,
  enabled: boolean,
): Promise<RemoteConnector> {
  const ref = db.collection(CONNECTORS).doc(connectorId);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error(`No connector "${connectorId}".`);

    const current = RemoteConnectorSchema.parse(snap.data());
    const tools = current.tools.map((tool) =>
      tool.name === toolName ? { ...tool, enabled } : tool,
    );
    if (!tools.some((t) => t.name === toolName)) {
      throw new Error(`"${connectorId}" has no tool called "${toolName}".`);
    }

    const next = RemoteConnectorSchema.parse({ ...current, tools, updatedAt: nowIso() });
    tx.set(ref, next);
    return next;
  });
}

/**
 * Every remote tool an agent may currently call.
 *
 * Both conditions matter: the connector has to be connected AND the individual
 * tool enabled. Disconnecting a connector therefore revokes all of its tools
 * without having to touch each one.
 */
export async function listEnabledRemoteTools(db: Firestore): Promise<
  { connector: RemoteConnector; tool: RemoteConnector['tools'][number] }[]
> {
  const connectors = await listRemoteConnectors(db);
  return connectors
    .filter((c) => c.status === 'connected')
    .flatMap((connector) =>
      connector.tools.filter((tool) => tool.enabled).map((tool) => ({ connector, tool })),
    );
}
