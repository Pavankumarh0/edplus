'use client';

import { useState } from 'react';
import { Button, cx } from './ui';

interface DiscoveredTool {
  name: string;
  description: string;
}

/**
 * Add a remote MCP server by URL.
 *
 * Deliberately two steps. "Test connection" runs the real handshake and shows
 * the real tool list, so a mentor sees what they are about to let into the
 * system before anything is saved — including, if the server is hostile, the
 * instructions it is trying to smuggle in through a tool description. Saving a
 * URL that has not answered is not possible from here.
 */
export function AddConnectorDialog({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded: (message: string) => void;
}) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState<'test' | 'save' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tested, setTested] = useState<{ serverName: string; tools: DiscoveredTool[] } | null>(
    null,
  );

  async function test() {
    setBusy('test');
    setError(null);
    setTested(null);
    try {
      const response = await fetch('/api/connectors/remote', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ serverUrl: url }),
      });
      const json = await response.json();
      if (!response.ok || !json.ok) throw new Error(json.error ?? 'Could not connect.');
      setTested({ serverName: json.serverName, tools: json.tools });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not connect.');
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setBusy('save');
    setError(null);
    try {
      const response = await fetch('/api/connectors/remote', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          displayName: name,
          serverUrl: url,
          description: description || undefined,
        }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? 'Could not add that connector.');
      onAdded(json.message);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not add that connector.');
    } finally {
      setBusy(null);
    }
  }

  const canTest = url.trim().length > 0 && busy === null;
  const canSave = tested !== null && name.trim().length > 0 && busy === null;

  return (
    <>
      <div className="bg-ink/30 fixed inset-0 z-40" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-label="Add custom connector"
        aria-modal="true"
        className="fixed left-1/2 top-1/2 z-50 max-h-[88vh] w-[min(94vw,560px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto"
      >
        <div className="bg-surface border-hairline shadow-raised rounded-[var(--radius-hero)] border p-6 sm:p-7">
          <div className="flex items-start justify-between gap-4">
            <h2 className="text-h1">Add custom connector</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="text-ink-faint hover:text-ink text-[22px] leading-none"
            >
              ×
            </button>
          </div>

          <p className="text-body-sm text-ink-muted mt-2">
            Connect EduPlus to a remote MCP server. Its tools become available to the
            copilot once you switch them on.
          </p>

          <label className="text-label text-ink-muted mt-6 block" htmlFor="connector-name">
            Name
          </label>
          <input
            id="connector-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Name"
            className="border-hairline text-body mt-1.5 min-h-[42px] w-full rounded-[var(--radius-control)] border bg-white px-3"
          />
          <p className="text-body-sm text-ink-faint mt-1">Shown in the connectors list.</p>

          <label className="text-label text-ink-muted mt-5 block" htmlFor="connector-url">
            MCP server URL
          </label>
          <input
            id="connector-url"
            value={url}
            onChange={(event) => {
              setUrl(event.target.value);
              setTested(null);
            }}
            placeholder="https://mcp.example.com/mcp"
            inputMode="url"
            className="border-hairline text-body mt-1.5 min-h-[42px] w-full rounded-[var(--radius-control)] border bg-white px-3 font-mono text-[13px]"
          />
          <p className="text-body-sm text-ink-faint mt-1">
            The HTTPS address where the server accepts MCP requests. Private and
            link-local addresses are refused.
          </p>

          <label className="text-label text-ink-muted mt-5 block" htmlFor="connector-desc">
            Description <span className="text-ink-faint font-normal">— optional</span>
          </label>
          <input
            id="connector-desc"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className="border-hairline text-body mt-1.5 min-h-[42px] w-full rounded-[var(--radius-control)] border bg-white px-3"
          />

          <p
            className="text-body-sm mt-5 rounded-[var(--radius-control)] px-3 py-2"
            style={{
              color: 'var(--color-level-watch)',
              background: 'var(--color-level-watch-fill)',
            }}
          >
            Only add servers you trust. EduPlus cannot verify which tools a third-party
            server offers or that they will not change. Everything it returns is treated as
            untrusted data, and every tool arrives switched off.
          </p>

          {error ? (
            <p
              role="alert"
              className="text-body-sm mt-4 rounded-[var(--radius-control)] px-3 py-2"
              style={{
                color: 'var(--color-level-critical)',
                background: 'var(--color-level-critical-fill)',
              }}
            >
              {error}
            </p>
          ) : null}

          {tested ? (
            <div className="border-hairline mt-4 rounded-[var(--radius-card)] border p-4">
              <p className="text-body-sm">
                <span className="font-semibold">Connected to {tested.serverName}.</span>{' '}
                {tested.tools.length} tool{tested.tools.length === 1 ? '' : 's'} found.
              </p>
              <ul className="mt-3 space-y-2">
                {tested.tools.map((tool) => (
                  <li key={tool.name}>
                    <span className="font-mono text-[12.5px]">{tool.name}</span>
                    <p className="text-body-sm text-ink-muted mt-0.5 line-clamp-3">
                      {tool.description || 'No description given.'}
                    </p>
                  </li>
                ))}
              </ul>
              <p className="text-body-sm text-ink-faint mt-3">
                Read these before saving — the text above was written by that server.
              </p>
            </div>
          ) : null}

          <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="secondary" disabled={!canTest} onClick={() => void test()}>
              {busy === 'test' ? 'Connecting…' : 'Test connection'}
            </Button>
            <Button
              disabled={!canSave}
              onClick={() => void save()}
              className={cx(!canSave && 'opacity-45')}
            >
              {busy === 'save' ? 'Saving…' : 'Add connector'}
            </Button>
          </div>
          {!tested ? (
            <p className="text-body-sm text-ink-faint mt-2 text-right">
              Test the connection before saving.
            </p>
          ) : null}
        </div>
      </div>
    </>
  );
}
