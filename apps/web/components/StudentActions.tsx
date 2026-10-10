'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { INTERVENTION_TYPES, INTERVENTION_TYPE_LABELS, type InterventionType } from '@eduplus/core';
import { Button, cx } from './ui';
import { CallPanel } from './CallPanel';

type Panel = 'none' | 'intervention' | 'call';

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
}: {
  usn: string;
  studentName: string;
  hasParentContact: boolean;
  parentLanguage: string;
  hasSnapshot: boolean;
}) {
  const router = useRouter();
  const [panel, setPanel] = useState<Panel>('none');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [simulatorUrl, setSimulatorUrl] = useState<string | null>(null);
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
      };
      if (!response.ok) throw new Error(json.error ?? `${label} failed.`);
      setMessage({ kind: 'ok', text: json.message ?? `${label} done.` });
      setSimulatorUrl(json.simulatorUrl ?? null);
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
        </p>
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
            void post(
              '/api/calls',
              {
                usn,
                purpose: form.get('purpose'),
                approvedMessage: form.get('approvedMessage'),
              },
              'Call',
            );
          }}
        >
          <p className="text-body-sm text-ink-muted mb-3">
            The agent will say exactly this and nothing more. It identifies itself as an automated
            assistant and will offer a mentor callback if asked for a person. Language:{' '}
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
              field.value =
                event.target.value === 'absence'
                  ? `${firstName} was absent from college today. Please make sure they attend tomorrow.`
                  : event.target.value === 'ptm'
                    ? `There is a parent-teacher meeting about ${firstName} on 20 March at 10am. Can you attend?`
                    : `${firstName} has been attending more regularly this month. Thank you for your support.`;
            }}
          >
            <option value="absence">Absence</option>
            <option value="ptm">Parent–teacher meeting</option>
            <option value="risk_update">Progress update</option>
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
              {busy === 'Call' ? 'Queueing…' : 'Approve and queue call'}
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
