'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  ALLOWED_STATUS_TRANSITIONS,
  INTERVENTION_TYPE_LABELS,
  type Intervention,
  type InterventionStatus,
} from '@eduplus/core';
import { Badge, Button, Usn, cx } from './ui';

const ACTION_LABEL: Record<InterventionStatus, string> = {
  proposed: 'Move back to proposed',
  approved: 'Approve',
  in_progress: 'Start',
  completed: 'Mark completed',
  cancelled: 'Cancel',
};

/**
 * One card on the interventions board.
 *
 * The available buttons come from `ALLOWED_STATUS_TRANSITIONS` in the shared
 * core, so the UI cannot offer a move the tool layer would refuse — the board
 * and the API agree by construction rather than by memory.
 */
export function InterventionCard({ intervention }: { intervention: Intervention }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const next = ALLOWED_STATUS_TRANSITIONS[intervention.status];

  async function move(status: InterventionStatus) {
    setBusy(status);
    setError(null);
    try {
      const response = await fetch('/api/interventions', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ interventionId: intervention.interventionId, status }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? 'Could not update.');
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not update.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <article className="bg-surface border-hairline rounded-[var(--radius-control)] border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <span className="text-body font-medium">
          {INTERVENTION_TYPE_LABELS[intervention.type]}
        </span>
        {intervention.outcome ? (
          <Badge tone={intervention.outcome === 'improved' ? 'lime' : 'neutral'}>
            {intervention.outcome.replace('_', ' ')}
          </Badge>
        ) : null}
      </div>

      <Link
        href={`/students/${intervention.usn}`}
        className="text-body-sm text-ink-muted hover:text-ink mt-1 block"
      >
        <Usn>{intervention.usn}</Usn>
      </Link>

      <p className="text-body-sm text-ink-muted mt-2 line-clamp-3">{intervention.reason}</p>

      <div className="text-body-sm mt-2 flex flex-wrap items-center gap-2 tabular-nums">
        <span className="text-ink-faint">baseline {intervention.baselineScore}</span>
        {intervention.outcomeScore !== null ? (
          <span className="font-medium">→ {intervention.outcomeScore}</span>
        ) : null}
        {intervention.dueDate ? (
          <span className="text-ink-faint">due {intervention.dueDate}</span>
        ) : null}
      </div>

      {intervention.status === 'completed' && intervention.outcome === null ? (
        <p className="text-body-sm text-ink-faint mt-2">
          Waiting on the next upload to decide whether it worked.
        </p>
      ) : null}

      {next.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {next.map((status) => (
            <Button
              key={status}
              variant={status === 'cancelled' ? 'ghost' : 'secondary'}
              disabled={busy !== null}
              onClick={() => void move(status)}
              className={cx('min-h-[32px] px-3 text-[13px]')}
            >
              {busy === status ? '…' : ACTION_LABEL[status]}
            </Button>
          ))}
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-body-sm mt-2" style={{ color: 'var(--color-level-critical)' }}>
          {error}
        </p>
      ) : null}
    </article>
  );
}
