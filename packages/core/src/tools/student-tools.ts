import { z } from 'zod';
import {
  ActivitySchema,
  CodingBriefSchema,
  IndicatorKeySchema,
  MilestoneSchema,
  QuizQuestionSchema,
  TaskKindSchema,
  computeAdherence,
  type Activity,
  type StudentTask,
  type StudyPlan,
} from '../schemas/index';
import { getLatestSnapshot, getRecords } from '../repositories/academics';
import { getStudent } from '../repositories/students';
import { listTasks } from '../repositories/workflow';
import {
  createPlanTasks,
  getActivePlan,
  listActivities,
  saveActivity,
  saveStudyPlan,
} from '../repositories/plans';
import { getRiskRules } from '../repositories/config';
import { listMeetings } from '../repositories/meetings';
import type { ToolContext, ToolDefinition } from './types';

/**
 * Tools for Planly, the student's study planner.
 *
 * THE IMPORTANT THING ABOUT THIS FILE: none of these tools takes a `usn`
 * argument. The student is read from `ctx.actor.usn`, which the server sets
 * from a verified ID token. Planly running for one student therefore has no
 * way to express a request for another student's data — not a rule it is asked
 * to follow, but a parameter that does not exist.
 */

function scopedUsn(ctx: ToolContext): string {
  const usn = ctx.actor.usn;
  if (!usn) {
    throw new Error(
      'This tool only works on behalf of a signed-in student, and no student is in scope.',
    );
  }
  return usn;
}

function nowIso(ctx: ToolContext): string {
  return (ctx.now?.() ?? new Date()).toISOString();
}

function today(ctx: ToolContext): string {
  return nowIso(ctx).slice(0, 10);
}

// ─────────────────────────────────────────────────────────────────────────────

const getMyProgress: ToolDefinition<Record<string, never>, unknown> = {
  name: 'get_my_progress',
  title: 'Get my progress',
  description:
    'Return everything about the student you are helping: their current risk snapshot with ' +
    'every indicator and its threshold, their subjects, their current plan if any, how many ' +
    'planned tasks they have actually completed, and their streak. Call this first, every ' +
    'session — you have no memory of this student between conversations and must not rely on ' +
    'numbers you think you remember.',
  inputSchema: z.object({}),
  consequential: false,
  readOnly: true,
  async handler(_input, ctx) {
    const usn = scopedUsn(ctx);

    const [student, snapshot, rules, tasks, plan, records] = await Promise.all([
      getStudent(ctx.db, usn),
      getLatestSnapshot(ctx.db, usn),
      getRiskRules(ctx.db),
      listTasks(ctx.db, usn),
      getActivePlan(ctx.db, usn),
      getRecords(ctx.db, usn),
    ]);

    if (!student) throw new Error('Student record not found.');

    const subjects = [...new Set(records.map((r) => r.subject))].sort();
    const adherence = computeAdherence(tasks, today(ctx));

    return {
      firstName: student.name.split(/\s+/)[0] ?? student.name,
      semester: student.semester,
      department: student.department,
      subjects,
      today: today(ctx),

      snapshot: snapshot && {
        snapshotId: snapshot.snapshotId,
        score: snapshot.score,
        level: snapshot.level,
        scoreDirection: 'Higher means more risk. You cannot change this number directly.',
        academicComposite: snapshot.academicComposite,
        insufficientData: snapshot.insufficientData,
        dataGaps: snapshot.dataGaps,
        conflicts: snapshot.conflicts,
        indicators: Object.values(snapshot.indicators).map((indicator) => ({
          ...indicator,
          threshold: rules.indicators[indicator.key]?.threshold,
          criticalAt: rules.indicators[indicator.key]?.criticalAt,
        })),
      },

      plan: plan && {
        planId: plan.planId,
        goal: plan.goal,
        focus: plan.focus,
        weeks: plan.weeks,
        milestones: plan.milestones,
        createdAt: plan.createdAt,
      },

      // Effort, reported separately from the score on purpose.
      adherence,
      openTasks: tasks
        .filter((task) => !task.done)
        .map((task) => ({
          taskId: task.taskId,
          title: task.title,
          kind: task.kind,
          scheduledFor: task.scheduledFor,
        })),
    };
  },
};

const saveStudyPlanTool: ToolDefinition<
  {
    goal: string;
    rationale: string;
    focus: string[];
    weeks: number;
    milestones: { title: string; target: string; byDate: string }[];
  },
  { planId: string }
> = {
  name: 'save_study_plan',
  title: 'Save study plan',
  description:
    'Store the improvement plan you have agreed with the student. The goal must be in their ' +
    'own terms and the rationale must quote their real figures. Pick at most three indicators ' +
    'to focus on — a plan that tries to fix everything fixes nothing. Saving a new plan ' +
    'retires the previous one. This does NOT change their risk score.',
  inputSchema: z.object({
    goal: z.string().trim().min(10).max(400),
    rationale: z.string().trim().min(20).max(1200),
    focus: z.array(IndicatorKeySchema).min(1).max(3),
    weeks: z.number().int().min(1).max(8),
    milestones: z.array(MilestoneSchema).max(6),
  }),
  consequential: false,
  readOnly: false,
  async handler(input, ctx) {
    const usn = scopedUsn(ctx);
    const snapshot = await getLatestSnapshot(ctx.db, usn);
    if (!snapshot) {
      throw new Error('There is no risk snapshot yet, so there is nothing to plan against.');
    }

    const planId = `plan_${usn}_${Date.now().toString(36)}`;
    const plan: StudyPlan = {
      planId,
      usn,
      snapshotId: snapshot.snapshotId,
      goal: input.goal,
      rationale: input.rationale,
      focus: input.focus as StudyPlan['focus'],
      weeks: input.weeks,
      milestones: input.milestones,
      status: 'active',
      model: process.env.ANTHROPIC_MODEL ?? 'unknown',
      createdAt: nowIso(ctx),
    };

    await saveStudyPlan(ctx.db, plan);
    return { planId };
  },
};

const createPlanTasksTool: ToolDefinition<
  {
    planId: string;
    tasks: {
      title: string;
      description?: string;
      kind: string;
      scheduledFor: string;
      minutes?: number;
    }[];
  },
  { created: number }
> = {
  name: 'create_plan_tasks',
  title: 'Schedule plan tasks',
  description:
    'Put tasks on specific days of the student\'s calendar. Each task must be finishable on ' +
    'the day it is scheduled and checkable — "Attend both DBMS classes" not "focus on DBMS". ' +
    'Keep a day under about 90 minutes total; a plan a student abandons on day three is worse ' +
    'than a smaller one they keep. Spread work across days rather than stacking it.',
  inputSchema: z.object({
    planId: z.string().min(1),
    tasks: z
      .array(
        z.object({
          title: z.string().trim().min(5).max(160),
          description: z.string().max(800).optional(),
          kind: TaskKindSchema,
          scheduledFor: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          minutes: z.number().int().min(5).max(240).optional(),
        }),
      )
      .min(1)
      .max(21),
  }),
  consequential: false,
  readOnly: false,
  async handler(input, ctx) {
    const usn = scopedUsn(ctx);
    const stamp = Date.now().toString(36);

    const tasks: StudentTask[] = input.tasks.map((task, index) => ({
      taskId: `ptask_${usn}_${stamp}_${index}`,
      usn,
      interventionId: null,
      planId: input.planId,
      title: task.title,
      description: task.description,
      kind: task.kind as StudentTask['kind'],
      scheduledFor: task.scheduledFor,
      minutes: task.minutes ?? null,
      activityId: null,
      dueDate: task.scheduledFor,
      done: false,
      doneAt: null,
      createdAt: nowIso(ctx),
    }));

    const created = await createPlanTasks(ctx.db, tasks);
    return { created };
  },
};

const createActivityTool: ToolDefinition<
  {
    kind: 'quiz' | 'coding';
    subject: string;
    title: string;
    reason: string;
    planId?: string;
    scheduledFor?: string;
    questions?: unknown[];
    coding?: unknown;
  },
  { activityId: string }
> = {
  name: 'create_activity',
  title: 'Create a practice activity',
  description:
    'Build a short practice quiz or a coding exercise for one of the student\'s actual ' +
    'subjects, and put it on their calendar. Use their real subject names. A quiz needs 3-8 ' +
    'questions with an explanation for each — the explanation is the point, a quiz that only ' +
    'scores teaches nothing. A coding exercise needs a brief and checkable acceptance ' +
    'criteria. Only set coding work for students in a computing branch.',
  inputSchema: z
    .object({
      kind: z.enum(['quiz', 'coding']),
      subject: z.string().trim().min(1).max(120),
      title: z.string().trim().min(5).max(160),
      reason: z.string().trim().min(10).max(400),
      planId: z.string().min(1).optional(),
      scheduledFor: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      questions: z.array(QuizQuestionSchema).min(3).max(8).optional(),
      coding: CodingBriefSchema.optional(),
    })
    .refine((v) => (v.kind === 'quiz' ? Boolean(v.questions) : Boolean(v.coding)), {
      message: 'A quiz needs `questions`; a coding activity needs `coding`.',
    }),
  consequential: false,
  readOnly: false,
  async handler(input, ctx) {
    const usn = scopedUsn(ctx);
    const activityId = `act_${usn}_${Date.now().toString(36)}`;

    const activity: Activity = ActivitySchema.parse({
      activityId,
      usn,
      planId: input.planId ?? null,
      kind: input.kind,
      subject: input.subject,
      title: input.title,
      reason: input.reason,
      questions: input.questions,
      coding: input.coding,
      status: 'ready',
      score: null,
      outOf: null,
      attemptedAt: null,
      model: process.env.ANTHROPIC_MODEL ?? 'unknown',
      createdAt: nowIso(ctx),
    });

    await saveActivity(ctx.db, activity);

    // A task is what puts the activity on the calendar — an activity nobody
    // is prompted to open is an activity nobody opens.
    if (input.scheduledFor) {
      await createPlanTasks(ctx.db, [
        {
          taskId: `ptask_${activityId}`,
          usn,
          interventionId: null,
          planId: input.planId ?? null,
          title: input.title,
          description: input.reason,
          kind: input.kind,
          scheduledFor: input.scheduledFor,
          minutes: input.kind === 'quiz' ? 15 : 45,
          activityId,
          dueDate: input.scheduledFor,
          done: false,
          doneAt: null,
          createdAt: nowIso(ctx),
        },
      ]);
    }

    return { activityId };
  },
};

const listMyActivities: ToolDefinition<Record<string, never>, unknown> = {
  name: 'list_my_activities',
  title: 'List my activities',
  description:
    'Return the practice activities this student already has, with their scores. Use it to ' +
    'avoid setting the same thing twice, and to see what they found hard.',
  inputSchema: z.object({}),
  consequential: false,
  readOnly: true,
  async handler(_input, ctx) {
    const usn = scopedUsn(ctx);
    const activities = await listActivities(ctx.db, usn);
    return {
      activities: activities.map((activity) => ({
        activityId: activity.activityId,
        kind: activity.kind,
        subject: activity.subject,
        title: activity.title,
        status: activity.status,
        score: activity.score,
        outOf: activity.outOf,
        createdAt: activity.createdAt,
      })),
    };
  },
};

/**
 * The student's side of the meeting feature.
 *
 * Takes no `usn`, like everything else here, so Planly can tell a student when
 * their mentor is seeing them without being able to ask about anyone else's
 * calendar. Returns the join link, because the student is an invitee: a
 * meeting they cannot join is not a meeting.
 */
const listMyMeetings: ToolDefinition<Record<string, never>, unknown> = {
  name: 'list_my_meetings',
  title: 'List my meetings',
  description:
    'Your meetings with your mentor, soonest first, with the join link for each. Check ' +
    'this before planning a day so you do not schedule study over a meeting, and mention ' +
    'an upcoming one if it is relevant to what the student is asking about.',
  inputSchema: z.object({}),
  consequential: false,
  readOnly: true,
  async handler(_input, ctx) {
    const meetings = await listMeetings(ctx.db, scopedUsn(ctx));
    const now = ctx.now?.() ?? new Date();

    return {
      meetings: meetings
        .filter((m) => m.status !== 'proposed')
        .map((m) => ({
          title: m.title,
          agenda: m.agenda ?? null,
          startsAt: m.startsAt,
          endsAt: m.endsAt,
          status: m.status,
          joinUrl: m.joinUrl,
          isUpcoming: m.status === 'scheduled' && new Date(m.endsAt) > now,
        })),
    };
  },
};

export const STUDENT_TOOLS = {
  get_my_progress: getMyProgress,
  save_study_plan: saveStudyPlanTool,
  create_plan_tasks: createPlanTasksTool,
  create_activity: createActivityTool,
  list_my_activities: listMyActivities,
  list_my_meetings: listMyMeetings,
} satisfies Record<string, ToolDefinition<any, any>>;
