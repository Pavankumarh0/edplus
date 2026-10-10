'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { INTERVENTION_TYPES, INTERVENTION_TYPE_LABELS, type InterventionType } from '@eduplus/core';
import { Button, cx } from './ui';
import { CallPanel } from './CallPanel';

type Panel = 'none' | 'intervention' | 'call' | 'meeting';

/** Tomorrow as YYYY-MM-DD in the browser's own timezone, for the date input. */
function tomorrow(): string {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * The faculty action bar.
 *
 * Every consequential action goes through a form a human submits — there is no
 * path here that an agent can take. "Call parent" in particular opens a panel
 * showing the exact words that will be spoken, because the message is the
 * guardrail the voice agent is held to, and approving it is the whole point.
 */
export function StudentActions({
  usn,
  studentName,
  hasParentContact,
  parentLanguage,
  hasSnapshot,
  missedTasks = 0,
}: {
  usn: string;
  studentName: string;
  hasParentContact: boolean;
  parentLanguage: string;
  hasSnapshot: boolean;
  /** Overdue planned tasks, used to offer the right call wording. */
  missedTasks?: number;
}) {
  const router = useRouter();
  const [panel, setPanel] = useState<Panel>('none');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [simulatorUrl, setSimulatorUrl] = useState<string | null>(null);
  // The live meeting link, shown the moment it exists so the mentor can
  // join straight from here rather than hunting for it on a calendar.
  const [joinUrl, setJoinUrl] = useState<string | null>(null);
  // Set the moment a call is approved, which opens the call panel straight
  // away — no second tab, no second click.
  const [activeCall, setActiveCall] = useState<{
    callId: string;
    provider: 'vobiz' | 'simulated';
  } | null>(null);

  const firstName = studentName.split(/\s+/)[0] ?? studentName;

  async function post(url: string, body: unknown, label: string) {
    setBusy(label);
    setMessage(null);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = (await response.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        simulatorUrl?: string | null;
        callId?: string;
        provider?: 'vobiz' | 'simulated';
        joinUrl?: string;
        note?: string | null;
      };
      if (!response.ok) throw new Error(json.error ?? `${label} failed.`);
      setMessage({
        kind: 'ok',
        // A provider fallback is worth saying out loud rather than hiding — a
        // mentor expecting Google Meet should know they got something else.
        text: [json.message ?? `${label} done.`, json.note].filter(Boolean).join(' '),
      });
      setSimulatorUrl(json.simulatorUrl ?? null);
      setJoinUrl(json.joinUrl ?? null);
      setPanel('none');

      if (label === 'Call' && json.callId) {
        setActiveCall({ callId: json.callId, provider: json.provider ?? 'simulated' });
      }

      router.refresh();
    } catch (caught) {
      setMessage({
        kind: 'error',
        text: caught instanceof Error ? caught.message : `${label} failed.`,
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="w-full md:w-auto">
      {activeCall ? (
        <CallPanel
          callId={activeCall.callId}
          provider={activeCall.provider}
          onClose={() => {
            setActiveCall(null);
            router.refresh();
          }}
        />
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          disabled={!hasSnapshot || busy !== null}
          onClick={() => void post('/api/report', { usn }, 'Report')}
          title={hasSnapshot ? undefined : 'Needs a risk snapshot first'}
        >
          {busy === 'Report' ? 'Writing report…' : 'Generate report'}
        </Button>

        <Button
          variant="secondary"
          disabled={!hasSnapshot || busy !== null}
          onClick={() => setPanel(panel === 'intervention' ? 'none' : 'intervention')}
        >
          Create intervention
        </Button>

        <Button
          variant="secondary"
          disabled={busy !== null}
          onClick={() => setPanel(panel === 'meeting' ? 'none' : 'meeting')}
        >
          Schedule meeting
        </Button>

        <Button
          variant="secondary"
          disabled={!hasParentContact || busy !== null}
          onClick={() => setPanel(panel === 'call' ? 'none' : 'call')}
          title={hasParentContact ? undefined : 'No parent number on record'}
        >
          Call parent
        </Button>
      </div>

      {message ? (
        <p
          role="status"
          className="text-body-sm mt-3 rounded-[var(--radius-control)] px-3 py-2"
          style={
            message.kind === 'ok'
              ? { color: 'var(--color-level-stable)', background: 'var(--color-level-stable-fill)' }
              : {
                  color: 'var(--color-level-critical)',
                  background: 'var(--color-level-critical-fill)',
                }
          }
        >
          {message.text}
          {simulatorUrl ? (
            <>
              {' '}
              <a
                href={simulatorUrl}
                target="_blank"
                rel="noreferrer"
                className="font-medium underline underline-offset-2"
              >
                Open the simulator
              </a>
            </>
          ) : null}
          {joinUrl ? (
            <>
              {' '}
              <a
                href={joinUrl}
                target="_blank"
                rel="noreferrer"
                className="font-medium underline underline-offset-2"
              >
                Join the meeting
              </a>
            </>
          ) : null}
        </p>
      ) : null}

      {/* ── Schedule meeting ────────────────────────────────────────────── */}
      {panel === 'meeting' ? (
        <form
          className="bg-surface border-hairline mt-3 w-full rounded-[var(--radius-card)] border p-4 md:w-[420px]"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);

            // The inputs are a date and a wall-clock time, which is how a
            // mentor thinks about a meeting. Converting here means the stored
            // instant carries a real offset rather than a floating time that
            // means something different on the student's phone.
            const date = String(form.get('date'));
            const time = String(form.get('time'));
            const minutes = Number(form.get('minutes'));
            const start = new Date(`${date}T${time}`);
            if (Number.isNaN(start.getTime())) {
              setMessage({ kind: 'error', text: 'That date and time could not be read.' });
              return;
            }
            const end = new Date(start.getTime() + minutes * 60_000);

            void post(
              '/api/meetings',
              {
                usn,
                title: form.get('title'),
                reason: form.get('reason'),
                agenda: form.get('agenda') || undefined,
                startsAt: start.toISOString(),
                endsAt: end.toISOString(),
              },
              'Meeting',
            );
          }}
        >
          <label className="text-label text-ink-muted block" htmlFor="meeting-title">
            Title — the student sees this
          </label>
          <input
            id="meeting-title"
            name="title"
            required
            minLength={3}
            defaultValue={`Catch-up with ${firstName}`}
            className="border-hairline text-body mt-1.5 min-h-[40px] w-full rounded-[var(--radius-control)] border bg-white px-2"
          />

          <label className="text-label text-ink-muted mt-3 block" htmlFor="meeting-reason">
            Reason — quote the numbers
          </label>
          <textarea
            id="meeting-reason"
            name="reason"
            required
            minLength={10}
            rows={2}
            placeholder="Attendance 64.4% against a 90% threshold; assessment average 42%."
            className="border-hairline text-body mt-1.5 w-full rounded-[var(--radius-control)] border bg-white p-2"
          />

          <label className="text-label text-ink-muted mt-3 block" htmlFor="meeting-agenda">
            What to tell the student
          </label>
          <input
            id="meeting-agenda"
            name="agenda"
            defaultValue="A short catch-up about how the term is going."
            className="border-hairline text-body mt-1.5 min-h-[40px] w-full rounded-[var(--radius-control)] border bg-white px-2"
          />

          <div className="mt-3 grid grid-cols-3 gap-2">
            <div>
              <label className="text-label text-ink-muted block" htmlFor="meeting-date">
                Date
              </label>
              <input
                id="meeting-date"
                name="date"
                type="date"
                required
                defaultValue={tomorrow()}
                className="border-hairline text-body mt-1.5 min-h-[40px] w-full rounded-[var(--radius-control)] border bg-white px-2"
              />
            </div>
            <div>
              <label className="text-label text-ink-muted block" htmlFor="meeting-time">
                Starts
              </label>
              <input
                id="meeting-time"
                name="time"
                type="time"
                required
                defaultValue="10:00"
                className="border-hairline text-body mt-1.5 min-h-[40px] w-full rounded-[var(--radius-control)] border bg-white px-2"
              />
            </div>
            <div>
              <label className="text-label text-ink-muted block" htmlFor="meeting-minutes">
                Minutes
              </label>
              <select
                id="meeting-minutes"
                name="minutes"
                defaultValue="30"
                className="border-hairline text-body mt-1.5 min-h-[40px] w-full rounded-[var(--radius-control)] border bg-white px-2"
              >
                <option value="15">15</option>
                <option value="30">30</option>
                <option value="45">45</option>
                <option value="60">60</option>
              </select>
            </div>
          </div>

          <div className="mt-4 flex items-center gap-2">
            <Button type="submit" disabled={busy !== null}>
              {busy === 'Meeting' ? 'Creating the link…' : 'Create meeting link'}
            </Button>
            <Button variant="ghost" type="button" onClick={() => setPanel('none')}>
              Cancel
            </Button>
          </div>
          <p className="text-body-sm text-ink-faint mt-3">
            The link appears on this page and on the student&rsquo;s calendar straight away.
          </p>
        </form>
      ) : null}

      {/* ── Create intervention ─────────────────────────────────────────── */}
      {panel === 'intervention' ? (
        <form
          className="bg-surface border-hairline mt-3 w-full rounded-[var(--radius-card)] border p-4 md:w-[420px]"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            void post(
              '/api/interventions',
              {
                usn,
                type: form.get('type'),
                reason: form.get('reason'),
                dueDate: form.get('dueDate') || undefined,
                approve: form.get('approve') === 'on',
              },
              'Intervention',
            );
          }}
        >
          <label className="text-label text-ink-muted block" htmlFor="type">
            Type
          </label>
          <select
            id="type"
            name="type"
            defaultValue={'mentor_meeting' satisfies InterventionType}
            className="border-hairline text-body mt-1.5 min-h-[40px] w-full rounded-[var(--radius-control)] border bg-white px-2"
          >
            {INTERVENTION_TYPES.map((type) => (
              <option key={type} value={type}>
                {INTERVENTION_TYPE_LABELS[type]}
              </option>
            ))}
          </select>

          <label className="text-label text-ink-muted mt-3 block" htmlFor="reason">
            Reason — quote the numbers
          </label>
          <textarea
            id="reason"
            name="reason"
            required
            minLength={10}
            rows={3}
            className="border-hairline text-body mt-1.5 w-full rounded-[var(--radius-control)] border bg-white px-2 py-1.5"
            placeholder="Attendance 38% against a 90% threshold; assessment average 14%."
          />

          <label className="text-label text-ink-muted mt-3 block" htmlFor="dueDate">
            Due date
          </label>
          <input
            id="dueDate"
            name="dueDate"
            type="date"
            className="border-hairline text-body mt-1.5 min-h-[40px] w-full rounded-[var(--radius-control)] border bg-white px-2"
          />

          <label className="text-body-sm mt-3 flex items-center gap-2">
            <input name="approve" type="checkbox" defaultChecked className="accent-ink size-4" />
            Approve immediately and create recovery tasks
          </label>

          <div className="mt-4 flex gap-2">
            <Button type="submit" disabled={busy !== null}>
              {busy === 'Intervention' ? 'Saving…' : 'Create intervention'}
            </Button>
            <Button variant="ghost" onClick={() => setPanel('none')}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      {/* ── Call parent ─────────────────────────────────────────────────── */}
      {panel === 'call' ? (
        <form
          className="bg-surface border-hairline mt-3 w-full rounded-[var(--radius-card)] border p-4 md:w-[460px]"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            // `missed_work` is a wording choice, not a new call purpose —
            // to the agent and the record it is a progress update.
            const purpose = form.get('purpose');
            void post(
              '/api/calls',
              {
                usn,
                purpose: purpose === 'missed_work' ? 'risk_update' : purpose,
                approvedMessage: form.get('approvedMessage'),
              },
              'Call',
            );
          }}
        >
          <p className="text-body-sm text-ink-muted mb-3">
            Pressing <span className="text-ink font-medium">Call now</span> places the call
            immediately. The agent says exactly this and nothing more — it identifies itself as an
            automated assistant, is never given marks or the risk score, and offers a mentor
            callback if asked for a person. Language:{' '}
            <span className="text-ink font-medium">{parentLanguage}</span>.
          </p>

          <label className="text-label text-ink-muted block" htmlFor="purpose">
            Purpose
          </label>
          <select
            id="purpose"
            name="purpose"
            defaultValue="ptm"
            className="border-hairline text-body mt-1.5 min-h-[40px] w-full rounded-[var(--radius-control)] border bg-white px-2"
            onChange={(event) => {
              const field = event.currentTarget.form?.elements.namedItem(
                'approvedMessage',
              ) as HTMLTextAreaElement | null;
              if (!field) return;
              // Plain, factual wording. A parent call reports a fact and asks
              // for support; it never accuses a child or threatens anything.
              const messages: Record<string, string> = {
                absence: `${firstName} was absent from college today. Please make sure they attend tomorrow.`,
                ptm: `There is a parent-teacher meeting about ${firstName} on 20 March at 10am. Can you attend?`,
                risk_update: `${firstName} has been attending more regularly this month. Thank you for your support.`,
                missed_work:
                  `${firstName} agreed a study plan with the college and ${missedTasks} of the ` +
                  'tasks are still pending. Please encourage them to catch up this week.',
              };
              field.value = messages[event.target.value] ?? messages.absence!;
            }}
          >
            <option value="absence">Absence</option>
            <option value="ptm">Parent–teacher meeting</option>
            <option value="risk_update">Progress update</option>
            {missedTasks > 0 ? (
              <option value="missed_work">Missed agreed work ({missedTasks})</option>
            ) : null}
          </select>

          <label className="text-label text-ink-muted mt-3 block" htmlFor="approvedMessage">
            Approved message
          </label>
          <textarea
            id="approvedMessage"
            name="approvedMessage"
            required
            minLength={10}
            rows={3}
            defaultValue={`There is a parent-teacher meeting about ${firstName} on 20 March at 10am. Can you attend?`}
            className="border-hairline text-body mt-1.5 w-full rounded-[var(--radius-control)] border bg-white px-2 py-1.5"
          />

          <div className="mt-4 flex gap-2">
            <Button type="submit" disabled={busy !== null}>
              {busy === 'Call' ? 'Calling…' : 'Call now'}
            </Button>
            <Button variant="ghost" onClick={() => setPanel('none')}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
