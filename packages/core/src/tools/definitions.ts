import { z } from 'zod';
import {
  CallContextSchema,
  InterventionTypeSchema,
  ParentResponseSchema,
  ReportBodySchema,
  UsnSchema,
  canTransition,
  classifyOutcome,
  type CallContext,
  type Intervention,
  type InterventionStatus,
  type RiskSnapshot,
  type StudentReport,
  type StudentTask,
} from '../schemas/index';
import {
  getLatestReport,
  getLatestSnapshot,
  getLatestSnapshotsForAll,
  getSnapshotHistory,
  saveReport,
} from '../repositories/academics';
import { getParentContact, getStudent, listStudents } from '../repositories/students';
import {
  createCall,
  createIntervention,
  createTasks,
  getIntervention,
  listCalls,
  listInterventions,
  updateCall,
  updateInterventionStatus,
  usnsWithOpenInterventions,
} from '../repositories/workflow';
import { getRiskRules } from '../repositories/config';
import { prioritise, type PrioritisableStudent } from '../risk/prioritise';
import { projectRisk } from '../risk/project';
import type { ToolDefinition } from './types';

const COLLEGE_NAME = process.env.COLLEGE_NAME ?? 'the college';

function nowIso(ctx: { now?: () => Date }): string {
  return (ctx.now?.() ?? new Date()).toISOString();
}

function notFound(usn: string): never {
  throw new Error(`No student with USN ${usn}. Check the USN, or import their records first.`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Read tools
// ─────────────────────────────────────────────────────────────────────────────

const getStudentTool: ToolDefinition<{ usn: string }, unknown> = {
  name: 'get_student',
  title: 'Get student',
  description:
    'Look up one student by USN and return their details alongside their current risk ' +
    'snapshot: score (0-100, higher means more risk), level, every indicator with its ' +
    'measured value and plain-language reason, confidence, data gaps and conflicts. ' +
    'Use this before saying anything specific about a student. ' +
    'Never returns parent contact details.',
  inputSchema: z.object({ usn: UsnSchema }),
  consequential: false,
  readOnly: true,
  async handler({ usn }, ctx) {
    const student = await getStudent(ctx.db, usn);
    if (!student) notFound(usn);
    const snapshot = await getLatestSnapshot(ctx.db, usn);
    const report = await getLatestReport(ctx.db, usn);
    return {
      student,
      snapshot,
      hasReport: Boolean(report),
      reportIsForCurrentSnapshot: report ? report.snapshotId === snapshot?.snapshotId : false,
    };
  },
};

const getStudentHistoryTool: ToolDefinition<{ usn: string; limit?: number }, unknown> = {
  name: 'get_student_history',
  title: 'Get student history',
  description:
    'Return a student\'s risk snapshots over time, newest first, plus their interventions ' +
    'and the before/after outcome of each completed one. Use this to answer whether a ' +
    'student is improving and whether a past intervention worked. A negative scoreDelta ' +
    'means the risk score fell, which is good news.',
  inputSchema: z.object({ usn: UsnSchema, limit: z.number().int().min(1).max(50).optional() }),
  consequential: false,
  readOnly: true,
  async handler({ usn, limit }, ctx) {
    const student = await getStudent(ctx.db, usn);
    if (!student) notFound(usn);
    const snapshots = await getSnapshotHistory(ctx.db, usn, limit ?? 20);
    const interventions = await listInterventions(ctx.db, { usn });
    const rules = await getRiskRules(ctx.db);
    return {
      usn,
      snapshots,
      interventions,
      projection: projectRisk(snapshots, rules),
    };
  },
};

const listAtRiskTool: ToolDefinition<
  { limit?: number; minLevel?: string; onlyUnattended?: boolean },
  unknown
> = {
  name: 'list_at_risk_students',
  title: 'List at-risk students',
  description:
    'Return students who need attention, already prioritised: by risk level, then score, ' +
    'then worsening trend, then whether anyone is already working with them. Use this for ' +
    '"who needs attention today?". Set onlyUnattended to true to exclude students who ' +
    'already have an open intervention. Students flagged insufficientData are included and ' +
    'marked — they need data entry, not an intervention.',
  inputSchema: z.object({
    limit: z.number().int().min(1).max(100).optional(),
    minLevel: z.enum(['stable', 'watch', 'at_risk', 'critical']).optional(),
    onlyUnattended: z.boolean().optional(),
  }),
  consequential: false,
  readOnly: true,
  async handler({ limit, minLevel, onlyUnattended }, ctx) {
    const students = await listStudents(ctx.db);
    const snapshots = await getLatestSnapshotsForAll(
      ctx.db,
      students.map((s) => s.usn),
    );
    const open = await usnsWithOpenInterventions(ctx.db);

    const rank = ['stable', 'watch', 'at_risk', 'critical'];
    const floor = minLevel ? rank.indexOf(minLevel) : 0;

    // Built in steps so the null filter narrows before the type annotation
    // applies — students with no snapshot yet are simply not rankable.
    const candidates = students.map((student): PrioritisableStudent | null => {
      const snapshot = snapshots.get(student.usn);
      if (!snapshot) return null;
      return {
        usn: student.usn,
        name: student.name,
        snapshot,
        hasOpenIntervention: open.has(student.usn),
      };
    });

    const rows: PrioritisableStudent[] = candidates
      .filter((row): row is PrioritisableStudent => row !== null)
      .filter((row) => rank.indexOf(row.snapshot.level) >= floor)
      .filter((row) => (onlyUnattended ? !row.hasOpenIntervention : true));

    return {
      total: rows.length,
      students: prioritise(rows)
        .slice(0, limit ?? 20)
        .map((row, index) => ({
          rank: index + 1,
          usn: row.usn,
          name: row.name,
          score: row.snapshot.score,
          level: row.snapshot.level,
          scoreDelta: row.snapshot.scoreDelta,
          confidence: row.snapshot.confidence,
          insufficientData: row.snapshot.insufficientData,
          dataGaps: row.snapshot.dataGaps.length,
          conflicts: row.snapshot.conflicts.length,
          escalated: row.snapshot.escalation !== null,
          hasOpenIntervention: row.hasOpenIntervention,
        })),
    };
  },
};

const getRiskBreakdownTool: ToolDefinition<{ usn: string }, unknown> = {
  name: 'get_risk_breakdown',
  title: 'Get risk breakdown',
  description:
    'Explain exactly how one student\'s risk score was produced: the rules in force, each ' +
    'indicator\'s measured value, its sub-score, the weight applied, and the threshold it ' +
    'was compared against. Use this to answer "why is this student at risk?" with real ' +
    'numbers. You must not recalculate or adjust the score — it is computed by a ' +
    'deterministic engine and your job is to explain it, not to second-guess it.',
  inputSchema: z.object({ usn: UsnSchema }),
  consequential: false,
  readOnly: true,
  async handler({ usn }, ctx) {
    const snapshot = await getLatestSnapshot(ctx.db, usn);
    if (!snapshot) throw new Error(`No risk snapshot for ${usn}. Import their records first.`);
    const rules = await getRiskRules(ctx.db);

    return {
      usn,
      score: snapshot.score,
      level: snapshot.level,
      scoreDirection: 'Higher means more risk. 0 is no risk.',
      academicComposite: snapshot.academicComposite,
      academicCompositeDirection: 'Higher means healthier. The opposite of score.',
      confidence: snapshot.confidence,
      rulesVersion: snapshot.rulesVersion,
      insufficientData: snapshot.insufficientData,
      dataGaps: snapshot.dataGaps,
      conflicts: snapshot.conflicts,
      escalation: snapshot.escalation,
      indicators: Object.values(snapshot.indicators).map((indicator) => ({
        ...indicator,
        threshold: rules.indicators[indicator.key]?.threshold,
        criticalAt: rules.indicators[indicator.key]?.criticalAt,
      })),
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Write tools — agents may reach these
// ─────────────────────────────────────────────────────────────────────────────

const saveReportTool: ToolDefinition<
  { usn: string; snapshotId: string; body: unknown; rendered: string; model: string },
  { reportId: string }
> = {
  name: 'save_report',
  title: 'Save report',
  description:
    'Store a written report for a student against the snapshot it explains. The report must ' +
    'quote the real numbers from that snapshot, state plainly what is wrong and what to do ' +
    'next, address the student respectfully, and explain any data gaps or conflicting ' +
    'indicators. Do not include vague praise. Do not restate or alter the risk score.',
  inputSchema: z.object({
    usn: UsnSchema,
    snapshotId: z.string().min(1),
    body: ReportBodySchema,
    rendered: z.string().min(1),
    model: z.string().min(1),
  }),
  consequential: false,
  readOnly: false,
  async handler(input, ctx) {
    const snapshot = await getLatestSnapshot(ctx.db, input.usn);
    if (!snapshot) throw new Error(`No snapshot for ${input.usn}.`);
    // A report must explain a real snapshot, not a remembered one.
    if (snapshot.snapshotId !== input.snapshotId) {
      throw new Error(
        `Snapshot ${input.snapshotId} is not the current snapshot for ${input.usn} ` +
          `(current is ${snapshot.snapshotId}). Re-read the student before writing a report.`,
      );
    }

    const reportId = `${input.usn}__${snapshot.snapshotId}`;
    const report: StudentReport = {
      reportId,
      usn: input.usn,
      snapshotId: input.snapshotId,
      body: ReportBodySchema.parse(input.body),
      rendered: input.rendered,
      model: input.model,
      createdAt: nowIso(ctx),
    };
    await saveReport(ctx.db, report);
    return { reportId };
  },
};

const proposeInterventionTool: ToolDefinition<
  { usn: string; type: string; reason: string; dueDate?: string },
  { interventionId: string; status: InterventionStatus }
> = {
  name: 'propose_intervention',
  title: 'Propose intervention',
  description:
    'Propose a support action for a student. The proposal is recorded with status ' +
    '"proposed" and does nothing until a faculty member approves it in the dashboard — ' +
    'you cannot approve it and must not tell anyone the action is happening. Give a reason ' +
    'that cites the specific numbers justifying it.',
  inputSchema: z.object({
    usn: UsnSchema,
    type: InterventionTypeSchema,
    reason: z.string().trim().min(10).max(2000),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }),
  consequential: false,
  readOnly: false,
  async handler(input, ctx) {
    const snapshot = await getLatestSnapshot(ctx.db, input.usn);
    if (!snapshot) throw new Error(`No snapshot for ${input.usn}; cannot set a baseline.`);

    const interventionId = `iv_${input.usn}_${Date.now().toString(36)}`;
    const intervention: Intervention = {
      interventionId,
      usn: input.usn,
      type: input.type as Intervention['type'],
      reason: input.reason,
      // The only status an agent can create. Everything past this is a human.
      status: 'proposed',
      dueDate: input.dueDate,
      // Frozen now, so the later before/after comparison is honest.
      baselineSnapshotId: snapshot.snapshotId,
      baselineScore: snapshot.score,
      outcomeSnapshotId: null,
      outcomeScore: null,
      outcome: null,
      proposedBy: ctx.actor.agentName ?? ctx.actor.id,
      createdAt: nowIso(ctx),
    };
    await createIntervention(ctx.db, intervention);
    return { interventionId, status: 'proposed' };
  },
};

const updateInterventionTool: ToolDefinition<
  { interventionId: string; status: string; notes?: string },
  unknown
> = {
  name: 'update_intervention',
  title: 'Update intervention',
  description:
    'Move an intervention along its lifecycle: proposed to approved, approved to ' +
    'in_progress, in_progress to completed, or cancel it. Illegal jumps are refused. ' +
    'Completing an intervention does not decide whether it worked — that is determined ' +
    'automatically by comparing the next risk snapshot against the frozen baseline.',
  inputSchema: z.object({
    interventionId: z.string().min(1),
    status: z.enum(['proposed', 'approved', 'in_progress', 'completed', 'cancelled']),
    notes: z.string().max(4000).optional(),
  }),
  consequential: false,
  readOnly: false,
  async handler(input, ctx) {
    const existing = await getIntervention(ctx.db, input.interventionId);
    if (!existing) throw new Error(`No intervention ${input.interventionId}.`);

    const next = input.status as InterventionStatus;
    if (existing.status !== next && !canTransition(existing.status, next)) {
      throw new Error(
        `Cannot move from "${existing.status}" to "${next}". ` +
          'Allowed: proposed→approved/cancelled, approved→in_progress/cancelled, ' +
          'in_progress→completed/cancelled.',
      );
    }

    const updated = await updateInterventionStatus(ctx.db, input.interventionId, next, {
      notes: input.notes,
    });
    return { interventionId: updated.interventionId, status: updated.status };
  },
};

const createStudentTasksTool: ToolDefinition<
  { usn: string; interventionId?: string; tasks: { title: string; description?: string; dueDate?: string }[] },
  { created: number }
> = {
  name: 'create_student_tasks',
  title: 'Create student tasks',
  description:
    'Create small, concrete recovery tasks that appear in the student\'s own app. Write them ' +
    'addressed to the student, each one checkable in a week or less — "Attend all six DBMS ' +
    'classes this week", not "improve attendance". These are the student-facing form of an ' +
    'intervention, so the wording must be encouraging and never shaming.',
  inputSchema: z.object({
    usn: UsnSchema,
    interventionId: z.string().min(1).optional(),
    tasks: z
      .array(
        z.object({
          title: z.string().trim().min(5).max(160),
          description: z.string().max(800).optional(),
          dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        }),
      )
      .min(1)
      .max(6),
  }),
  consequential: false,
  readOnly: false,
  async handler(input, ctx) {
    const student = await getStudent(ctx.db, input.usn);
    if (!student) notFound(input.usn);

    const stamp = Date.now().toString(36);
    const tasks: StudentTask[] = input.tasks.map((task, index) => ({
      taskId: `task_${input.usn}_${stamp}_${index}`,
      usn: input.usn,
      interventionId: input.interventionId ?? null,
      title: task.title,
      description: task.description,
      dueDate: task.dueDate,
      done: false,
      doneAt: null,
      createdAt: nowIso(ctx),
    }));
    const created = await createTasks(ctx.db, tasks);
    return { created };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Voice tools
// ─────────────────────────────────────────────────────────────────────────────

const getCallContextTool: ToolDefinition<{ callId: string }, CallContext> = {
  name: 'get_call_context',
  title: 'Get call context',
  description:
    'Return the minimum information needed to speak to a parent on one approved call: the ' +
    'student\'s first name, the parent\'s name, the language to speak, the purpose, and the ' +
    'exact approved message. It deliberately does not include marks, the risk score or the ' +
    'report. Say what the approved message says and nothing beyond it.',
  inputSchema: z.object({ callId: z.string().min(1) }),
  consequential: false,
  readOnly: true,
  async handler({ callId }, ctx) {
    const calls = await listCalls(ctx.db);
    const call = calls.find((c) => c.callId === callId);
    if (!call) throw new Error(`No call ${callId}.`);
    if (!call.approvedBy) {
      throw new Error(`Call ${callId} has not been approved by a faculty member.`);
    }

    const student = await getStudent(ctx.db, call.usn);
    if (!student) notFound(call.usn);
    const parent = await getParentContact(ctx.db, call.usn);
    const snapshot = await getLatestSnapshot(ctx.db, call.usn);

    // A coarse band only. The numeric score never goes near a phone call.
    const riskBand =
      snapshot === null
        ? undefined
        : snapshot.scoreDelta !== null && snapshot.scoreDelta < -2
          ? ('improving' as const)
          : snapshot.level === 'stable'
            ? ('stable' as const)
            : ('needs_attention' as const);

    return CallContextSchema.parse({
      callId: call.callId,
      studentFirstName: student.name.split(/\s+/)[0] ?? student.name,
      parentName: parent?.name ?? 'Parent/Guardian',
      language: call.language,
      purpose: call.purpose,
      approvedMessage: call.approvedMessage,
      riskBand,
      mentorName: student.mentorId,
      collegeName: COLLEGE_NAME,
    });
  },
};

const logCallOutcomeTool: ToolDefinition<
  { callId: string; parentResponse: string; summary: string; note?: string },
  { callId: string }
> = {
  name: 'log_call_outcome',
  title: 'Log call outcome',
  description:
    'Record how a parent call ended: what the parent conveyed, and a short factual summary ' +
    'of the conversation. Use requested_callback when the parent asked to speak to a human. ' +
    'Do not record a commitment the parent did not actually make.',
  inputSchema: z.object({
    callId: z.string().min(1),
    parentResponse: ParentResponseSchema,
    summary: z.string().trim().min(5).max(2000),
    note: z.string().max(1000).optional(),
  }),
  consequential: false,
  readOnly: false,
  async handler(input, ctx) {
    await updateCall(ctx.db, input.callId, {
      parentResponse: input.parentResponse as never,
      parentResponseNote: input.note ?? null,
      summary: input.summary,
      status: 'completed',
      endedAt: nowIso(ctx),
    });
    return { callId: input.callId };
  },
};

/**
 * The one consequential tool. Placing a call to a parent cannot be undone, so
 * this is never in an agent's allowlist — the copilot proposes it and a faculty
 * member confirms, which is what actually creates the record.
 */
const scheduleParentCallTool: ToolDefinition<
  { usn: string; purpose: string; approvedMessage: string; language?: string; interventionId?: string },
  { callId: string; status: string }
> = {
  name: 'schedule_parent_call',
  title: 'Schedule parent call',
  description:
    'Queue an outbound call to a student\'s parent. Requires faculty approval and is not ' +
    'available to agents — an agent should instead tell the faculty member what it would say ' +
    'and let them press the button.',
  inputSchema: z.object({
    usn: UsnSchema,
    purpose: z.enum(['absence', 'ptm', 'risk_update']),
    approvedMessage: z.string().trim().min(10).max(2000),
    language: z.string().optional(),
    interventionId: z.string().min(1).optional(),
  }),
  consequential: true,
  readOnly: false,
  async handler(input, ctx) {
    if (ctx.actor.kind !== 'faculty') {
      throw new Error('Only a faculty member may schedule a parent call.');
    }
    const parent = await getParentContact(ctx.db, input.usn);
    if (!parent?.phone) {
      throw new Error(
        `No parent phone number on record for ${input.usn}. ` +
          'Only numbers stored on the student record may be called.',
      );
    }

    const callId = `call_${input.usn}_${Date.now().toString(36)}`;
    await createCall(ctx.db, {
      callId,
      usn: input.usn,
      purpose: input.purpose as never,
      language: (input.language as never) ?? parent.preferredLanguage,
      status: 'queued',
      provider: (process.env.TELEPHONY_PROVIDER === 'vobiz' ? 'vobiz' : 'simulated') as never,
      providerCallId: null,
      approvedMessage: input.approvedMessage,
      approvedBy: ctx.actor.id,
      transcript: [],
      summary: null,
      parentResponse: null,
      parentResponseNote: null,
      recordingUrl: null,
      failureReason: null,
      interventionId: input.interventionId ?? null,
      createdAt: nowIso(ctx),
      startedAt: null,
      endedAt: null,
    });
    return { callId, status: 'queued' };
  },
};

/** Every tool in the system, keyed by name. */
export const TOOLS: Record<string, ToolDefinition<any, any>> = {
  get_student: getStudentTool,
  get_student_history: getStudentHistoryTool,
  list_at_risk_students: listAtRiskTool,
  get_risk_breakdown: getRiskBreakdownTool,
  save_report: saveReportTool,
  propose_intervention: proposeInterventionTool,
  update_intervention: updateInterventionTool,
  create_student_tasks: createStudentTasksTool,
  get_call_context: getCallContextTool,
  log_call_outcome: logCallOutcomeTool,
  schedule_parent_call: scheduleParentCallTool,
};

export const TOOL_NAMES = Object.keys(TOOLS);
