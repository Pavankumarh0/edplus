import { z } from 'zod';
import { IndicatorKeySchema, IsoDateSchema, IsoDateTimeSchema, UsnSchema } from './common';

/**
 * Planly — the student's own study planner.
 *
 * A plan turns a risk snapshot into something a student can actually do this
 * week. It never touches the risk score: the score is computed from academic
 * records by a deterministic engine, and a plan is a set of intentions.
 * Completing tasks raises attendance and marks, and THOSE move the score at
 * the next upload. Letting adherence feed the score directly would mean a
 * student could improve their standing without improving anything real.
 */

export const PLAN_HORIZONS = [1, 2, 4] as const;

export const MilestoneSchema = z.object({
  title: z.string().trim().min(1).max(160),
  /** What success looks like, in the student's own numbers. */
  target: z.string().trim().min(1).max(200),
  byDate: IsoDateSchema,
});

export type Milestone = z.infer<typeof MilestoneSchema>;

export const StudyPlanSchema = z.object({
  planId: z.string().trim().min(1),
  usn: UsnSchema,

  /** The snapshot this plan was built from. A plan explains a moment. */
  snapshotId: z.string().trim().min(1),

  /** One sentence the student would recognise as their own goal. */
  goal: z.string().trim().min(1).max(400),
  /** Why this plan, citing the real figures. */
  rationale: z.string().trim().min(1).max(1200),
  /** Which indicators this plan is trying to move, most important first. */
  focus: z.array(IndicatorKeySchema).min(1).max(3),

  weeks: z.number().int().min(1).max(8),
  milestones: z.array(MilestoneSchema).max(6),

  /** Superseded when a newer plan is generated, never deleted — the history
   *  of what was tried matters as much as what is current. */
  status: z.enum(['active', 'superseded']).default('active'),

  model: z.string().min(1),
  createdAt: IsoDateTimeSchema,
});

export type StudyPlan = z.infer<typeof StudyPlanSchema>;

/**
 * What a planned task is for. Drives the icon and grouping in the app, and
 * lets faculty see at a glance whether a student is skipping one kind of work.
 */
export const TASK_KINDS = [
  'attend',
  'submit',
  'study',
  'practice',
  'quiz',
  'coding',
  'meet',
] as const;
export const TaskKindSchema = z.enum(TASK_KINDS);
export type TaskKind = z.infer<typeof TaskKindSchema>;

export const TASK_KIND_LABELS: Record<TaskKind, string> = {
  attend: 'Attend',
  submit: 'Submit',
  study: 'Study',
  practice: 'Practice',
  quiz: 'Quiz',
  coding: 'Coding',
  meet: 'Meet',
};

// ─────────────────────────────────────────────────────────────────────────────
// Activities — generated practice, not busywork
// ─────────────────────────────────────────────────────────────────────────────

export const QuizQuestionSchema = z.object({
  question: z.string().trim().min(1).max(600),
  options: z.array(z.string().trim().min(1).max(300)).min(2).max(5),
  /** Index into `options`. */
  answerIndex: z.number().int().min(0).max(4),
  /** Shown after answering, right or wrong. The explanation is the point —
   *  a quiz that only scores is a test, not practice. */
  explanation: z.string().trim().min(1).max(600),
});

export type QuizQuestion = z.infer<typeof QuizQuestionSchema>;

export const CodingBriefSchema = z.object({
  /** What to build, in plain words. */
  brief: z.string().trim().min(1).max(1200),
  language: z.string().trim().min(1).max(40),
  starterCode: z.string().max(4000).optional(),
  /** Checkable, so the student knows when they are done. */
  acceptance: z.array(z.string().trim().min(1).max(300)).min(1).max(6),
  hints: z.array(z.string().trim().min(1).max(400)).max(4),
});

export type CodingBrief = z.infer<typeof CodingBriefSchema>;

export const ACTIVITY_KINDS = ['quiz', 'coding'] as const;
export const ActivityKindSchema = z.enum(ACTIVITY_KINDS);
export type ActivityKind = z.infer<typeof ActivityKindSchema>;

export const ActivitySchema = z.object({
  activityId: z.string().trim().min(1),
  usn: UsnSchema,
  planId: z.string().trim().min(1).nullable().default(null),

  kind: ActivityKindSchema,
  subject: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(160),
  /** Why this student is being given this, in one line. */
  reason: z.string().trim().min(1).max(400),

  /** Exactly one of these is set, matching `kind`. */
  questions: z.array(QuizQuestionSchema).max(10).optional(),
  coding: CodingBriefSchema.optional(),

  status: z.enum(['ready', 'attempted', 'completed']).default('ready'),
  /** Correct answers, for a quiz. Null until attempted. */
  score: z.number().int().min(0).nullable().default(null),
  outOf: z.number().int().min(0).nullable().default(null),
  attemptedAt: IsoDateTimeSchema.nullable().default(null),

  model: z.string().min(1),
  createdAt: IsoDateTimeSchema,
});

export type Activity = z.infer<typeof ActivitySchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Adherence — effort, reported beside the score and never inside it
// ─────────────────────────────────────────────────────────────────────────────

export interface Adherence {
  /** Tasks scheduled on or before today. */
  due: number;
  done: number;
  /** 0–1. Null when nothing has been scheduled yet. */
  rate: number | null;
  /** Consecutive days, ending today, where every scheduled task was done. */
  streak: number;
  /** Scheduled before today and still not done. */
  overdue: number;
}

/**
 * Measures whether a student is actually doing the plan.
 *
 * Deliberately returns effort, not a score adjustment. Faculty read this
 * next to the risk level: a student who is At Risk but at 90% adherence needs
 * encouragement and time, while the same student at 10% needs a different
 * conversation — and the risk score alone cannot tell those apart.
 */
export function computeAdherence(
  tasks: { scheduledFor?: string | null; dueDate?: string; done: boolean }[],
  today: string,
): Adherence {
  const dated = tasks
    .map((task) => ({ on: task.scheduledFor ?? task.dueDate ?? null, done: task.done }))
    .filter((task): task is { on: string; done: boolean } => task.on !== null);

  const due = dated.filter((task) => task.on <= today);
  const done = due.filter((task) => task.done);
  const overdue = due.filter((task) => !task.done && task.on < today);

  // Walk back day by day. A day with nothing scheduled does not break a
  // streak — a student cannot be penalised for a day the plan left empty.
  let streak = 0;
  const cursor = new Date(`${today}T00:00:00.000Z`);
  for (let i = 0; i < 60; i += 1) {
    const day = cursor.toISOString().slice(0, 10);
    const onDay = dated.filter((task) => task.on === day);
    if (onDay.length > 0) {
      if (!onDay.every((task) => task.done)) break;
      streak += 1;
    }
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  return {
    due: due.length,
    done: done.length,
    rate: due.length === 0 ? null : Math.round((done.length / due.length) * 100) / 100,
    streak,
    overdue: overdue.length,
  };
}
