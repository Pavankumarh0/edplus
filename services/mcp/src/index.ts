#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { TOOLS, executeTool, toolsForActor, type ToolContext } from '@eduplus/core/tools';
import { getDb, isUsingEmulator } from '@eduplus/core/repositories';
import type { Actor } from '@eduplus/core';

/**
 * EduPlus MCP server.
 *
 * Exposes the SAME tool registry the in-app agents use. There is one
 * definition of "create an intervention" in this system, and this server is a
 * second transport onto it rather than a second implementation — so an MCP
 * client cannot reach a code path the dashboard does not have, and every call
 * made here lands in the same audit log.
 *
 * The caller's identity comes from the environment, not from the request:
 * stdio MCP has no authenticated user, so the operator declares who this
 * server acts as when they launch it.
 */

const ACTOR_KIND = process.env.MCP_ACTOR_KIND ?? 'faculty';
const ACTOR_ID = process.env.MCP_ACTOR_ID ?? 'mcp-client';

function actor(): Actor {
  if (ACTOR_KIND === 'agent') {
    return {
      kind: 'agent',
      id: ACTOR_ID,
      agentName: process.env.MCP_AGENT_NAME ?? 'copilot',
    };
  }
  if (ACTOR_KIND === 'system') return { kind: 'system', id: ACTOR_ID };
  return { kind: 'faculty', id: ACTOR_ID };
}

function context(): ToolContext {
  return { db: getDb(), actor: actor() };
}

const server = new McpServer({
  name: 'eduplus-mcp-server',
  version: '1.0.0',
});

/**
 * Registers every tool the configured actor is allowed to call.
 *
 * An MCP client connecting as the voice agent sees two tools; one connecting
 * as faculty sees all eleven. The allowlist is applied at registration AND
 * again inside `executeTool`, so even a client that somehow names a hidden
 * tool is refused and audited.
 */
const allowed = toolsForActor(actor());

for (const name of allowed) {
  const tool = TOOLS[name];
  if (!tool) continue;

  server.registerTool(
    tool.name,
    {
      title: tool.title,
      description: tool.description,
      // The SDK accepts a Zod raw shape. Our schemas are objects at the top
      // level, so hand over their shape directly — one definition, validated
      // the same way here as everywhere else.
      inputSchema: (tool.inputSchema as unknown as { shape: Record<string, never> }).shape,
      annotations: {
        readOnlyHint: tool.readOnly,
        destructiveHint: false,
        idempotentHint: tool.readOnly,
        openWorldHint: false,
      },
    },
    async (args: unknown) => {
      const result = await executeTool(tool.name, args, context());

      if (!result.ok) {
        return {
          // Errors come back as content with isError, so the model can read
          // the reason and correct itself rather than the call simply failing.
          content: [{ type: 'text' as const, text: result.error ?? 'The tool failed.' }],
          isError: true,
        };
      }

      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(result.data, null, 2) },
        ],
        structuredContent: result.data as Record<string, unknown>,
      };
    },
  );
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // stdout is the protocol channel — anything written there corrupts the
  // stream, so every diagnostic goes to stderr.
  console.error(
    `eduplus-mcp-server ready · actor=${ACTOR_KIND}${
      ACTOR_KIND === 'agent' ? `:${process.env.MCP_AGENT_NAME ?? 'copilot'}` : ''
    } · tools=${allowed.length} · ${
      isUsingEmulator() ? 'emulator' : `project ${process.env.FIREBASE_PROJECT_ID ?? '(unset)'}`
    }`,
  );
}

main().catch((error) => {
  console.error('eduplus-mcp-server failed to start:', error);
  process.exit(1);
});
