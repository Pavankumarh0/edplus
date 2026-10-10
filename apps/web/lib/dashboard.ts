import 'server-only';
import {
  computeAdherence,
  countByLevel,
  needsDataEntry,
  prioritise,
  projectRisk,
  resolveAllOutcomes,
  type Intervention,
  type PrioritisableStudent,
  type RiskRules,
  type RiskSnapshot,
  type Adherence,
  type Activity,
  type Meeting,
  type Student,
  type StudyPlan,
} from '@eduplus/core';
import { getStudentAccount, type StudentAccount } from './student-account';
import {
  applyOutcomes,
  getDb,
  getLatestReport,
  getLatestSnapshot,
  getLatestSnapshotsForAll,
  getParentContact,
  getRecords,
  getRiskRules,
  getSnapshotHistory,
  getActivePlan,
  getStudent,
  listActivities,
  listCalls,
  listInterventions,
  listRecentUploads,
  listStudents,
  listTasks,
  saveSnapshots,
  usnsWithOpenInterventions,
  listMeetings,
  listUpcomingMeetings,
} from '@eduplus/core/repositories';

/** Everything the Overview screen needs, in one pass. */
export interface OverviewData {
  rules: RiskRules;
  counts: Record<string, number>;
  queue: PrioritisableStudent[];
  dataEntryQueue: PrioritisableStudent[];
  openInterventions: Intervention[];
  recentUploads: Awaited<ReturnType<typeof listRecentUploads>>;
  todaysCalls: Awaited<ReturnType<typeof listCalls>>;
  totalStudents: number;
  scoredStudents: number;
  /** The mentor's own calendar: what they are seeing, and when. */
  upcomingMeetings: Meeting[];
}

async function buildRows(): Promise<{
  rows: PrioritisableStudent[];
  students: Student[];
  snapshots: Map<string, RiskSnapshot>;
}> {
  const db = getDb();
  const students = await listStudents(db);
  const snapshots = await getLatestSnapshotsForAll(
    db,
    students.map((s) => s.usn),
  );
  const open = await usnsWithOpenInterventions(db);

  const rows = students
    .map((student): PrioritisableStudent | null => {
      const snapshot = snapshots.get(student.usn);
      if (!snapshot) return null;
      return {
        usn: student.usn,
        name: student.name,
        snapshot,
        hasOpenIntervention: open.has(student.usn),
      };
    })
    .filter((row): row is PrioritisableStudent => row !== null);

  return { rows, students, snapshots };
}

export async function getOverview(): Promise<OverviewData> {
  const db = getDb();
  const [rules, { rows, students }, openInterventions, recentUploads, calls, upcomingMeetings] =
    await Promise.all([
      getRiskRules(db),
      buildRows(),
      listInterventions(db).then((all) =>
        all.filter((i) => ['proposed', 'approved', 'in_progress'].includes(i.status)),
      ),
      listRecentUploads(db, 5),
      listCalls(db),
      listUpcomingMeetings(db, { limit: 6 }),
    ]);

  const today = new Date().toISOString().slice(0, 10);

  return {
    rules,
    counts: countByLevel(rows),
    queue: prioritise(rows).slice(0, 8),
    dataEntryQueue: needsDataEntry(rows).slice(0, 5),
    openInterventions,
    recentUploads,
    todaysCalls: calls.filter((c) => c.createdAt.slice(0, 10) === today),
    totalStudents: students.length,
    scoredStudents: rows.length,
    upcomingMeetings,
  };
}

export interface StudentsPageData {
  rows: PrioritisableStudent[];
  rules: RiskRules;
}

export async function getStudentsPage(): Promise<StudentsPageData> {
  const db = getDb();
  const [{ rows }, rules] = await Promise.all([buildRows(), getRiskRules(db)]);
  return { rows: prioritise(rows), rules };
}

export interface StudentDetailData {
  student: Student;
  snapshot: RiskSnapshot | null;
  history: RiskSnapshot[];
  report: Awaited<ReturnType<typeof getLatestReport>>;
  reportIsStale: boolean;
  interventions: Intervention[];
  calls: Awaited<ReturnType<typeof listCalls>>;
  tasks: Awaited<ReturnType<typeof listTasks>>;
  rules: RiskRules;
  projection: ReturnType<typeof projectRisk>;
  recordCount: number;
  /** Faculty-only. Null when no contact is on record. */
  parent: Awaited<ReturnType<typeof getParentContact>>;
  /** Whether this student can actually use the mobile app. */
  account: StudentAccount;
  /** Planly's current plan, if the student has asked for one. */
  plan: StudyPlan | null;
  /**
   * Effort against that plan. Reported BESIDE the risk level and never folded
   * into it: a student at At Risk with 90% adherence needs time and
   * encouragement, the same student at 10% needs a different conversation, and
   * the score alone cannot tell those apart.
   */
  adherence: Adherence;
  activities: Activity[];
  /** Meetings with this student, soonest first. Includes cancelled ones. */
  meetings: Meeting[];
}

export async function getStudentDetail(usn: string): Promise<StudentDetailData | null> {
  const db = getDb();
  const student = await getStudent(db, usn);
  if (!student) return null;

  const [snapshot, history, report, interventions, calls, tasks, rules, records, parent] =
    await Promise.all([
      getLatestSnapshot(db, usn),
      getSnapshotHistory(db, usn, 20),
      getLatestReport(db, usn),
      listInterventions(db, { usn }),
      listCalls(db, usn),
      listTasks(db, usn),
      getRiskRules(db),
      getRecords(db, usn),
      getParentContact(db, usn),
    ]);

  const [account, plan, activities, meetings] = await Promise.all([
    getStudentAccount(usn, student.authUid),
    getActivePlan(db, usn),
    listActivities(db, usn),
    listMeetings(db, usn),
  ]);

  return {
    student,
    snapshot,
    history,
    report,
    // A report explains one snapshot. If a newer snapshot exists, the report
    // is describing numbers that have moved — say so rather than mislead.
    reportIsStale: Boolean(report && snapshot && report.snapshotId !== snapshot.snapshotId),
    interventions,
    calls,
    tasks,
    rules,
    projection: projectRisk(history, rules),
    recordCount: records.length,
    parent,
    account,
    plan,
    adherence: computeAdherence(tasks, new Date().toISOString().slice(0, 10)),
    activities,
    meetings,
  };
}

/**
 * Settles any completed intervention that is still waiting on a verdict.
 *
 * Called after an upload creates new snapshots. Separated from the upload
 * itself so that re-running it is harmless: `resolveInterventionOutcome`
 * refuses to score an already-resolved intervention or one whose snapshot
 * predates completion.
 */
export async function settleOutcomes(usns: string[]): Promise<number> {
  const db = getDb();
  let settled = 0;

  for (const usn of usns) {
    const [snapshot, interventions] = await Promise.all([
      getLatestSnapshot(db, usn),
      listInterventions(db, { usn }),
    ]);
    if (!snapshot) continue;

    const resolved = resolveAllOutcomes(interventions, snapshot);
    if (resolved.length > 0) {
      await applyOutcomes(db, resolved);
      settled += resolved.length;
    }
  }

  return settled;
}

export { saveSnapshots };
