import Link from 'next/link';
import {
  INTERVENTION_STATUSES,
  INTERVENTION_TYPE_LABELS,
  type Intervention,
  type InterventionStatus,
} from '@eduplus/core';
import { getDb, listInterventions } from '@eduplus/core/repositories';
import { Badge, Card, EmptyState, Usn } from '@/components/ui';
import { InterventionCard } from '@/components/InterventionCard';

export const dynamic = 'force-dynamic';

const COLUMNS: { status: InterventionStatus; title: string; blurb: string }[] = [
  { status: 'proposed', title: 'Proposed', blurb: 'Suggested, waiting for you to approve' },
  { status: 'approved', title: 'Approved', blurb: 'Agreed, not started yet' },
  { status: 'in_progress', title: 'In progress', blurb: 'Happening now' },
  { status: 'completed', title: 'Completed', blurb: 'Outcome decided by the next upload' },
];

export default async function InterventionsPage() {
  const db = getDb();
  const all = await listInterventions(db);

  const byStatus = new Map<InterventionStatus, Intervention[]>();
  for (const status of INTERVENTION_STATUSES) byStatus.set(status, []);
  for (const intervention of all) {
    byStatus.get(intervention.status)?.push(intervention);
  }

  const cancelled = byStatus.get('cancelled') ?? [];
  const awaitingOutcome = (byStatus.get('completed') ?? []).filter((i) => i.outcome === null);

  return (
    <>
      <header className="mb-6">
        <h1 className="text-h1">Interventions</h1>
        <p className="text-body-sm text-ink-muted mt-1 max-w-[72ch]">
          {all.length === 0
            ? 'Nothing recorded yet.'
            : `${all.length} recorded. A completed intervention gets its outcome automatically when the next upload rescores the student — nothing here marks its own homework.`}
        </p>
      </header>

      {all.length === 0 ? (
        <EmptyState title="No interventions yet">
          Open a student and create one. An agent can propose interventions, but only you can
          approve them.
        </EmptyState>
      ) : (
        <>
          {awaitingOutcome.length > 0 ? (
            <Card className="mb-5">
              <p className="text-body-sm text-ink-muted">
                <span className="text-ink font-medium">
                  {awaitingOutcome.length} completed intervention
                  {awaitingOutcome.length === 1 ? '' : 's'} waiting on data.
                </span>{' '}
                Upload the next batch of academic records and the before/after comparison fills in
                on its own.
              </p>
            </Card>
          ) : null}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {COLUMNS.map((column) => {
              const items = byStatus.get(column.status) ?? [];
              return (
                <section key={column.status}>
                  <div className="mb-3">
                    <h2 className="text-h2 flex items-center gap-2">
                      {column.title}
                      <Badge>{items.length}</Badge>
                    </h2>
                    <p className="text-body-sm text-ink-faint mt-0.5">{column.blurb}</p>
                  </div>

                  <div className="space-y-3">
                    {items.length === 0 ? (
                      <p className="text-body-sm text-ink-faint border-hairline rounded-[var(--radius-control)] border border-dashed px-3 py-6 text-center">
                        Empty
                      </p>
                    ) : (
                      items.map((intervention) => (
                        <InterventionCard
                          key={intervention.interventionId}
                          intervention={intervention}
                        />
                      ))
                    )}
                  </div>
                </section>
              );
            })}
          </div>

          {cancelled.length > 0 ? (
            <section className="mt-8">
              <h2 className="text-h2 mb-3 flex items-center gap-2">
                Cancelled
                <Badge>{cancelled.length}</Badge>
              </h2>
              <ul className="space-y-2">
                {cancelled.map((intervention) => (
                  <li key={intervention.interventionId} className="text-body-sm text-ink-muted">
                    <Link href={`/students/${intervention.usn}`} className="hover:text-ink">
                      {INTERVENTION_TYPE_LABELS[intervention.type]} · <Usn>{intervention.usn}</Usn>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </>
  );
}
