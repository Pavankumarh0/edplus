'use client';

import { useCallback, useEffect, useState } from 'react';
import { ROTATION_SECONDS, type PublicExitSession } from '@eduplus/core';
import { Badge, Button, Card, CardTitle, Usn, cx } from './ui';

interface Row {
  usn: string;
  name: string;
  verifiedAt: string | null;
}

interface Detail {
  session: PublicExitSession;
  live: boolean;
  qr: string | null;
  verified: number;
  eligible: number;
  rows: Row[];
}

/**
 * Classroom exit verification.
 *
 * The QR is re-fetched on a timer rather than drawn once, because the token
 * underneath it rotates — a photograph of this screen stops working within
 * seconds, which is the only thing standing between "scanned the code" and
 * "was anywhere near the room".
 */
export function ExitBoard() {
  const [sessions, setSessions] = useState<(PublicExitSession & { live: boolean })[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    try {
      const response = await fetch('/api/exit-sessions');
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? 'Could not load sessions.');
      setSessions(json.sessions);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load sessions.');
    }
  }, []);

  const loadDetail = useCallback(async (sessionId: string) => {
    try {
      const response = await fetch(`/api/exit-sessions?sessionId=${encodeURIComponent(sessionId)}`);
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? 'Could not open that session.');
      setDetail(json);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not open that session.');
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  // Refresh inside the rotation window, so the code on screen is always one a
  // phone can still redeem.
  useEffect(() => {
    if (!detail?.live) return;
    const timer = setInterval(
      () => void loadDetail(detail.session.sessionId),
      (ROTATION_SECONDS - 3) * 1000,
    );
    return () => clearInterval(timer);
  }, [detail, loadDetail]);

  async function open(form: FormData) {
    setBusy('create');
    setError(null);
    setMessage(null);
    try {
      const response = await fetch('/api/exit-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          label: form.get('label'),
          semester: Number(form.get('semester')),
          section: form.get('section'),
          minutes: Number(form.get('minutes')),
        }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? 'Could not open a session.');
      setMessage(json.message);
      await loadList();
      await loadDetail(json.session.sessionId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not open a session.');
    } finally {
      setBusy(null);
    }
  }

  async function act(body: Record<string, unknown>, label: string) {
    setBusy(label);
    setError(null);
    try {
      const response = await fetch('/api/exit-sessions', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? 'That did not work.');
      setMessage(json.message);
      if (detail) await loadDetail(detail.session.sessionId);
      await loadList();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That did not work.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <header className="mb-6">
        <h1 className="text-h1">Classroom exit</h1>
        <p className="text-body-sm text-ink-muted mt-1 max-w-[72ch]">
          Show a rotating code at the end of a session; students scan it in the EduPlus app
          to record that they signed out. Separate from assignments, and deliberately kept
          out of the risk score.
        </p>
      </header>

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

      <Card className="mb-5">
        <CardTitle>Start a session</CardTitle>
        <form
          className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-4"
          onSubmit={(event) => {
            event.preventDefault();
            void open(new FormData(event.currentTarget));
          }}
        >
          <label className="block sm:col-span-2">
            <span className="text-label text-ink-muted">What session</span>
            <input
              name="label"
              required
              defaultValue="DBMS lab"
              className="border-hairline text-body mt-1.5 min-h-[40px] w-full rounded-[var(--radius-control)] border bg-white px-2"
            />
          </label>
          <label className="block">
            <span className="text-label text-ink-muted">Semester</span>
            <input
              name="semester"
              type="number"
              min={1}
              max={8}
              required
              defaultValue={5}
              className="border-hairline text-body mt-1.5 min-h-[40px] w-full rounded-[var(--radius-control)] border bg-white px-2"
            />
          </label>
          <label className="block">
            <span className="text-label text-ink-muted">Section</span>
            <input
              name="section"
              required
              defaultValue="A"
              className="border-hairline text-body mt-1.5 min-h-[40px] w-full rounded-[var(--radius-control)] border bg-white px-2"
            />
          </label>
          <label className="block">
            <span className="text-label text-ink-muted">Open for (minutes)</span>
            <select
              name="minutes"
              defaultValue="10"
              className="border-hairline text-body mt-1.5 min-h-[40px] w-full rounded-[var(--radius-control)] border bg-white px-2"
            >
              {[5, 10, 15, 30].map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <div className="sm:col-span-3 sm:self-end">
            <Button type="submit" disabled={busy !== null}>
              {busy === 'create' ? 'Opening…' : 'Generate exit QR'}
            </Button>
          </div>
        </form>
      </Card>

      {detail ? (
        <Card className="mb-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <CardTitle
                hint={`Semester ${detail.session.semester} · Section ${detail.session.section}`}
              >
                {detail.session.label}
              </CardTitle>
              <p className="text-body-sm text-ink-muted mt-1">
                {detail.live
                  ? `Open until ${new Date(detail.session.expiresAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })}`
                  : 'Closed. The code no longer works.'}
              </p>
            </div>
            <div className="flex gap-2">
              {detail.live ? (
                <Button
                  variant="secondary"
                  disabled={busy !== null}
                  onClick={() => void act({ sessionId: detail.session.sessionId }, 'end')}
                >
                  {busy === 'end' ? '…' : 'End session'}
                </Button>
              ) : null}
              <Button variant="ghost" onClick={() => setDetail(null)}>
                Close
              </Button>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-8">
            {detail.qr ? (
              <div className="text-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={detail.qr}
                  alt="Rotating exit QR code"
                  className="border-hairline rounded-[var(--radius-card)] border"
                  width={240}
                  height={240}
                />
                <p className="text-ink-faint mt-2 text-[12.5px]">
                  Changes every {ROTATION_SECONDS} seconds
                </p>
              </div>
            ) : (
              <div className="bg-surface-sunk grid h-[240px] w-[240px] place-items-center rounded-[var(--radius-card)]">
                <span className="text-body-sm text-ink-muted">Session closed</span>
              </div>
            )}

            <div>
              <dl className="flex flex-wrap gap-x-8 gap-y-3">
                <div>
                  <dd className="text-metric tnum">
                    {detail.verified} of {detail.eligible}
                  </dd>
                  <dt className="text-body-sm text-ink-muted">verified</dt>
                </div>
              </dl>
              <p className="text-body-sm text-ink-faint mt-4 max-w-[38ch]">
                A scan records that a signed-in student sent a valid code at that moment. It
                does not prove they were in the room, or that they left it.
              </p>
            </div>
          </div>

          <ul className="divide-hairline mt-6 divide-y">
            {detail.rows.map((row) => (
              <li
                key={row.usn}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-body font-medium">{row.name}</span>
                  <Usn>{row.usn}</Usn>
                  {row.verifiedAt === null ? <Badge tone="nodata">Not verified</Badge> : null}
                </span>
                {row.verifiedAt ? (
                  <span className="text-body-sm text-ink-faint tabular-nums">
                    {new Date(row.verifiedAt).toLocaleTimeString('en-IN', {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                      hour12: false,
                    })}
                  </span>
                ) : (
                  <Button
                    variant="ghost"
                    disabled={busy !== null || !detail.live}
                    onClick={() =>
                      void act(
                        { sessionId: detail.session.sessionId, overrideUsn: row.usn },
                        `ov-${row.usn}`,
                      )
                    }
                    title="For a genuine scanning failure. Recorded in the audit log as an override."
                  >
                    Record by hand
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        <CardTitle hint={sessions.length > 0 ? `${sessions.length}` : undefined}>
          Past sessions
        </CardTitle>
        {sessions.length === 0 ? (
          <p className="text-body-sm text-ink-muted">None yet.</p>
        ) : (
          <ul className="divide-hairline divide-y">
            {sessions.map((session) => (
              <li
                key={session.sessionId}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5"
              >
                <button
                  type="button"
                  onClick={() => void loadDetail(session.sessionId)}
                  className="text-body min-w-0 flex-1 text-left font-medium underline-offset-2 hover:underline"
                >
                  {session.label}
                </button>
                <span className="text-body-sm text-ink-muted">
                  sem {session.semester}
                  {session.section}
                </span>
                <span
                  className={cx(
                    'text-label rounded-[var(--radius-pill)] px-2 py-0.5',
                    session.live ? 'bg-lime text-ink' : 'bg-surface-sunk text-ink-muted',
                  )}
                >
                  {session.live ? 'Open' : 'Closed'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
