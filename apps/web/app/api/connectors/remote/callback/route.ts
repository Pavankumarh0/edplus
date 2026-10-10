import { NextResponse } from 'next/server';
import { RemoteConnectorSchema, type RemoteConnector } from '@eduplus/core';
import { redactSecrets } from '@eduplus/core/connectors';
import {
  saveConnectorTokens,
  saveRemoteConnector,
  takePendingAuthorization,
  writeAudit,
} from '@eduplus/core/repositories';
import { completeConnection } from '@/lib/connector-oauth';
import { facultyContext } from '@/lib/api';

/**
 * Where the authorization server sends the browser back.
 *
 * This runs as a top-level navigation, not as fetch, so it answers with a
 * redirect to the Connectors page carrying a short result in the query string
 * — never a token, and never an error body that might contain one.
 */

function back(message: string, ok: boolean): NextResponse {
  const url = new URL('/connectors', process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000');
  url.searchParams.set(ok ? 'connected' : 'error', message.slice(0, 300));
  return NextResponse.redirect(url);
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const state = params.get('state');
  const code = params.get('code');
  const providerError = params.get('error');

  if (providerError) {
    // The person pressed Deny, or the provider refused. Not an error of ours.
    return back(
      providerError === 'access_denied'
        ? 'Authorization was declined, so nothing was connected.'
        : `The provider refused the authorization (${providerError}).`,
      false,
    );
  }

  if (!state || !code) {
    return back('That authorization link was incomplete. Start again.', false);
  }

  let ctx;
  try {
    // The callback is a browser navigation, so the session cookie is present.
    // Requiring faculty here is what stops someone who intercepted a redirect
    // from completing a connection in a signed-out browser.
    ctx = await facultyContext();
  } catch {
    return back('Sign in as faculty and start the connection again.', false);
  }

  // Single-use: read and delete in one transaction.
  const pending = await takePendingAuthorization(ctx.db, state);
  if (!pending) {
    return back('That authorization has already been used or has expired.', false);
  }

  if (new Date(pending.expiresAt) <= new Date()) {
    return back('That authorization took too long and expired. Start again.', false);
  }

  // The flow must be finished by whoever started it.
  if (pending.ownerId !== ctx.actor.id) {
    await writeAudit(ctx.db, {
      actor: ctx.actor,
      tool: 'connector.oauth.callback',
      args: { state: '[redacted]' },
      status: 'permission_denied',
      errorMessage: 'The authorization was started by a different account.',
    });
    return back('That authorization belongs to a different account.', false);
  }

  try {
    const { result, sealedTokens } = await completeConnection(ctx.db, pending, code);

    const now = new Date().toISOString();
    const connectorId = `${pending.displayName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 28)}-${Date.now().toString(36).slice(-4)}`;

    const connector: RemoteConnector = RemoteConnectorSchema.parse({
      connectorId,
      displayName: pending.displayName,
      serverUrl: pending.serverUrl,
      description: pending.description,
      ownerId: pending.ownerId,
      status: 'connected',
      serverName: result.serverName,
      serverVersion: result.serverVersion,
      tools: result.tools.map((tool) => ({ ...tool, enabled: false })),
      lastConnectedAt: now,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    } satisfies RemoteConnector);

    await saveRemoteConnector(ctx.db, connector);
    // Tokens go to their own collection, which no client may read, and which
    // the connector endpoint never touches.
    await saveConnectorTokens(ctx.db, connectorId, {
      tokens: sealedTokens,
      clientInformation: pending.clientInformation,
      updatedAt: now,
    });

    await writeAudit(ctx.db, {
      actor: ctx.actor,
      tool: 'connector.oauth.complete',
      args: { connectorId, serverUrl: pending.serverUrl, tools: result.tools.length },
      status: 'ok',
    });

    return back(
      `${pending.displayName} authorized and connected. ${result.tools.length} tool` +
        `${result.tools.length === 1 ? '' : 's'} discovered, all switched off.`,
      true,
    );
  } catch (error) {
    const message = redactSecrets(error instanceof Error ? error.message : String(error));
    await writeAudit(ctx.db, {
      actor: ctx.actor,
      tool: 'connector.oauth.complete',
      args: { serverUrl: pending.serverUrl },
      status: 'error',
      errorMessage: message,
    });
    return back(`Could not finish authorizing: ${message}`, false);
  }
}
