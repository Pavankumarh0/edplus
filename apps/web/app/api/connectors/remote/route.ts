import { NextResponse } from 'next/server';
import { z } from 'zod';
import { handshakeAndDiscover, redactSecrets } from '@eduplus/core/connectors';
import { RemoteConnectorSchema, type RemoteConnector } from '@eduplus/core';
import {
  deleteConnectorTokens,
  deleteRemoteConnector,
  getRemoteConnector,
  listRemoteConnectors,
  saveRemoteConnector,
  setRemoteToolEnabled,
  updateRemoteConnector,
  writeAudit,
} from '@eduplus/core/repositories';
import { errorResponse, facultyContext } from '@/lib/api';
import { beginConnection, redirectUrlFor } from '@/lib/connector-oauth';

/**
 * Remote MCP connectors — add, test, discover, disconnect.
 *
 * Two rules shape this file:
 *
 *   1. A connector becomes `connected` only when a handshake AND a tools/list
 *      actually succeed. Saving a URL proves nothing.
 *   2. Every discovered tool arrives disabled. A third-party server does not
 *      get to hand an agent new capabilities by advertising them.
 */

const TestSchema = z.object({
  serverUrl: z.string().min(1).max(2000),
});

const SaveSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  serverUrl: z.string().min(1).max(2000),
  description: z.string().trim().max(500).optional(),
});

const ToggleSchema = z.object({
  connectorId: z.string().min(1),
  tool: z.string().min(1),
  enabled: z.boolean(),
});

/** A stable, readable id with no characters that would break the namespace. */
function connectorIdFrom(displayName: string): string {
  const slug = displayName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 28);
  return `${slug || 'connector'}-${Date.now().toString(36).slice(-4)}`;
}

/**
 * Turns a failure into something an administrator can act on.
 *
 * Never echoes the raw error: a transport failure can carry a full URL, and a
 * URL can carry a token someone pasted despite being told not to.
 */
function describeFailure(error: unknown): string {
  if (!(error instanceof Error)) return 'Could not connect to that server.';

  // Matched by name, not by instanceof. The error is constructed inside
  // @eduplus/core and caught here; if the bundler ever hands the two sides
  // separate copies of the class, instanceof quietly starts returning false
  // and every real message collapses into the generic one — which is exactly
  // the failure that is hardest to debug.
  if (['UrlNotAllowedError', 'ConnectorError', 'MissingEncryptionKeyError'].includes(error.name)) {
    return redactSecrets(error.message);
  }

  // Anything else still says something, rather than nothing.
  return redactSecrets(error.message) || 'Could not connect to that server.';
}

export async function GET() {
  try {
    const ctx = await facultyContext();
    const connectors = await listRemoteConnectors(ctx.db);
    return NextResponse.json({ connectors });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Test a URL without saving anything.
 *
 * Runs the full handshake so the preview a mentor sees before saving is the
 * real tool list, not a promise about one.
 */
export async function PUT(request: Request) {
  try {
    await facultyContext();

    const parsed = TestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Expected a server URL.' }, { status: 400 });
    }

    try {
      const result = await handshakeAndDiscover(parsed.data.serverUrl);
      return NextResponse.json({
        ok: true,
        serverName: result.serverName,
        serverVersion: result.serverVersion,
        tools: result.tools,
        message:
          `Connected to "${result.serverName}" and found ${result.tools.length} ` +
          `tool${result.tools.length === 1 ? '' : 's'}. ` +
          'Review them before switching any on.',
      });
    } catch (error) {
      return NextResponse.json({ ok: false, error: describeFailure(error) }, { status: 400 });
    }
  } catch (error) {
    return errorResponse(error);
  }
}

/** Adds a connector, but only if it answers. */
export async function POST(request: Request) {
  try {
    const ctx = await facultyContext();

    const parsed = SaveSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join('; ') },
        { status: 400 },
      );
    }

    const { displayName, serverUrl, description } = parsed.data;
    const now = new Date().toISOString();
    const connectorId = connectorIdFrom(displayName);

    try {
      // A server that needs authorization sends the mentor to its own consent
      // page first; nothing is saved until they come back having approved it.
      const attempt = await beginConnection(ctx.db, {
        serverUrl,
        displayName,
        description,
        ownerId: ctx.actor.id,
        // Built from THIS request's origin, so the browser comes back to the
        // host that holds its session cookie.
        redirectUri: redirectUrlFor(request),
      });

      if (attempt.kind === 'needs_authorization') {
        await writeAudit(ctx.db, {
          actor: ctx.actor,
          tool: 'connector.oauth.start',
          args: { serverUrl },
          status: 'ok',
        });
        return NextResponse.json({
          needsAuthorization: true,
          authorizeUrl: attempt.authorizeUrl,
          message:
            `${displayName} requires you to sign in. You will be sent to its ` +
            'authorization page; the connector is added only once you approve it.',
        });
      }

      const result = attempt.result;

      const connector: RemoteConnector = RemoteConnectorSchema.parse({
        connectorId,
        displayName,
        serverUrl,
        description,
        ownerId: ctx.actor.id,
        status: 'connected',
        serverName: result.serverName,
        serverVersion: result.serverVersion,
        // Every one off. A human enables them individually, having read them.
        tools: result.tools.map((tool) => ({ ...tool, enabled: false })),
        lastConnectedAt: now,
        lastError: null,
        createdAt: now,
        updatedAt: now,
      } satisfies RemoteConnector);

      await saveRemoteConnector(ctx.db, connector);
      await writeAudit(ctx.db, {
        actor: ctx.actor,
        tool: 'connector.add',
        args: { connectorId, serverUrl, tools: result.tools.length },
        status: 'ok',
      });

      return NextResponse.json({
        connector,
        message:
          `${displayName} connected. ${result.tools.length} tool` +
          `${result.tools.length === 1 ? '' : 's'} discovered, all switched off — ` +
          'turn on the ones you want the agents to have.',
      });
    } catch (error) {
      // Recorded as a refusal, so a repeated attempt to add an internal address
      // is visible in the audit log rather than silently dropped.
      await writeAudit(ctx.db, {
        actor: ctx.actor,
        tool: 'connector.add',
        args: { serverUrl },
        status: 'permission_denied',
        errorMessage: describeFailure(error),
      });
      return NextResponse.json({ error: describeFailure(error) }, { status: 400 });
    }
  } catch (error) {
    return errorResponse(error);
  }
}

/** Enables or disables one discovered tool, or re-tests the connection. */
export async function PATCH(request: Request) {
  try {
    const ctx = await facultyContext();
    const body = await request.json().catch(() => null);

    // Re-test: { connectorId, reconnect: true }
    if (body && typeof body === 'object' && 'reconnect' in body) {
      const connectorId = String((body as { connectorId?: unknown }).connectorId ?? '');
      const existing = await getRemoteConnector(ctx.db, connectorId);
      if (!existing) return NextResponse.json({ error: 'No such connector.' }, { status: 404 });

      try {
        const result = await handshakeAndDiscover(existing.serverUrl);
        // Re-discovery keeps the enabled flags a human already set, and anything
        // newly advertised arrives off — a server cannot gain capabilities by
        // adding a tool between reconnects.
        const previous = new Map(existing.tools.map((t) => [t.name, t.enabled]));
        const connector = await updateRemoteConnector(ctx.db, connectorId, {
          status: 'connected',
          serverName: result.serverName,
          serverVersion: result.serverVersion,
          tools: result.tools.map((tool) => ({
            ...tool,
            enabled: previous.get(tool.name) ?? false,
          })),
          lastConnectedAt: new Date().toISOString(),
          lastError: null,
        });
        return NextResponse.json({ connector, message: 'Reconnected.' });
      } catch (error) {
        const connector = await updateRemoteConnector(ctx.db, connectorId, {
          status: 'error',
          lastError: describeFailure(error),
        });
        return NextResponse.json({ connector, error: describeFailure(error) }, { status: 400 });
      }
    }

    const parsed = ToggleSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Expected connectorId, tool and enabled.' },
        { status: 400 },
      );
    }

    const connector = await setRemoteToolEnabled(
      ctx.db,
      parsed.data.connectorId,
      parsed.data.tool,
      parsed.data.enabled,
    );
    await writeAudit(ctx.db, {
      actor: ctx.actor,
      tool: parsed.data.enabled ? 'connector.tool.enable' : 'connector.tool.disable',
      args: { connectorId: parsed.data.connectorId, tool: parsed.data.tool },
      status: 'ok',
    });

    return NextResponse.json({
      connector,
      message: parsed.data.enabled
        ? `${parsed.data.tool} is now available to the agents.`
        : `${parsed.data.tool} is switched off.`,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Disconnects, which removes every one of its tools from the agents at once. */
export async function DELETE(request: Request) {
  try {
    const ctx = await facultyContext();
    const connectorId = new URL(request.url).searchParams.get('connectorId');
    if (!connectorId) {
      return NextResponse.json({ error: 'Expected a connectorId.' }, { status: 400 });
    }

    const existing = await getRemoteConnector(ctx.db, connectorId);
    if (!existing) return NextResponse.json({ error: 'No such connector.' }, { status: 404 });

    await deleteRemoteConnector(ctx.db, connectorId);
    // A working refresh token for a server nobody uses is exactly the
    // credential that turns up in a breach years later.
    await deleteConnectorTokens(ctx.db, connectorId);
    await writeAudit(ctx.db, {
      actor: ctx.actor,
      tool: 'connector.disconnect',
      args: { connectorId, tools: existing.tools.length },
      status: 'ok',
    });

    return NextResponse.json({
      message: `${existing.displayName} disconnected. Its tools are gone from every agent.`,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
