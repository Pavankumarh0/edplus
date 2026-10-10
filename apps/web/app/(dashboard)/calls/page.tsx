import Link from 'next/link';
import { PARENT_RESPONSE_LABELS, type CallRecord } from '@eduplus/core';
import { getDb, listCalls } from '@eduplus/core/repositories';
import { Badge, Card, CardTitle, EmptyState, Usn } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function CallsPage() {
  const calls = await listCalls(getDb());

  const byStatus = calls.reduce<Record<string, number>>((acc, call) => {
    acc[call.status] = (acc[call.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <>
      <header className="mb-6">
        <h1 className="text-h1">Parent calls</h1>
        <p className="text-body-sm text-ink-muted mt-1 max-w-[74ch]">
          Outbound calls to parents. Every call carries an approved message that a faculty member
          wrote, and the agent may not go beyond it. Parents are never given a risk score or
          individual marks.
        </p>
      </header>

      {calls.length === 0 ? (
        <EmptyState title="No calls yet">
          Open a student with a parent contact on record and use &ldquo;Call parent&rdquo;. You
          approve the exact wording before anything is dialled.
        </EmptyState>
      ) : (
        <>
          <Card className="mb-4">
            <CardTitle>By status</CardTitle>
            <div className="flex flex-wrap gap-2">
              {Object.entries(byStatus).map(([status, count]) => (
                <Badge key={status}>
                  {status} · {count}
                </Badge>
              ))}
            </div>
          </Card>

          <ul className="space-y-3">
            {calls.map((call) => (
              <li key={call.callId}>
                <CallRow call={call} />
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function CallRow({ call }: { call: CallRecord }) {
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/students/${call.usn}`} className="text-body font-medium hover:underline">
          <Usn>{call.usn}</Usn>
        </Link>
        <Badge>{call.purpose.replace('_', ' ')}</Badge>
        <Badge>{call.status}</Badge>
        <Badge>{call.provider}</Badge>
        <Badge>{call.language}</Badge>
        {call.parentResponse ? (
          <Badge tone="lime">{PARENT_RESPONSE_LABELS[call.parentResponse]}</Badge>
        ) : null}
        <span className="text-body-sm text-ink-faint ml-auto">
          {call.createdAt.slice(0, 16).replace('T', ' ')}
        </span>
      </div>

      <p className="text-body-sm text-ink-muted mt-3">
        <span className="text-ink font-medium">Approved message: </span>
        {call.approvedMessage}
      </p>

      {call.summary ? <p className="text-body-sm mt-2">{call.summary}</p> : null}

      {call.failureReason ? (
        <p className="text-body-sm mt-2" style={{ color: 'var(--color-level-critical)' }}>
          {call.failureReason}
        </p>
      ) : null}

      {call.transcript.length > 0 ? (
        <details className="mt-3">
          <summary className="text-body-sm text-ink-muted cursor-pointer">
            Transcript · {call.transcript.length} turns
          </summary>
          <ol className="mt-2 space-y-1.5">
            {call.transcript.map((turn, index) => (
              <li key={index} className="text-body-sm">
                <span className="text-ink-faint capitalize">{turn.speaker}: </span>
                {turn.text}
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </Card>
  );
}
