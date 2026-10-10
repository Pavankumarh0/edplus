import {
  CallRecordSchema,
  InterventionSchema,
  OPEN_STATUSES,
  StudentTaskSchema,
  UploadSchema,
  canTransition,
  type CallRecord,
  type CallStatus,
  type Intervention,
  type InterventionStatus,
  type StudentTask,
  type Upload,
} from '../schemas/index';
import type { ResolvedOutcome } from '../risk/outcome';
import { commitAll, nowIso, type Firestore } from './firestore';

// ─────────────────────────────────────────────────────────────────────────────
// Interventions
// ─────────────────────────────────────────────────────────────────────────────

const INTERVENTIONS = 'interventions';

export async function createIntervention(
  db: Firestore,
  intervention: Intervention,
): Promise<Intervention> {
  const record = InterventionSchema.parse({
    ...intervention,
    createdAt: intervention.createdAt ?? nowIso(),
    updatedAt: nowIso(),
  });
  await db.collection(INTERVENTIONS).doc(record.interventionId).set(record);
  return record;
}

export async function getIntervention(
  db: Firestore,
  interventionId: string,
): Promise<Intervention | null> {
  const snap = await db.collection(INTERVENTIONS).doc(interventionId).get();
  return snap.exists ? InterventionSchema.parse(snap.data()) : null;
}

/**
 * Sorts newest first in memory rather than with `orderBy`.
 *
 * Firestore needs a composite index for every distinct combination of equality
 * filter plus sort, and the combinations here multiply: usn alone, status
 * alone, both, neither. A query filtering on `usn` cannot even reuse the
 * (usn, status, createdAt) index, because `status` sits between the two fields
 * it needs.
 *
 * The result set is a handful of interventions per student or per board
 * column, so sorting them here costs nothing and removes a whole class of
 * FAILED_PRECONDITION errors that only appear once real data exists — which,
 * in practice, means during a demo. The indexes stay declared in
 * firestore.indexes.json for when this outgrows that assumption.
 */
export async function listInterventions(
  db: Firestore,
  filter: { usn?: string; status?: InterventionStatus } = {},
): Promise<Intervention[]> {
  let query = db.collection(INTERVENTIONS) as any;
  if (filter.usn) query = query.where('usn', '==', filter.usn);
  if (filter.status) query = query.where('status', '==', filter.status);

  const snap = await query.get();
  return snap.docs
    .map((d: any) => InterventionSchema.parse(d.data()))
    .sort((a: Intervention, b: Intervention) =>
      (b.createdAt ?? '').localeCompare(a.createdAt ?? ''),
    );
}

/** Interventions still in play, for the "already being supported?" tie-break. */
export async function listOpenInterventions(db: Firestore): Promise<Intervention[]> {
  const snap = await db
    .collection(INTERVENTIONS)
    .where('status', 'in', OPEN_STATUSES)
    .get();
  return snap.docs.map((d) => InterventionSchema.parse(d.data()));
}

/** USNs with at least one open intervention. */
export async function usnsWithOpenInterventions(db: Firestore): Promise<Set<string>> {
  const open = await listOpenInterventions(db);
  return new Set(open.map((i) => i.usn));
}

/**
 * Moves an intervention through its lifecycle, refusing illegal transitions.
 *
 * The guard lives here rather than only in the UI because an agent reaches
 * this through the tool layer too, and "completed → proposed" must be
 * impossible however it is requested.
 */
export async function updateInterventionStatus(
  db: Firestore,
  interventionId: string,
  next: InterventionStatus,
  patch: { owner?: string; notes?: string; dueDate?: string } = {},
): Promise<Intervention> {
  const ref = db.collection(INTERVENTIONS).doc(interventionId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`Intervention ${interventionId} not found`);

  const current = InterventionSchema.parse(snap.data());
  if (current.status !== next && !canTransition(current.status, next)) {
    throw new Error(
      `Cannot move intervention ${interventionId} from "${current.status}" to "${next}".`,
    );
  }

  const update: Record<string, unknown> = { status: next, updatedAt: nowIso(), ...patch };
  if (next === 'completed') update.completedAt = nowIso();

  await ref.set(update, { merge: true });
  return InterventionSchema.parse({ ...current, ...update });
}

/** Writes the before/after verdict decided by `resolveInterventionOutcome`. */
export async function applyOutcomes(
  db: Firestore,
  outcomes: ResolvedOutcome[],
): Promise<number> {
  return commitAll(db, outcomes, (batch, outcome) => {
    batch.set(
      db.collection(INTERVENTIONS).doc(outcome.interventionId),
      {
        outcome: outcome.outcome,
        outcomeSnapshotId: outcome.outcomeSnapshotId,
        outcomeScore: outcome.outcomeScore,
        updatedAt: nowIso(),
      },
      { merge: true },
    );
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Student tasks
// ─────────────────────────────────────────────────────────────────────────────

export async function createTasks(db: Firestore, tasks: StudentTask[]): Promise<number> {
  const timestamp = nowIso();
  return commitAll(db, tasks, (batch, task) => {
    batch.set(
      db.collection('students').doc(task.usn).collection('tasks').doc(task.taskId),
      StudentTaskSchema.parse({ ...task, createdAt: task.createdAt ?? timestamp }),
      { merge: true },
    );
  });
}

export async function listTasks(
  db: Firestore,
  usn: string,
  onlyOpen = false,
): Promise<StudentTask[]> {
  const base = db.collection('students').doc(usn).collection('tasks');
  const snap = onlyOpen ? await base.where('done', '==', false).get() : await base.get();
  return snap.docs.map((d) => StudentTaskSchema.parse(d.data()));
}

export async function listTasksForIntervention(
  db: Firestore,
  usn: string,
  interventionId: string,
): Promise<StudentTask[]> {
  const snap = await db
    .collection('students')
    .doc(usn)
    .collection('tasks')
    .where('interventionId', '==', interventionId)
    .get();
  return snap.docs.map((d) => StudentTaskSchema.parse(d.data()));
}

// ─────────────────────────────────────────────────────────────────────────────
// Parent calls
// ─────────────────────────────────────────────────────────────────────────────

const CALLS = 'calls';

export async function createCall(db: Firestore, call: CallRecord): Promise<CallRecord> {
  const record = CallRecordSchema.parse({ ...call, createdAt: call.createdAt ?? nowIso() });
  await db.collection(CALLS).doc(record.callId).set(record);
  return record;
}

export async function getCall(db: Firestore, callId: string): Promise<CallRecord | null> {
  const snap = await db.collection(CALLS).doc(callId).get();
  return snap.exists ? CallRecordSchema.parse(snap.data()) : null;
}

/** Newest first, sorted in memory for the same reason as interventions. */
export async function listCalls(db: Firestore, usn?: string): Promise<CallRecord[]> {
  let query = db.collection(CALLS) as any;
  if (usn) query = query.where('usn', '==', usn);

  const snap = await query.get();
  return snap.docs
    .map((d: any) => CallRecordSchema.parse(d.data()))
    .sort((a: CallRecord, b: CallRecord) => b.createdAt.localeCompare(a.createdAt));
}

export async function updateCall(
  db: Firestore,
  callId: string,
  patch: Partial<CallRecord> & { status?: CallStatus },
): Promise<void> {
  await db.collection(CALLS).doc(callId).set({ ...patch }, { merge: true });
}

/**
 * Appends a turn to a call transcript.
 *
 * Read-modify-write inside a transaction rather than `arrayUnion`, because
 * arrayUnion de-duplicates and two identical utterances ("Hello?") are
 * legitimately distinct turns in a conversation.
 */
export async function appendTranscriptTurn(
  db: Firestore,
  callId: string,
  turn: CallRecord['transcript'][number],
): Promise<void> {
  const ref = db.collection(CALLS).doc(callId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error(`Call ${callId} not found`);
    const existing = (snap.data()?.transcript ?? []) as CallRecord['transcript'];
    tx.set(ref, { transcript: [...existing, turn] }, { merge: true });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Uploads
// ─────────────────────────────────────────────────────────────────────────────

const UPLOADS = 'uploads';

export async function saveUpload(db: Firestore, upload: Upload): Promise<void> {
  await db.collection(UPLOADS).doc(upload.uploadId).set(UploadSchema.parse(upload));
}

export async function markUploadCommitted(db: Firestore, uploadId: string): Promise<void> {
  await db.collection(UPLOADS).doc(uploadId).set({ committedAt: nowIso() }, { merge: true });
}

export async function getUpload(db: Firestore, uploadId: string): Promise<Upload | null> {
  const snap = await db.collection(UPLOADS).doc(uploadId).get();
  return snap.exists ? UploadSchema.parse(snap.data()) : null;
}

export async function listRecentUploads(db: Firestore, limit = 10): Promise<Upload[]> {
  const snap = await db.collection(UPLOADS).orderBy('createdAt', 'desc').limit(limit).get();
  return snap.docs.map((d) => UploadSchema.parse(d.data()));
}
