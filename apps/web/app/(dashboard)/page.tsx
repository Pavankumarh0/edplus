import Link from 'next/link';
import {
  INSUFFICIENT_DATA_PALETTE,
  INTERVENTION_TYPE_LABELS,
  LEVEL_PALETTE,
  PARENT_RESPONSE_LABELS,
} from '@eduplus/core';
import { getOverview } from '@/lib/dashboard';
import {
  Badge,
  Button,
  Card,
  CardTitle,
  EmptyState,
  LevelPill,
  Metric,
  PillBarChart,
  Usn,
} from '@/components/ui';
import { PriorityQueue } from '@/components/PriorityQueue';

export const dynamic = 'force-dynamic';

export default async function OverviewPage() {
  const data = await getOverview();

  const hasStudents = data.totalStudents > 0;

  return (
    <>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-h1">Overview</h1>
          <p className="text-body-sm text-ink-muted mt-1">
            {hasStudents
              ? `${data.scoredStudents} of ${data.totalStudents} students scored under rules v${data.rules.rulesVersion}.`
              : 'No academic data yet.'}
          </p>
        </div>
        <Link href="/upload">
          <Button>Upload academic data</Button>
        </Link>
      </header>

      {!hasStudents ? (
        <EmptyState
          title="No students yet"
          action={
            <Link href="/upload">
              <Button>Upload a CSV</Button>
            </Link>
          }
        >
          Upload attendance, assessment or submission data. EduPlus maps the columns, scores every
          student against the risk rules, and builds the priority queue for you.
        </EmptyState>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:gap-5">
          {/* ── Level counts, with the pill bar chart ───────────────────── */}
          <Card className="lg:col-span-5">
            <CardTitle hint={`v${data.rules.rulesVersion}`}>Risk distribution</CardTitle>

            <div className="mb-5 flex items-end gap-7">
              <Metric
                value={data.counts.critical ?? 0}
                label="Critical"
                tone="critical"
              />
              <Metric value={data.counts.at_risk ?? 0} label="At Risk" tone="at_risk" />
              <Metric value={data.counts.watch ?? 0} label="Watch" tone="watch" />
            </div>

            <PillBarChart
              rows={[
                { label: 'Critical', value: data.counts.critical ?? 0, color: LEVEL_PALETTE.critical.fg },
                { label: 'At Risk', value: data.counts.at_risk ?? 0, color: LEVEL_PALETTE.at_risk.fg },
                { label: 'Watch', value: data.counts.watch ?? 0, color: LEVEL_PALETTE.watch.fg },
                { label: 'Stable', value: data.counts.stable ?? 0, color: LEVEL_PALETTE.stable.fg },
                {
                  label: 'Insufficient',
                  value: data.counts.insufficient_data ?? 0,
                  color: INSUFFICIENT_DATA_PALETTE.fg,
                },
              ]}
            />

            <p className="text-body-sm text-ink-faint mt-4">
              Insufficient data counts students scored from too little evidence to trust. They
              need data entry, not an intervention.
            </p>
          </Card>

          {/* ── Open work ───────────────────────────────────────────────── */}
          <Card className="lg:col-span-3">
            <CardTitle>Open work</CardTitle>
            <div className="space-y-5">
              <Metric
                value={data.openInterventions.length}
                label={`Intervention${data.openInterventions.length === 1 ? '' : 's'} in progress`}
              />
              <Metric
                value={data.todaysCalls.length}
                label={`Parent call${data.todaysCalls.length === 1 ? '' : 's'} today`}
              />
            </div>

            {data.openInterventions.length > 0 ? (
              <ul className="mt-5 space-y-2">
                {data.openInterventions.slice(0, 4).map((intervention) => (
                  <li key={intervention.interventionId} className="text-body-sm">
                    <Link
                      href={`/students/${intervention.usn}`}
                      className="hover:text-ink text-ink-muted"
                    >
                      <span className="text-ink font-medium">
                        {INTERVENTION_TYPE_LABELS[intervention.type]}
                      </span>{' '}
                      · <Usn>{intervention.usn}</Usn>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-body-sm text-ink-faint mt-5">
                Nothing open. Approve an intervention from a student&rsquo;s page.
              </p>
            )}
          </Card>

          {/* ── Recent uploads ──────────────────────────────────────────── */}
          <Card className="lg:col-span-4">
            <CardTitle>Recent uploads</CardTitle>
            {data.recentUploads.length === 0 ? (
              <p className="text-body-sm text-ink-faint">No uploads yet.</p>
            ) : (
              <ul className="space-y-3">
                {data.recentUploads.map((upload) => (
                  <li key={upload.uploadId} className="text-body-sm">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-ink truncate font-medium">{upload.fileName}</span>
                      <span className="text-ink-faint shrink-0 tabular-nums">
                        {upload.rowsOk} ok
                      </span>
                    </div>
                    <div className="text-ink-faint mt-0.5 flex items-center gap-2">
                      <span>{upload.recordType}</span>
                      {upload.rowsRejected > 0 ? (
                        <Badge tone="nodata">{upload.rowsRejected} rejected</Badge>
                      ) : null}
                      {upload.mappingSource === 'claude' ? <Badge>Claude mapped</Badge> : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* ── The priority queue — widest card, because it is the job ── */}
          <Card className="lg:col-span-8">
            <CardTitle hint="Level, then score, then worsening, then unattended">
              Needs attention first
            </CardTitle>
            <PriorityQueue rows={data.queue} caption="Students who need attention, most urgent first" />
            <div className="mt-4">
              <Link
                href="/students"
                className="text-body-sm text-ink-muted hover:text-ink underline underline-offset-2"
              >
                See all students
              </Link>
            </div>
          </Card>

          {/* ── Data-entry queue — the missing-data edge case, visible ──── */}
          <Card className="lg:col-span-4">
            <CardTitle hint="Not an intervention — a data problem">Waiting on data</CardTitle>
            {data.dataEntryQueue.length === 0 ? (
              <p className="text-body-sm text-ink-faint">
                Every student has enough data to score. Good.
              </p>
            ) : (
              <ul className="space-y-3">
                {data.dataEntryQueue.map((row) => (
                  <li key={row.usn}>
                    <Link href={`/students/${row.usn}`} className="group block">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-body group-hover:underline">
                          {row.name ?? row.usn}
                        </span>
                        <LevelPill
                          level={row.snapshot.level}
                          insufficientData={row.snapshot.insufficientData}
                          size="sm"
                        />
                      </div>
                      <p className="text-body-sm text-ink-muted mt-1">
                        {row.snapshot.dataGaps[0]}
                        {row.snapshot.dataGaps.length > 1
                          ? ` +${row.snapshot.dataGaps.length - 1} more`
                          : ''}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* ── Today's calls ───────────────────────────────────────────── */}
          {data.todaysCalls.length > 0 ? (
            <Card className="lg:col-span-12">
              <CardTitle>Parent calls today</CardTitle>
              <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {data.todaysCalls.map((call) => (
                  <li
                    key={call.callId}
                    className="border-hairline rounded-[var(--radius-control)] border p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <Link href={`/students/${call.usn}`} className="text-body font-medium hover:underline">
                        <Usn>{call.usn}</Usn>
                      </Link>
                      <Badge>{call.status}</Badge>
                    </div>
                    <p className="text-body-sm text-ink-muted mt-1 capitalize">{call.purpose}</p>
                    {call.parentResponse ? (
                      <p className="text-body-sm mt-1 font-medium">
                        {PARENT_RESPONSE_LABELS[call.parentResponse]}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      )}
    </>
  );
}
