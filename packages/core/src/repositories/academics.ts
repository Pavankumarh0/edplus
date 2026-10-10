import {
  AcademicRecordSchema,
  RiskSnapshotSchema,
  StudentReportSchema,
  type AcademicRecord,
  type RecordType,
  type RiskSnapshot,
  type StudentReport,
} from '../schemas/index.js';
import { commitAll, nowIso, type Firestore } from './firestore.js';

function studentRef(db: Firestore, usn: string) {
  return db.collection('students').doc(usn);
}

// ─────────────────────────────────────────────────────────────────────────────
// Academic records
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Writes academic records, keyed by their deterministic `recordId`.
 *
 * This is what makes re-importing a corrected sheet safe: the same student,
 * type, subject and date always lands on the same document, so a second upload
 * overwrites rather than double-counting.
 */
export async function writeRecords(db: Firestore, records: AcademicRecord[]): Promise<number> {
  const timestamp = nowIso();
  return commitAll(db, records, (batch, record) => {
    batch.set(
      studentRef(db, record.usn).collection('records').doc(record.recordId),
      { ...record, createdAt: timestamp },
      { merge: true },
    );
  });
}

export async function getRecords(
  db: Firestore,
  usn: string,
  type?: RecordType,
): Promise<AcademicRecord[]> {
  let query = studentRef(db, usn).collection('records') as ReturnType<
    ReturnType<typeof studentRef>['collection']
  >;
  const snap = type ? await query.where('type', '==', type).get() : await query.get();
  return snap.docs.map((d) => AcademicRecordSchema.parse(d.data()));
}

// ─────────────────────────────────────────────────────────────────────────────
// Risk snapshots — the progress history
// ─────────────────────────────────────────────────────────────────────────────

export async function saveSnapshot(db: Firestore, snapshot: RiskSnapshot): Promise<void> {
  await studentRef(db, snapshot.usn)
    .collection('snapshots')
    .doc(snapshot.snapshotId)
    .set(snapshot);
}

export async function saveSnapshots(db: Firestore, snapshots: RiskSnapshot[]): Promise<number> {
  return commitAll(db, snapshots, (batch, snapshot) => {
    batch.set(
      studentRef(db, snapshot.usn).collection('snapshots').doc(snapshot.snapshotId),
      snapshot,
    );
  });
}

/**
 * The student's current risk position.
 *
 * Ordered by `createdAt` rather than document id. Snapshot ids happen to sort
 * chronologically, but relying on that would couple every query to the id
 * format.
 */
export async function getLatestSnapshot(
  db: Firestore,
  usn: string,
): Promise<RiskSnapshot | null> {
  const snap = await studentRef(db, usn)
    .collection('snapshots')
    .orderBy('createdAt', 'desc')
    .limit(1)
    .get();
  const first = snap.docs[0];
  return first ? RiskSnapshotSchema.parse(first.data()) : null;
}

/** Snapshot history, newest first. Drives the risk chart and the projection. */
export async function getSnapshotHistory(
  db: Firestore,
  usn: string,
  limit = 20,
): Promise<RiskSnapshot[]> {
  const snap = await studentRef(db, usn)
    .collection('snapshots')
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .get();
  return snap.docs.map((d) => RiskSnapshotSchema.parse(d.data()));
}

export async function getSnapshot(
  db: Firestore,
  usn: string,
  snapshotId: string,
): Promise<RiskSnapshot | null> {
  const snap = await studentRef(db, usn).collection('snapshots').doc(snapshotId).get();
  return snap.exists ? RiskSnapshotSchema.parse(snap.data()) : null;
}

/** Latest snapshot for every student, for the prioritised queue. */
export async function getLatestSnapshotsForAll(
  db: Firestore,
  usns: string[],
): Promise<Map<string, RiskSnapshot>> {
  const out = new Map<string, RiskSnapshot>();
  // Firestore has no "latest child per parent" query, so this fans out. Fine
  // at classroom scale; a cohort-wide dashboard would denormalise the latest
  // snapshot onto the student document instead.
  await Promise.all(
    usns.map(async (usn) => {
      const latest = await getLatestSnapshot(db, usn);
      if (latest) out.set(usn, latest);
    }),
  );
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Claude reports
// ─────────────────────────────────────────────────────────────────────────────

export async function saveReport(db: Firestore, report: StudentReport): Promise<void> {
  await studentRef(db, report.usn).collection('reports').doc(report.reportId).set(report);
}

/**
 * Latest report for a student.
 *
 * A report is only ever displayed next to the snapshot it was written for, so
 * callers compare `report.snapshotId` against the current snapshot and show it
 * as stale rather than silently presenting an explanation of old numbers.
 */
export async function getLatestReport(
  db: Firestore,
  usn: string,
): Promise<StudentReport | null> {
  const snap = await studentRef(db, usn)
    .collection('reports')
    .orderBy('createdAt', 'desc')
    .limit(1)
    .get();
  const first = snap.docs[0];
  return first ? StudentReportSchema.parse(first.data()) : null;
}

export async function getReportForSnapshot(
  db: Firestore,
  usn: string,
  snapshotId: string,
): Promise<StudentReport | null> {
  const snap = await studentRef(db, usn)
    .collection('reports')
    .where('snapshotId', '==', snapshotId)
    .limit(1)
    .get();
  const first = snap.docs[0];
  return first ? StudentReportSchema.parse(first.data()) : null;
}
