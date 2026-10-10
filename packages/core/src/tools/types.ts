import type { z } from 'zod';
import type { Actor } from '../schemas/index';
import type { Firestore } from '../repositories/firestore';

/** Everything a tool handler is allowed to touch. */
export interface ToolContext {
  db: Firestore;
  /** Who is calling. Drives both the permission check and the audit row. */
  actor: Actor;
  /** Injectable clock, so tool behaviour is testable. */
  now?: () => Date;
}

/**
 * One action in the system.
 *
 * The same definition is exposed as an MCP tool, called by the in-app agents,
 * and invoked by the dashboard's API routes. There is exactly one
 * implementation of "create an intervention", so an agent cannot reach a
 * different code path than a human.
 */
export interface ToolDefinition<Input = unknown, Output = unknown> {
  name: string;
  /** Short human label for the audit log and the UI. */
  title: string;
  /**
   * Written for a model, not for a developer. Says what the tool does, when to
   * reach for it, and what it refuses to do — the last part matters most,
   * because an agent that knows a tool only proposes will not promise a parent
   * a phone call that has not been approved.
   */
  description: string;
  inputSchema: z.ZodType<Input>;
  /**
   * True when the action has an effect outside the system that cannot be
   * taken back — placing a phone call, or committing to an intervention.
   *
   * Consequential tools are never granted to an agent. Agents reach the
   * `propose_*` variants; a human presses the button.
   */
  consequential: boolean;
  /** Read-only tools are safe to retry and cheap to expose widely. */
  readOnly: boolean;
  handler: (input: Input, ctx: ToolContext) => Promise<Output>;
}

/** The agents that call tools. Each gets an allowlist, never the full set. */
export const AGENT_NAMES = ['report', 'copilot', 'voice'] as const;
export type AgentName = (typeof AGENT_NAMES)[number];

export class ToolPermissionError extends Error {
  constructor(
    readonly tool: string,
    readonly actor: Actor,
  ) {
    super(
      `${actor.kind}${actor.agentName ? `:${actor.agentName}` : ''} is not permitted to call "${tool}"`,
    );
    this.name = 'ToolPermissionError';
  }
}

export class ToolValidationError extends Error {
  constructor(
    readonly tool: string,
    readonly issues: string[],
  ) {
    super(`Invalid arguments for "${tool}": ${issues.join('; ')}`);
    this.name = 'ToolValidationError';
  }
}

export class ToolNotFoundError extends Error {
  constructor(readonly tool: string) {
    super(`No such tool: "${tool}"`);
    this.name = 'ToolNotFoundError';
  }
}
