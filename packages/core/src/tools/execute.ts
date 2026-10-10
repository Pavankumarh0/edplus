import { writeAudit } from '../repositories/config';
import { TOOLS } from './definitions';
import { canCall } from './permissions';
import {
  ToolNotFoundError,
  ToolPermissionError,
  ToolValidationError,
  type ToolContext,
} from './types';

export interface ToolResult<T = unknown> {
  ok: boolean;
  tool: string;
  data?: T;
  error?: string;
  durationMs: number;
}

/**
 * The single entry point for every tool call in the system.
 *
 * Four things happen in a fixed order, and none is skippable:
 *   1. the tool exists
 *   2. the caller is permitted to use it
 *   3. the arguments validate against its Zod schema
 *   4. the call is audited — whether it succeeded, was refused or threw
 *
 * Step 4 runs for refusals too. A `permission_denied` row is the evidence that
 * the allowlist is real, which is precisely what a reviewer asks to see, and it
 * is also how we would notice an agent repeatedly trying to reach past its
 * remit.
 *
 * Errors come back as a result rather than being thrown, because the caller is
 * usually a model loop that must be told "that did not work, here is why" and
 * allowed to try something else.
 */
export async function executeTool<T = unknown>(
  toolName: string,
  rawInput: unknown,
  ctx: ToolContext,
): Promise<ToolResult<T>> {
  const started = Date.now();
  const finish = () => Date.now() - started;

  const tool = TOOLS[toolName];
  if (!tool) {
    const error = new ToolNotFoundError(toolName);
    await writeAudit(ctx.db, {
      actor: ctx.actor,
      tool: toolName,
      args: rawInput,
      status: 'error',
      errorMessage: error.message,
      durationMs: finish(),
    });
    return { ok: false, tool: toolName, error: error.message, durationMs: finish() };
  }

  if (!canCall(ctx.actor, toolName)) {
    const error = new ToolPermissionError(toolName, ctx.actor);
    await writeAudit(ctx.db, {
      actor: ctx.actor,
      tool: toolName,
      args: rawInput,
      status: 'permission_denied',
      errorMessage: error.message,
      durationMs: finish(),
    });
    return { ok: false, tool: toolName, error: error.message, durationMs: finish() };
  }

  const parsed = tool.inputSchema.safeParse(rawInput);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(
      (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    const error = new ToolValidationError(toolName, issues);
    await writeAudit(ctx.db, {
      actor: ctx.actor,
      tool: toolName,
      args: rawInput,
      status: 'validation_error',
      errorMessage: error.message,
      durationMs: finish(),
    });
    return { ok: false, tool: toolName, error: error.message, durationMs: finish() };
  }

  try {
    const data = (await tool.handler(parsed.data, ctx)) as T;
    await writeAudit(ctx.db, {
      actor: ctx.actor,
      tool: toolName,
      args: parsed.data,
      status: 'ok',
      durationMs: finish(),
    });
    return { ok: true, tool: toolName, data, durationMs: finish() };
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    await writeAudit(ctx.db, {
      actor: ctx.actor,
      tool: toolName,
      args: parsed.data,
      status: 'error',
      errorMessage: message,
      durationMs: finish(),
    });
    return { ok: false, tool: toolName, error: message, durationMs: finish() };
  }
}

/**
 * Renders a tool result as the string an LLM reads back.
 *
 * Failures are returned as readable text rather than as an exception so the
 * model can recover — "No student with USN X. Check the USN" is actionable in a
 * way that a stack trace is not.
 */
export function formatToolResult(result: ToolResult): string {
  if (!result.ok) return `ERROR: ${result.error}`;
  return JSON.stringify(result.data, null, 2);
}
