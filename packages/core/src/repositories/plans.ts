import {
  ActivitySchema,
  StudentTaskSchema,
  StudyPlanSchema,
  type Activity,
  type StudentTask,
  type StudyPlan,
} from '../schemas/index';
import { commitAll, nowIso, type Firestore } from './firestore';

function studentRef(db: Firestore, usn: string) {
  return db.collection('students').doc(usn);
}

// ─────────────────────────────────────────────────────────────────────────────
// Study plans
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Saves a plan and retires the previous one.
 *
 * Old plans are marked `superseded` rather than deleted. What a student was
 * asked to do three weeks ago, and whether it worked, is the only way to tell
 * a plan that failed from a plan that was never tried.
 */
export async function saveStudyPlan(db: Firestore, plan: StudyPlan): Promise<void> {
  const plans = studentRef(db, plan.usn).collection('plans');

  const active = await plans.where('status', '==', 'active').get();
  const batch = db.batch();
  for (const doc of active.docs) {
    if (doc.id !== plan.planId) batch.set(doc.ref, { status: 'superseded' }, { merge: true });
  }
  batch.set(plans.doc(plan.planId), StudyPlanSchema.parse(plan));
  await batch.commit();
}

export async function getActivePlan(db: Firestore, usn: string): Promise<StudyPlan | null> {
  const snap = await studentRef(db, usn).collection('plans').where('status', '==', 'active').get();
  if (snap.empty) return null;

  // Newest first, sorted here rather than with orderBy — the combination of an
  // equality filter and a sort would otherwise need a composite index.
  const plans = snap.docs.map((d) => StudyPlanSchema.parse(d.data()));
  plans.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return plans[0] ?? null;
}

export async function listPlans(db: Firestore, usn: string): Promise<StudyPlan[]> {
  const snap = await studentRef(db, usn).collection('plans').get();
  return snap.docs
    .map((d) => StudyPlanSchema.parse(d.data()))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ─────────────────────────────────────────────────────────────────────────────
// Planned tasks
// ─────────────────────────────────────────────────────────────────────────────

export async function createPlanTasks(db: Firestore, tasks: StudentTask[]): Promise<number> {
  const timestamp = nowIso();
  return commitAll(db, tasks, (batch, task) => {
    batch.set(
      studentRef(db, task.usn).collection('tasks').doc(task.taskId),
      StudentTaskSchema.parse({ ...task, createdAt: task.createdAt ?? timestamp }),
      { merge: true },
    );
  });
}

/** Everything scheduled on one day, for the calendar. */
export async function tasksForDate(
  db: Firestore,
  usn: string,
  date: string,
): Promise<StudentTask[]> {
  const snap = await studentRef(db, usn).collection('tasks').get();
  return snap.docs
    .map((d) => StudentTaskSchema.parse(d.data()))
    .filter((task) => (task.scheduledFor ?? task.dueDate) === date)
    .sort((a, b) => a.title.localeCompare(b.title));
}

/** Marks a task done or undone. Used by the app and by Planly on request. */
export async function setTaskDone(
  db: Firestore,
  usn: string,
  taskId: string,
  done: boolean,
): Promise<void> {
  await studentRef(db, usn)
    .collection('tasks')
    .doc(taskId)
    .set({ done, doneAt: done ? nowIso() : null }, { merge: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// Activities
// ─────────────────────────────────────────────────────────────────────────────

export async function saveActivity(db: Firestore, activity: Activity): Promise<void> {
  await studentRef(db, activity.usn)
    .collection('activities')
    .doc(activity.activityId)
    .set(ActivitySchema.parse(activity));
}

export async function listActivities(db: Firestore, usn: string): Promise<Activity[]> {
  const snap = await studentRef(db, usn).collection('activities').get();
  return snap.docs
    .map((d) => ActivitySchema.parse(d.data()))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getActivity(
  db: Firestore,
  usn: string,
  activityId: string,
): Promise<Activity | null> {
  const snap = await studentRef(db, usn).collection('activities').doc(activityId).get();
  return snap.exists ? ActivitySchema.parse(snap.data()) : null;
}

/**
 * Records an attempt.
 *
 * The score is stored for the student's own feedback and is deliberately NOT
 * fed into the risk engine. A generated quiz is practice, not an assessment
 * the college set; treating it as evidence would let a student move their own
 * score by answering questions an AI wrote for them.
 */
export async function recordActivityAttempt(
  db: Firestore,
  usn: string,
  activityId: string,
  score: number,
  outOf: number,
): Promise<void> {
  await studentRef(db, usn)
    .collection('activities')
    .doc(activityId)
    .set(
      {
        status: 'completed',
        score,
        outOf,
        attemptedAt: nowIso(),
      },
      { merge: true },
    );
}
