import {
  ApprovedStudentConnectorSchema,
  DEFAULT_STUDENT_CONNECTOR_POLICY,
  StudentConnectionSchema,
  StudentConnectorPolicySchema,
  type ApprovedStudentConnector,
  type StudentConnection,
  type StudentConnectorPolicy,
} from '../schemas/index';
import { nowIso, type Firestore } from './firestore';

const CONFIG = 'config';
const POLICY_DOC = 'studentConnectors';

/**
 * The institution's approved list.
 *
 * Read fresh on every call that matters. A student's connection points at an
 * entry here rather than storing a URL, so removing an entry revokes it for
 * everyone immediately — which is the behaviour a college needs when a service
 * turns out to be a bad idea.
 */
export async function getStudentConnectorPolicy(
  db: Firestore,
): Promise<StudentConnectorPolicy> {
  const snap = await db.collection(CONFIG).doc(POLICY_DOC).get();
  if (!snap.exists) return DEFAULT_STUDENT_CONNECTOR_POLICY;
  return StudentConnectorPolicySchema.parse(snap.data());
}

export async function setStudentConnectorPolicy(
  db: Firestore,
  policy: Omit<StudentConnectorPolicy, 'updatedAt' | 'updatedBy'>,
  updatedBy: string,
): Promise<StudentConnectorPolicy> {
  const next = StudentConnectorPolicySchema.parse({
    ...policy,
    updatedAt: nowIso(),
    updatedBy,
  });
  await db.collection(CONFIG).doc(POLICY_DOC).set(next);
  return next;
}

/** Adds or replaces one approved entry. */
export async function approveStudentConnector(
  db: Firestore,
  entry: ApprovedStudentConnector,
  updatedBy: string,
): Promise<StudentConnectorPolicy> {
  const ref = db.collection(CONFIG).doc(POLICY_DOC);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists
      ? StudentConnectorPolicySchema.parse(snap.data())
      : DEFAULT_STUDENT_CONNECTOR_POLICY;

    const parsed = ApprovedStudentConnectorSchema.parse(entry);
    const approved = [...current.approved.filter((e) => e.id !== parsed.id), parsed].sort(
      (a, b) => a.displayName.localeCompare(b.displayName),
    );

    const next = StudentConnectorPolicySchema.parse({
      // Approving the first entry turns the feature on; leaving it off while
      // listing approved servers would just be confusing.
      enabled: true,
      approved,
      updatedAt: nowIso(),
      updatedBy,
    });
    tx.set(ref, next);
    return next;
  });
}

/** Removes an approved entry, revoking it for every student at once. */
export async function revokeStudentConnector(
  db: Firestore,
  id: string,
  updatedBy: string,
): Promise<StudentConnectorPolicy> {
  const ref = db.collection(CONFIG).doc(POLICY_DOC);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists
      ? StudentConnectorPolicySchema.parse(snap.data())
      : DEFAULT_STUDENT_CONNECTOR_POLICY;

    const next = StudentConnectorPolicySchema.parse({
      ...current,
      approved: current.approved.filter((e) => e.id !== id),
      updatedAt: nowIso(),
      updatedBy,
    });
    tx.set(ref, next);
    return next;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// One student's connections
// ─────────────────────────────────────────────────────────────────────────────

function connectionsRef(db: Firestore, usn: string) {
  return db.collection('students').doc(usn).collection('connectors');
}

export async function saveStudentConnection(
  db: Firestore,
  connection: StudentConnection,
): Promise<void> {
  await connectionsRef(db, connection.usn)
    .doc(connection.id)
    .set(StudentConnectionSchema.parse(connection));
}

export async function getStudentConnection(
  db: Firestore,
  usn: string,
  id: string,
): Promise<StudentConnection | null> {
  const doc = await connectionsRef(db, usn).doc(id).get();
  return doc.exists ? StudentConnectionSchema.parse(doc.data()) : null;
}

export async function listStudentConnections(
  db: Firestore,
  usn: string,
): Promise<StudentConnection[]> {
  const snap = await connectionsRef(db, usn).get();
  return snap.docs.map((d) => StudentConnectionSchema.parse(d.data()));
}

export async function deleteStudentConnection(
  db: Firestore,
  usn: string,
  id: string,
): Promise<void> {
  await connectionsRef(db, usn).doc(id).delete();
}

/**
 * The resolved, currently-usable connections for one student.
 *
 * A connection only counts when it still points at an approved entry and the
 * policy is on. That is what makes revocation work: nothing has to walk every
 * student's documents to take a server away.
 */
export async function listUsableStudentConnections(
  db: Firestore,
  usn: string,
): Promise<{ entry: ApprovedStudentConnector; connection: StudentConnection }[]> {
  const [policy, connections] = await Promise.all([
    getStudentConnectorPolicy(db),
    listStudentConnections(db, usn),
  ]);

  if (!policy.enabled) return [];

  const byId = new Map(policy.approved.map((e) => [e.id, e]));
  return connections
    .map((connection) => {
      const entry = byId.get(connection.id);
      return entry ? { entry, connection } : null;
    })
    .filter((v): v is { entry: ApprovedStudentConnector; connection: StudentConnection } =>
      v !== null,
    );
}
