import type { Actor } from '../schemas/index';
import { getConnectorSettings } from '../repositories/config';
import type { Firestore } from '../repositories/firestore';
import { TOOLS } from './definitions';
import type { AgentName, ToolDefinition } from './types';

/**
 * Per-agent allowlists.
 *
 * Each agent gets only what its job needs. This is not defence against a
 * malicious model so much as a guarantee about blast radius: the voice agent
 * physically cannot read a student's marks or write a report, so no prompt — however
 * it is phrased, by a parent on a live call or anyone else — can make it do so.
 *
 * `schedule_parent_call` and `schedule_meeting` appear in no list. Both are
 * consequential — one dials a real phone, the other books real time on a real
 * calendar — so a human creates them; the copilot's job is to draft the wording
 * or the slot and hand it over.
 */
export const AGENT_TOOLS: Record<AgentName, readonly string[]> = {
  /** Writes one honest report per student from their snapshot and history. */
  report: [
    'get_student',
    'get_student_history',
    'get_risk_breakdown',
    'save_report',
    'propose_intervention',
    'propose_meeting',
  ],

  /** Answers faculty questions from tools only, and drafts actions for approval. */
  copilot: [
    'get_student',
    'get_student_history',
    'list_at_risk_students',
    'get_risk_breakdown',
    'propose_intervention',
    'update_intervention',
    'create_student_tasks',
    'propose_meeting',
    'list_meetings',
    'list_connectors',
    'test_connector',
  ],

  /**
   * Speaks to a parent. Deliberately tiny: it can read the approved message
   * and record what the parent said. Nothing else.
   */
  voice: ['get_call_context', 'log_call_outcome'],

  /**
   * Planly — the student's study planner.
   *
   * Every tool here is student-scoped and takes no `usn`, so Planly is
   * confined to whoever it was launched for. It cannot list the cohort, read
   * another student, write a report, or reach anything a mentor controls:
   * it plans, schedules and sets practice, and that is all.
   */
  planly: [
    'get_my_progress',
    'save_study_plan',
    'create_plan_tasks',
    'create_activity',
    'list_my_activities',
    'list_my_meetings',
  ],
};

/** Faculty may use every non-consequential tool, plus the consequential ones. */
export function toolsForActor(actor: Actor): string[] {
  switch (actor.kind) {
    case 'faculty':
      return Object.keys(TOOLS);
    case 'agent': {
      const agent = actor.agentName as AgentName | undefined;
      return agent && agent in AGENT_TOOLS ? [...AGENT_TOOLS[agent]] : [];
    }
    case 'system':
      // Background jobs: everything except actions that need a human.
      return Object.values(TOOLS)
        .filter((tool) => !tool.consequential)
        .map((tool) => tool.name);
    case 'student':
      // The app reads its own data straight from Firestore under the security
      // rules. The only tools a student reaches are the ones Planly runs on
      // their behalf, and those are granted to the agent, not to them.
      return [];
    default:
      return [];
  }
}

export function canCall(actor: Actor, toolName: string): boolean {
  if (!(toolName in TOOLS)) return false;
  const tool = TOOLS[toolName]!;

  // A consequential action always needs a human, whatever the allowlist says.
  if (tool.consequential && actor.kind !== 'faculty') return false;

  return toolsForActor(actor).includes(toolName);
}

/** The tool definitions one agent is allowed to see, for building its prompt. */
export function definitionsForAgent(agent: AgentName): ToolDefinition<any, any>[] {
  return AGENT_TOOLS[agent].map((name) => TOOLS[name]!).filter(Boolean);
}

/** Sanity check — an allowlist naming a tool that does not exist is a bug. */
export function assertAllowlistsValid(): void {
  for (const [agent, names] of Object.entries(AGENT_TOOLS)) {
    for (const name of names) {
      if (!(name in TOOLS)) {
        throw new Error(`Agent "${agent}" is allowed unknown tool "${name}"`);
      }
      if (TOOLS[name]!.consequential) {
        throw new Error(
          `Agent "${agent}" is allowed consequential tool "${name}" — ` +
            'consequential actions require a human.',
        );
      }
    }
  }
}

/**
 * The tools an actor can actually call right now.
 *
 * `toolsForActor` answers "what does this role's allowlist permit", which is
 * static. This answers "what is available", which also depends on what a
 * faculty member has switched off — and that is the list to build a model's
 * tool catalogue from, so a disabled tool is never offered in the first place.
 *
 * `executeTool` re-checks independently. Both matter: this one stops the model
 * seeing the tool, that one stops it calling a name it already knows.
 */
export async function availableToolsForActor(
  db: Firestore,
  actor: Actor,
): Promise<string[]> {
  const settings = await getConnectorSettings(db);
  const disabled = new Set(settings.disabledTools);
  return toolsForActor(actor).filter((name) => !disabled.has(name));
}

/** Tool definitions an agent can see, minus anything switched off. */
export async function availableDefinitionsForAgent(
  db: Firestore,
  agent: AgentName,
): Promise<ToolDefinition<any, any>[]> {
  const settings = await getConnectorSettings(db);
  const disabled = new Set(settings.disabledTools);
  return definitionsForAgent(agent).filter((tool) => !disabled.has(tool.name));
}
