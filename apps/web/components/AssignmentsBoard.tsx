'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Assignment, AssignmentProgress } from '@eduplus/core';
import { Badge, Button, Card, CardTitle, Usn, cx } from './ui';

interface Row {
  usn: string;
  name: string;
  status: 'on_time' | 'late' | null;
  submittedAt: string | null;
  version: number;
  content: string | null;
}

interface Detail {
  assignment: Assignment;
  qr: string;
  progress: AssignmentProgress;
  rows: Row[];
}

/** Tomorrow at 17:00, which is what a deadline usually is. */
function defaultDeadline(): string {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(17, 0, 0, 0);
  const pad = (n: number) => `${n}`.padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T17:00`;
}

/**
 * Assignment management.
 *
 * The QR is the point of the page: it goes on a projector, thirty phones read
 * it, and the submitted count climbs while the mentor watches. So the code is
 * shown large in text beside it — a camera pointed at a bright screen fails
 * often enough that the typed fallback has to be as visible as the QR itself.
 */
export function AssignmentsBoard() {
  const [list, setList] = useState<{ assignment: Assignment; progress: AssignmentProgress }[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/assignments');
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? 'Could not load assignments.');
      setList(json.assignments);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load assignments.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openDetail = useCallback(async (assignmentId: string) => {
    setError(null);
    try {
      const response = await fetch(`/api/assignments/${encodeURIComponent(assignmentId)}`);
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? 'Could not open that assignment.');
      setDetail(json);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not open that assignment.');
    }
  }, []);

  // While an assignment is open on screen, submissions are arriving. Polling
  // is the honest version of "updates as they come in" without a socket.
  useEffect(() => {
    if (!detail) return;
    const timer = setInterval(() => {
      void openDetail(detail.assignment.assignmentId);
      void load();
    }, 5000);
    return () => clearInterval(timer);
  }, [detail, openDetail, load]);

  async function create(form: FormData) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      // A datetime-local value is wall-clock with no zone. Converting here
      // means the stored deadline is a real instant rather than a time that
      // means something different on the student's phone.
      const local = String(form.get('deadline'));
      const deadline = new Date(local);
      if (Number.isNaN(deadline.getTime())) throw new Error('That deadline could not be read.');

      const response = await fetch('/api/assignments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: form.get('title'),
          subject: form.get('subject'),
          instructions: form.get('instructions'),
          semester: Number(form.get('semester')),
          section: form.get('section'),
          deadline: deadline.toISOString(),
          maxMarks: form.get('maxMarks') ? Number(form.get('maxMarks')) : undefined,
          acceptLate: form.get('acceptLate') === 'on',
        }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? 'Could not create that assignment.');

      setMessage(json.message);
      setCreating(false);
      await load();
      await openDetail(json.assignment.assignmentId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create that assignment.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-h1">Assignments</h1>
          <p className="text-body-sm text-ink-muted mt-1 max-w-[70ch]">
            Create an assignment, put its code on the projector, and watch the submissions
            arrive. The deadline is decided by the server, not by anyone&rsquo;s phone.
          </p>
        </div>
        <Button onClick={() => setCreating((open) => !open)}>
          {creating ? 'Cancel' : 'New assignment'}
        </Button>
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

      {/* ── Create ───────────────────────────────────────────────────────── */}
      {creating ? (
        <Card className="mb-5">
          <CardTitle>New assignment</CardTitle>
          <form
            className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              void create(new FormData(event.currentTarget));
            }}
          >
            <label className="block md:col-span-2">
              <span className="text-label text-ink-muted">Title</span>
              <input
                name="title"
                required
                minLength={3}
                defaultValue="DBMS Assignment 3 — Normalisation"
                className="border-hairline text-body mt-1.5 min-h-[40px] w-full rounded-[var(--radius-control)] border bg-white px-2"
              />
            </label>

            <label className="block">
              <span className="text-label text-ink-muted">Subject</span>
              <input
                name="subject"
                required
                defaultValue="DBMS"
                className="border-hairline text-body mt-1.5 min-h-[40px] w-full rounded-[var(--radius-control)] border bg-white px-2"
              />
            </label>

            <label className="block">
              <span className="text-label text-ink-muted">Maximum marks</span>
              <input
                name="maxMarks"
                type="number"
                min={1}
                defaultValue={20}
                className="border-hairline text-body mt-1.5 min-h-[40px] w-full rounded-[var(--radius-control)] border bg-white px-2"
              />
            </label>

            <label className="block md:col-span-2">
              <span className="text-label text-ink-muted">Instructions</span>
              <textarea
                name="instructions"
                required
                rows={3}
                defaultValue="Normalise the given schema to 3NF. Show each step and name the dependency you removed."
                className="border-hairline text-body mt-1.5 w-full rounded-[var(--radius-control)] border bg-white p-2"
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
              <span className="text-label text-ink-muted">Deadline</span>
              <input
                name="deadline"
                type="datetime-local"
                required
                defaultValue={defaultDeadline()}
                className="border-hairline text-body mt-1.5 min-h-[40px] w-full rounded-[var(--radius-control)] border bg-white px-2"
              />
            </label>

            <label className="flex items-center gap-2 self-end pb-2">
              <input type="checkbox" name="acceptLate" defaultChecked className="h-4 w-4" />
              <span className="text-body-sm">
                Accept late work, marked late
              </span>
            </label>

            <div className="md:col-span-2">
              <Button type="submit" disabled={busy}>
                {busy ? 'Creating…' : 'Create and show the QR'}
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      {/* ── The QR and the live count ────────────────────────────────────── */}
      {detail ? (
        <Card className="mb-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <CardTitle hint={`Semester ${detail.assignment.semester} · Section ${detail.assignment.section}`}>
                {detail.assignment.title}
              </CardTitle>
              <p className="text-body-sm text-ink-muted mt-1">{detail.assignment.subject}</p>
              <p className="text-body-sm text-ink-muted mt-3 max-w-[60ch]">
                {detail.assignment.instructions}
              </p>
              <p className="text-body-sm text-ink-faint mt-3">
                Due {new Date(detail.assignment.deadline).toLocaleString('en-IN')}
              </p>
            </div>
            <Button variant="ghost" onClick={() => setDetail(null)}>
              Close
            </Button>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-8">
            <div className="text-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={detail.qr}
                alt={`QR code for ${detail.assignment.title}`}
                className="border-hairline rounded-[var(--radius-card)] border"
                width={220}
                height={220}
              />
              <p className="text-ink-faint mt-2 text-[12.5px]">Scan in the EduPlus app</p>
            </div>

            <div>
              <p className="text-label text-ink-muted">Or type this code</p>
              <p className="mt-1 font-mono text-[56px] leading-none font-bold tracking-[0.12em]">
                {detail.assignment.code}
              </p>
              <p className="text-body-sm text-ink-faint mt-3 max-w-[32ch]">
                Works when a camera will not. The code identifies the assignment; only
                students in the right class can open it.
              </p>
            </div>

            <dl className="flex flex-wrap gap-x-8 gap-y-3">
              {[
                [`${detail.progress.submitted} of ${detail.progress.eligible}`, 'submitted'],
                [`${detail.progress.onTime}`, 'on time'],
                [`${detail.progress.late}`, 'late'],
                [`${detail.progress.missing}`, 'not yet'],
              ].map(([value, label]) => (
                <div key={label}>
                  <dd className="text-metric tnum">{value}</dd>
                  <dt className="text-body-sm text-ink-muted">{label}</dt>
                </div>
              ))}
            </dl>
          </div>

          <ul className="divide-hairline mt-6 divide-y">
            {detail.rows.map((row) => (
              <li
                key={row.usn}
                className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-body font-medium">{row.name}</span>
                    <Usn>{row.usn}</Usn>
                    {row.status === null ? (
                      <Badge tone="nodata">Not submitted</Badge>
                    ) : row.status === 'on_time' ? (
                      <span
                        className="text-label rounded-[var(--radius-pill)] px-2 py-0.5"
                        style={{
                          color: 'var(--color-level-stable)',
                          background: 'var(--color-level-stable-fill)',
                        }}
                      >
                        On time
                      </span>
                    ) : (
                      <span
                        className="text-label rounded-[var(--radius-pill)] px-2 py-0.5"
                        style={{
                          color: 'var(--color-level-watch)',
                          background: 'var(--color-level-watch-fill)',
                        }}
                      >
                        Late
                      </span>
                    )}
                    {row.version > 1 ? <Badge>attempt {row.version}</Badge> : null}
                  </div>
                  {row.content ? (
                    <p className="text-body-sm text-ink-muted mt-1 line-clamp-3 max-w-[70ch]">
                      {row.content}
                    </p>
                  ) : null}
                </div>
                <span className="text-body-sm text-ink-faint shrink-0 tabular-nums">
                  {row.submittedAt
                    ? new Date(row.submittedAt).toLocaleString('en-IN', {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: false,
                      })
                    : '—'}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* ── The list ─────────────────────────────────────────────────────── */}
      <Card>
        <CardTitle hint={list.length > 0 ? `${list.length}` : undefined}>All assignments</CardTitle>
        {list.length === 0 ? (
          <p className="text-body-sm text-ink-muted">
            None yet. Create one and its QR appears here.
          </p>
        ) : (
          <ul className="divide-hairline divide-y">
            {list.map(({ assignment, progress }) => {
              const overdue = new Date(assignment.deadline) < new Date();
              return (
                <li
                  key={assignment.assignmentId}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3"
                >
                  <button
                    type="button"
                    onClick={() => void openDetail(assignment.assignmentId)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <span className="text-body font-medium underline-offset-2 hover:underline">
                      {assignment.title}
                    </span>
                    <span className="text-body-sm text-ink-muted ml-2">
                      {assignment.subject} · sem {assignment.semester}
                      {assignment.section}
                    </span>
                  </button>
                  <span className="font-mono text-[13px] tracking-[0.08em]">{assignment.code}</span>
                  <span
                    className={cx(
                      'text-body-sm tabular-nums',
                      progress.missing > 0 && overdue ? 'text-ink' : 'text-ink-muted',
                    )}
                  >
                    {progress.submitted}/{progress.eligible} in
                    {progress.missing > 0 && overdue ? ` · ${progress.missing} missed` : ''}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
