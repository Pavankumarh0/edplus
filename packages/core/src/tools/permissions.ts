import type { Actor } from '../schemas/index';
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
 * `schedule_parent_call` appears in no list. It is consequential, so a human
 * creates it; the copilot's job is to draft the wording and hand it over.
 */
export const AGENT_TOOLS: Record<AgentName, readonly string[]> = {
  /** Writes one honest report per student from their snapshot and history. */
  report: [
    'get_student',
    'get_student_history',
    'get_risk_breakdown',
    'save_report',
    'propose_intervention',
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
  ],

  /**
   * Speaks to a parent. Deliberately tiny: it can read the approved message
   * and record what the parent said. Nothing else.
   */
  voice: ['get_call_context', 'log_call_outcome'],
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
      // The student app reads its own data through Firestore rules, not tools.
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
