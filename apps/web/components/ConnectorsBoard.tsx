'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  TOOL_CLASS_LABELS,
  type ConnectorCard,
  type ConnectorTool,
  type ToolClass,
} from '@eduplus/core';
import { Badge, Button, Card, CardTitle, cx } from './ui';
import { AddConnectorDialog } from './AddConnectorDialog';

interface Summary {
  connectors: number;
  connected: number;
  tools: number;
  enabled: number;
}

interface ActivityRow {
  auditId: string;
  tool: string;
  caller: string;
  callerKind: string;
  scopedTo: string | null;
  status: 'ok' | 'validation_error' | 'permission_denied' | 'error';
  errorMessage: string | null;
  durationMs: number | null;
  at: string;
  argKeys: string[];
}

type Tab = 'connected' | 'remote' | 'tools' | 'activity';

interface RemoteConnectorView {
  connectorId: string;
  displayName: string;
  serverUrl: string;
  description?: string;
  status: 'connected' | 'needs_setup' | 'error';
  serverName: string | null;
  lastError: string | null;
  lastConnectedAt: string | null;
  tools: { name: string; description: string; enabled: boolean }[];
}

const STATUS_TONE: Record<ActivityRow['status'], { label: string; fg: string; bg: string }> = {
  ok: { label: 'ok', fg: 'var(--color-level-stable)', bg: 'var(--color-level-stable-fill)' },
  permission_denied: {
    label: 'refused',
    fg: 'var(--color-level-at-risk)',
    bg: 'var(--color-level-at-risk-fill)',
  },
  validation_error: {
    label: 'bad arguments',
    fg: 'var(--color-level-watch)',
    bg: 'var(--color-level-watch-fill)',
  },
  error: { label: 'failed', fg: 'var(--color-level-critical)', bg: 'var(--color-level-critical-fill)' },
};

const CLASS_TONE: Record<ToolClass, string> = {
  read_only: 'bg-surface-sunk text-ink-muted',
  internal_write: 'bg-surface-sunk text-ink',
  consequential: 'bg-lime text-ink',
};

/**
 * The Connectors board.
 *
 * It renders the tool registry rather than a stored copy of it, so what a
 * mentor switches off here is the same list the permission layer reads on the
 * next tool call. Toggling is the point of the page: it is the one place the
 * invisible part of this system — what each agent may reach — is visible and
 * changeable.
 */
export function ConnectorsBoard() {
  const [connectors, setConnectors] = useState<ConnectorCard[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [activity, setActivity] = useState<ActivityRow[] | null>(null);
  const [tab, setTab] = useState<Tab>('connected');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [remote, setRemote] = useState<RemoteConnectorView[]>([]);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/connectors');
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? 'Could not load connectors.');
      setConnectors(json.connectors);
      setSummary(json.summary);

      const remoteResponse = await fetch('/api/connectors/remote');
      if (remoteResponse.ok) {
        const remoteJson = await remoteResponse.json();
        setRemote(remoteJson.connectors ?? []);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load connectors.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Fetched when the tab is first opened rather than up front: the audit log is
  // the largest thing on this page and most visits never look at it.
  useEffect(() => {
    if (tab !== 'activity' || activity !== null) return;
    void (async () => {
      try {
        const response = await fetch('/api/connectors/activity');
        const json = await response.json();
        if (!response.ok) throw new Error(json.error ?? 'Could not load activity.');
        setActivity(json.entries);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Could not load activity.');
      }
    })();
  }, [tab, activity]);

  /** Shared by the remote tool toggle, reconnect and disconnect actions. */
  async function remoteAction(init: RequestInit, label: string, query = ''): Promise<void> {
    setBusy(label);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/connectors/remote${query}`, init);
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error ?? 'That did not work.');
      setMessage(json.message ?? null);
      await load();
      setActivity(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That did not work.');
    } finally {
      setBusy(null);
    }
  }

  async function toggle(tool: ConnectorTool) {
    setBusy(tool.name);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch('/api/connectors', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tool: tool.name, enabled: !tool.enabled }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? 'Could not change that tool.');
      setConnectors(json.connectors);
      setSummary(json.summary);
      setMessage(json.message);
      // The change shows up as a new row, so a stale list would understate it.
      setActivity(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not change that tool.');
    } finally {
      setBusy(null);
    }
  }

  // Deduplicated by name: a tool can sit under more than one connector —
  // list_meetings belongs to both the native registry and the Google card —
  // and showing it twice would give it two toggles that disagree.
  const allTools = [
    ...new Map(
      (connectors ?? []).flatMap((c) => c.tools.map((t) => [t.name, t] as const)),
    ).values(),
  ].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      <header className="mb-6">
        <h1 className="text-h1">Connectors</h1>
        <p className="text-body-sm text-ink-muted mt-1 max-w-[70ch]">
          Every action an agent can take is a declared tool with a schema and an allow-list.
          This is that list. Switching one off takes it away from every agent on their next
          call — not just from this page.
        </p>
      </header>

      {summary ? (
        <dl className="border-hairline mb-6 flex flex-wrap gap-x-10 gap-y-3 border-b pb-5">
          {[
            [`${summary.connected} of ${summary.connectors}`, 'connectors live'],
            [`${summary.enabled} of ${summary.tools}`, 'tools enabled'],
          ].map(([value, label]) => (
            <div key={label}>
              <dd className="text-metric tnum">{value}</dd>
              <dt className="text-body-sm text-ink-muted">{label}</dt>
            </div>
          ))}
        </dl>
      ) : null}

      <div className="mb-5 flex flex-wrap gap-1.5">
        {(
          [
            ['connected', 'Connected'],
            ['remote', `Remote MCP${remote.length > 0 ? ` · ${remote.length}` : ''}`],
            ['tools', `Available tools${summary ? ` · ${summary.tools}` : ''}`],
            ['activity', 'Activity'],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cx(
              'text-body-sm rounded-[var(--radius-pill)] px-4 py-2 font-medium transition-colors duration-150',
              tab === key ? 'bg-ink text-canvas' : 'bg-surface-sunk text-ink-muted hover:text-ink',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {message ? (
        <p
          role="status"
          className="text-body-sm mb-4 rounded-[var(--radius-control)] px-3 py-2"
          style={{ color: 'var(--color-level-stable)', background: 'var(--color-level-stable-fill)' }}
        >
          {message}
        </p>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="text-body-sm mb-4 rounded-[var(--radius-control)] px-3 py-2"
          style={{
            color: 'var(--color-level-critical)',
            background: 'var(--color-level-critical-fill)',
          }}
        >
          {error}
        </p>
      ) : null}

      {connectors === null ? (
        <p className="text-body-sm text-ink-faint">Loading…</p>
      ) : null}

      {/* ── Connected ─────────────────────────────────────────────────────── */}
      {tab === 'connected' && connectors
        ? connectors.map((connector) => (
            <Card key={connector.id} className="mb-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <h2 className="text-h2">{connector.name}</h2>
                    {connector.status === 'connected' ? (
                      <span
                        className="text-label rounded-[var(--radius-pill)] px-2.5 py-0.5"
                        style={{
                          color: 'var(--color-level-stable)',
                          background: 'var(--color-level-stable-fill)',
                        }}
                      >
                        Connected
                      </span>
                    ) : (
                      <span
                        className="text-label rounded-[var(--radius-pill)] px-2.5 py-0.5"
                        style={{
                          color: 'var(--color-level-watch)',
                          background: 'var(--color-level-watch-fill)',
                        }}
                      >
                        Needs setup
                      </span>
                    )}
                    <Badge>{connector.tools.length} tools</Badge>
                  </div>
                  <p className="text-body-sm text-ink-muted mt-2 max-w-[68ch]">
                    {connector.description}
                  </p>
                </div>
                <span className="text-body-sm text-ink-faint shrink-0">
                  {connector.authMethod}
                </span>
              </div>

              <ul className="text-body-sm text-ink-muted mt-4 space-y-1">
                {connector.enables.map((line) => (
                  <li key={line} className="flex gap-2">
                    <span aria-hidden="true" className="text-ink-faint">
                      —
                    </span>
                    {line}
                  </li>
                ))}
              </ul>

              {connector.statusDetail ? (
                <p
                  className="text-body-sm mt-4 rounded-[var(--radius-control)] px-3 py-2"
                  style={{
                    color: 'var(--color-level-watch)',
                    background: 'var(--color-level-watch-fill)',
                  }}
                >
                  {connector.statusDetail}
                </p>
              ) : null}
            </Card>
          ))
        : null}

      {/* ── Remote MCP servers ────────────────────────────────────────────── */}
      {tab === 'remote' ? (
        <>
          <Card className="mb-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>Remote MCP servers</CardTitle>
                <p className="text-body-sm text-ink-muted mt-1 max-w-[62ch]">
                  Connect a server over Streamable HTTP. Its tools arrive switched off and
                  reach the copilot only once you turn them on.
                </p>
              </div>
              <Button onClick={() => setAdding(true)}>Add custom connector</Button>
            </div>
          </Card>

          {remote.length === 0 ? (
            <Card>
              <p className="text-body-sm text-ink-muted">
                None connected. Private, loopback and link-local addresses are refused, and a
                server has to complete an MCP handshake before it can be saved.
              </p>
            </Card>
          ) : (
            remote.map((connector) => (
              <Card key={connector.connectorId} className="mb-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <h2 className="text-h2">{connector.displayName}</h2>
                      <span
                        className="text-label rounded-[var(--radius-pill)] px-2.5 py-0.5"
                        style={
                          connector.status === 'connected'
                            ? {
                                color: 'var(--color-level-stable)',
                                background: 'var(--color-level-stable-fill)',
                              }
                            : {
                                color: 'var(--color-level-critical)',
                                background: 'var(--color-level-critical-fill)',
                              }
                        }
                      >
                        {connector.status === 'connected' ? 'Connected' : 'Not reachable'}
                      </span>
                      <Badge>
                        {connector.tools.filter((t) => t.enabled).length} of{' '}
                        {connector.tools.length} on
                      </Badge>
                    </div>
                    <p className="text-ink-faint mt-1.5 font-mono text-[12.5px] break-all">
                      {connector.serverUrl}
                    </p>
                    {connector.serverName ? (
                      <p className="text-body-sm text-ink-muted mt-1">
                        Identifies itself as {connector.serverName}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      variant="secondary"
                      disabled={busy !== null}
                      onClick={() =>
                        void remoteAction(
                          {
                            method: 'PATCH',
                            headers: { 'content-type': 'application/json' },
                            body: JSON.stringify({
                              connectorId: connector.connectorId,
                              reconnect: true,
                            }),
                          },
                          `reconnect-${connector.connectorId}`,
                        )
                      }
                    >
                      {busy === `reconnect-${connector.connectorId}` ? '…' : 'Reconnect'}
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={busy !== null}
                      onClick={() =>
                        void remoteAction(
                          { method: 'DELETE' },
                          `disconnect-${connector.connectorId}`,
                          `?connectorId=${encodeURIComponent(connector.connectorId)}`,
                        )
                      }
                    >
                      Disconnect
                    </Button>
                  </div>
                </div>

                {connector.lastError ? (
                  <p
                    className="text-body-sm mt-3 rounded-[var(--radius-control)] px-3 py-2"
                    style={{
                      color: 'var(--color-level-critical)',
                      background: 'var(--color-level-critical-fill)',
                    }}
                  >
                    {connector.lastError}
                  </p>
                ) : null}

                <ul className="divide-hairline mt-4 divide-y">
                  {connector.tools.map((tool) => (
                    <li
                      key={tool.name}
                      className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 py-3"
                    >
                      <div className="min-w-0 flex-1">
                        <span
                          className={cx(
                            'font-mono text-[13px]',
                            tool.enabled ? 'text-ink' : 'text-ink-faint',
                          )}
                        >
                          {tool.name}
                        </span>
                        <p className="text-body-sm text-ink-muted mt-1 max-w-[64ch]">
                          {tool.description || 'No description given.'}
                        </p>
                        <p className="text-body-sm text-ink-faint mt-1">
                          Written by that server, not by EduPlus.
                        </p>
                      </div>
                      <Button
                        variant={tool.enabled ? 'ghost' : 'secondary'}
                        disabled={busy !== null}
                        onClick={() =>
                          void remoteAction(
                            {
                              method: 'PATCH',
                              headers: { 'content-type': 'application/json' },
                              body: JSON.stringify({
                                connectorId: connector.connectorId,
                                tool: tool.name,
                                enabled: !tool.enabled,
                              }),
                            },
                            `${connector.connectorId}-${tool.name}`,
                          )
                        }
                      >
                        {tool.enabled ? 'Switch off' : 'Switch on'}
                      </Button>
                    </li>
                  ))}
                </ul>
              </Card>
            ))
          )}
        </>
      ) : null}

      {adding ? (
        <AddConnectorDialog
          onClose={() => setAdding(false)}
          onAdded={(text) => {
            setMessage(text);
            void load();
          }}
        />
      ) : null}

      {/* ── Available tools ───────────────────────────────────────────────── */}
      {tab === 'tools' && connectors ? (
        <Card>
          <CardTitle hint="Switching one off revokes it from every agent immediately">
            Available tools
          </CardTitle>
          <ul className="divide-hairline divide-y">
            {allTools.map((tool) => (
              <li
                key={tool.name}
                className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 py-3.5 first:pt-0"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={cx(
                        'font-mono text-[13px]',
                        tool.enabled ? 'text-ink' : 'text-ink-faint line-through',
                      )}
                    >
                      {tool.name}
                    </span>
                    <span
                      className={cx(
                        'text-label rounded-[var(--radius-pill)] px-2 py-0.5',
                        CLASS_TONE[tool.toolClass],
                      )}
                    >
                      {TOOL_CLASS_LABELS[tool.toolClass]}
                    </span>
                  </div>
                  <p className="text-body-sm text-ink-muted mt-1 max-w-[64ch]">
                    {tool.description}
                  </p>
                  <p className="text-body-sm text-ink-faint mt-1">
                    {tool.agents.length > 0
                      ? `Reachable by ${tool.agents.join(', ')}`
                      : 'Faculty only — no agent can call it'}
                  </p>
                </div>
                <Button
                  variant={tool.enabled ? 'ghost' : 'secondary'}
                  disabled={busy !== null}
                  onClick={() => void toggle(tool)}
                >
                  {busy === tool.name ? '…' : tool.enabled ? 'Switch off' : 'Switch on'}
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* ── Activity ──────────────────────────────────────────────────────── */}
      {tab === 'activity' ? (
        <Card>
          <CardTitle hint="Refusals are shown too — they are the evidence the allow-list works">
            Tool activity
          </CardTitle>
          {activity === null ? (
            <p className="text-body-sm text-ink-faint">Loading…</p>
          ) : activity.length === 0 ? (
            <p className="text-body-sm text-ink-muted">
              Nothing yet. Every tool call lands here, including the refused ones.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="text-label text-ink-faint">
                    <th className="pb-2 font-medium">Tool</th>
                    <th className="pb-2 font-medium">Caller</th>
                    <th className="pb-2 font-medium">Scope</th>
                    <th className="pb-2 font-medium">Status</th>
                    <th className="pb-2 text-right font-medium">Took</th>
                    <th className="pb-2 text-right font-medium">When</th>
                  </tr>
                </thead>
                <tbody className="text-body-sm">
                  {activity.map((row) => {
                    const tone = STATUS_TONE[row.status];
                    return (
                      <tr key={row.auditId} className="border-hairline border-t align-top">
                        <td className="py-2.5 pr-3 font-mono text-[12.5px]">{row.tool}</td>
                        <td className="text-ink-muted py-2.5 pr-3">{row.caller}</td>
                        <td className="text-ink-faint py-2.5 pr-3 font-mono text-[12px]">
                          {row.scopedTo ?? '—'}
                        </td>
                        <td className="py-2.5 pr-3">
                          <span
                            className="text-label rounded-[var(--radius-pill)] px-2 py-0.5"
                            style={{ color: tone.fg, background: tone.bg }}
                          >
                            {tone.label}
                          </span>
                        </td>
                        <td className="text-ink-faint py-2.5 text-right tabular-nums">
                          {row.durationMs === null ? '—' : `${row.durationMs} ms`}
                        </td>
                        <td className="text-ink-faint py-2.5 text-right tabular-nums">
                          {new Date(row.at).toLocaleTimeString('en-IN', {
                            hour: '2-digit',
                            minute: '2-digit',
                            hour12: false,
                          })}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}
    </>
  );
}
