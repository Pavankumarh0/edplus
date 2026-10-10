import { getConnectorSettings, writeAudit } from '../repositories/config';
import { getRemoteConnector } from '../repositories/connectors';
import { callRemoteTool, fenceUntrusted } from '../connectors/mcp-client';
import { parseRemoteToolName } from '../schemas/connector';
import { parseStudentToolName } from '../schemas/studentConnector';
import { listUsableStudentConnections } from '../repositories/studentConnectors';
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
 * Five things happen in a fixed order, and none is skippable:
 *   1. the tool exists
 *   2. the caller is permitted to use it
 *   3. the tool has not been switched off on the Connectors page
 *   4. the arguments validate against its Zod schema
 *   5. the call is audited — whether it succeeded, was refused or threw
 *
 * Step 3 is checked here rather than only where the tool catalogue is built,
 * so switching a tool off revokes it from a conversation already in flight —
 * a model that learnt the name a moment ago still cannot call it.
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

  // A student-namespaced name belongs to a server the student attached from
  // the college's approved list.
  const studentRemote = parseStudentToolName(toolName);
  if (studentRemote) {
    return (await executeStudentRemoteTool(
      toolName,
      studentRemote,
      rawInput,
      ctx,
      finish,
    )) as ToolResult<T>;
  }

  // A namespaced name belongs to a remote MCP server, not to our registry.
  const remote = parseRemoteToolName(toolName);
  if (remote) {
    return (await executeRemoteTool(toolName, remote, rawInput, ctx, finish)) as ToolResult<T>;
  }

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

  const settings = await getConnectorSettings(ctx.db);
  if (settings.disabledTools.includes(toolName)) {
    const message =
      `"${toolName}" is switched off on the Connectors page. ` +
      'Tell the user it is unavailable and that a faculty member can re-enable it; ' +
      'do not attempt the action another way.';
    await writeAudit(ctx.db, {
      actor: ctx.actor,
      tool: toolName,
      args: rawInput,
      status: 'permission_denied',
      errorMessage: message,
      durationMs: finish(),
    });
    return { ok: false, tool: toolName, error: message, durationMs: finish() };
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

/**
 * Calls a tool on a remote MCP server.
 *
 * Held to the same four checks as a native tool, plus two more that only
 * matter for a third party: the connector must still be connected, and the
 * individual tool must still be enabled. Both are read now rather than
 * cached, so disconnecting revokes access to a call already being composed.
 *
 * The result is fenced before it goes back to the model. A remote server's
 * output is data from someone we do not control, and the one thing it must
 * never be able to do is read as an instruction.
 */
async function executeRemoteTool(
  toolName: string,
  remote: { connectorId: string; toolName: string },
  rawInput: unknown,
  ctx: ToolContext,
  finish: () => number,
): Promise<ToolResult<string>> {
  const fail = async (message: string, status: 'permission_denied' | 'error') => {
    await writeAudit(ctx.db, {
      actor: ctx.actor,
      tool: toolName,
      args: rawInput,
      status,
      errorMessage: message,
      durationMs: finish(),
    });
    return { ok: false, tool: toolName, error: message, durationMs: finish() };
  };

  // Only a faculty member or an agent acting in the dashboard reaches an
  // external server. A student-scoped actor never does: their data stays in
  // this system, and a remote connector is not a place to send it.
  if (ctx.actor.kind === 'student' || ctx.actor.usn) {
    return fail(
      'Remote connectors are not available in the student app.',
      'permission_denied',
    );
  }

  const connector = await getRemoteConnector(ctx.db, remote.connectorId);
  if (!connector) {
    return fail(`The connector "${remote.connectorId}" has been disconnected.`, 'permission_denied');
  }
  if (connector.status !== 'connected') {
    return fail(`"${connector.displayName}" is not connected.`, 'permission_denied');
  }

  const tool = connector.tools.find((t) => t.name === remote.toolName);
  if (!tool) {
    return fail(`"${connector.displayName}" no longer offers "${remote.toolName}".`, 'permission_denied');
  }
  if (!tool.enabled) {
    return fail(
      `"${remote.toolName}" is switched off for "${connector.displayName}".`,
      'permission_denied',
    );
  }

  try {
    const text = await callRemoteTool(
      connector.serverUrl,
      remote.toolName,
      (rawInput ?? {}) as Record<string, unknown>,
    );
    await writeAudit(ctx.db, {
      actor: ctx.actor,
      tool: toolName,
      args: rawInput,
      status: 'ok',
      durationMs: finish(),
    });
    return {
      ok: true,
      tool: toolName,
      data: fenceUntrusted(connector.displayName, remote.toolName, text),
      durationMs: finish(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail(message, 'error');
  }
}

/**
 * Calls a tool on a server a STUDENT attached.
 *
 * Three things are re-read here rather than trusted from the call: the student
 * in scope comes from the actor, the server URL comes from the college's
 * approved entry, and the entry has to still exist. A student never supplies a
 * URL — not in the request, not in storage — so "only approved servers" holds
 * even if everything else about the call is attacker-shaped.
 *
 * Revocation therefore needs no sweep: removing the approved entry makes every
 * student's connection unresolvable on its next use.
 */
async function executeStudentRemoteTool(
  toolName: string,
  remote: { connectionId: string; toolName: string },
  rawInput: unknown,
  ctx: ToolContext,
  finish: () => number,
): Promise<ToolResult<string>> {
  const fail = async (message: string, status: 'permission_denied' | 'error') => {
    await writeAudit(ctx.db, {
      actor: ctx.actor,
      tool: toolName,
      args: rawInput,
      status,
      errorMessage: message,
      durationMs: finish(),
    });
    return { ok: false, tool: toolName, error: message, durationMs: finish() };
  };

  // The scope comes from the verified token, never from the arguments.
  const usn = ctx.actor.usn;
  if (!usn) {
    return fail('That connector belongs to a student, and no student is in scope.', 'permission_denied');
  }

  const usable = await listUsableStudentConnections(ctx.db, usn);
  const match = usable.find((u) => u.connection.id === remote.connectionId);
  if (!match) {
    return fail(
      'That connector is no longer available. Your college may have removed it, ' +
        'or you may have disconnected it.',
      'permission_denied',
    );
  }

  if (!match.connection.enabledTools.includes(remote.toolName)) {
    return fail(`"${remote.toolName}" is switched off for that connector.`, 'permission_denied');
  }

  try {
    const text = await callRemoteTool(
      // The approved entry's URL, not anything stored on the student record.
      match.entry.serverUrl,
      remote.toolName,
      (rawInput ?? {}) as Record<string, unknown>,
    );
    await writeAudit(ctx.db, {
      actor: ctx.actor,
      tool: toolName,
      args: rawInput,
      status: 'ok',
      durationMs: finish(),
    });
    return {
      ok: true,
      tool: toolName,
      data: fenceUntrusted(match.entry.displayName, remote.toolName, text),
      durationMs: finish(),
    };
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error), 'error');
  }
}
