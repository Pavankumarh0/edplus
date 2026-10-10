import Link from 'next/link';
import type { PrioritisableStudent } from '@eduplus/core';
import { Badge, EmptyState, LevelPill, TrendArrow, Usn } from './ui';

/**
 * The prioritised queue — the product's actual job.
 *
 * A real table with scope'd headers, not a div grid: this is tabular data and
 * screen readers should be able to navigate it as such.
 *
 * Numbered, because this genuinely is a ranked sequence. Nowhere else in the
 * UI uses numbered markers.
 */
export function PriorityQueue({
  rows,
  caption,
}: {
  rows: PrioritisableStudent[];
  caption?: string;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState title="Nobody is flagged yet">
        Upload attendance, assessment or submission data and the queue fills itself.
      </EmptyState>
    );
  }

  return (
    <div className="-mx-2 overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead>
          <tr className="text-label text-ink-muted border-hairline border-b">
            <th scope="col" className="px-2 py-2 text-left font-medium">
              #
            </th>
            <th scope="col" className="px-2 py-2 text-left font-medium">
              Student
            </th>
            <th scope="col" className="px-2 py-2 text-right font-medium">
              Score
            </th>
            <th scope="col" className="px-2 py-2 text-right font-medium">
              Trend
            </th>
            <th scope="col" className="px-2 py-2 text-left font-medium">
              Level
            </th>
            <th scope="col" className="px-2 py-2 text-left font-medium">
              Notes
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={row.usn}
              className="border-hairline hover:bg-surface-sunk/55 border-b transition-colors duration-150 last:border-0"
            >
              <td className="text-body-sm text-ink-faint px-2 py-3 tabular-nums">{index + 1}</td>

              <td className="px-2 py-3">
                <Link
                  href={`/students/${row.usn}`}
                  className="hover:decoration-ink/40 block underline decoration-transparent underline-offset-2 transition-colors"
                >
                  <span className="text-body block font-medium">{row.name ?? row.usn}</span>
                  <Usn>{row.usn}</Usn>
                </Link>
              </td>

              <td className="px-2 py-3 text-right">
                <span data-metric className="text-body font-semibold">
                  {row.snapshot.score}
                </span>
              </td>

              <td className="px-2 py-3 text-right">
                <TrendArrow delta={row.snapshot.scoreDelta} />
              </td>

              <td className="px-2 py-3">
                <LevelPill
                  level={row.snapshot.level}
                  insufficientData={row.snapshot.insufficientData}
                  escalated={row.snapshot.escalation !== null}
                  size="sm"
                />
              </td>

              <td className="px-2 py-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  {row.snapshot.escalation ? (
                    <Badge tone="lime" title={row.snapshot.escalation.reason}>
                      escalated
                    </Badge>
                  ) : null}
                  {row.snapshot.conflicts.length > 0 ? (
                    <Badge title={row.snapshot.conflicts[0]!.description}>
                      {row.snapshot.conflicts.length} conflict
                      {row.snapshot.conflicts.length === 1 ? '' : 's'}
                    </Badge>
                  ) : null}
                  {row.snapshot.dataGaps.length > 0 ? (
                    <Badge tone="nodata" title={row.snapshot.dataGaps.join(' ')}>
                      {row.snapshot.dataGaps.length} data gap
                      {row.snapshot.dataGaps.length === 1 ? '' : 's'}
                    </Badge>
                  ) : null}
                  {row.hasOpenIntervention ? <Badge>being supported</Badge> : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
