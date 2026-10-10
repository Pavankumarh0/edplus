import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  INDICATOR_KEYS,
  INDICATOR_LABELS,
  INTERVENTION_TYPE_LABELS,
  LEVEL_PALETTE,
  PARENT_RESPONSE_LABELS,
  buildBeforeAfter,
} from '@eduplus/core';
import { getStudentDetail } from '@/lib/dashboard';
import {
  Badge,
  Card,
  CardTitle,
  IndicatorBand,
  LevelPill,
  Metric,
  Usn,
} from '@/components/ui';
import { RiskHistoryChart } from '@/components/RiskHistoryChart';
import { WhatIfPanel } from '@/components/WhatIfPanel';
import { StudentActions } from '@/components/StudentActions';

export const dynamic = 'force-dynamic';

export default async function StudentPage({ params }: { params: Promise<{ usn: string }> }) {
  const { usn } = await params;
  const data = await getStudentDetail(decodeURIComponent(usn).toUpperCase());
  if (!data) notFound();

  const {
    student, snapshot, rules, history, report, interventions, calls, tasks, parent, account,
    plan, adherence, activities,
  } = data;

  const settled = interventions.filter((i) => i.outcomeSnapshotId && i.outcome);
  const latestSettled = settled[0];
  const baseline = latestSettled
    ? history.find((s) => s.snapshotId === latestSettled.baselineSnapshotId)
    : undefined;
  const outcomeSnapshot = latestSettled
    ? history.find((s) => s.snapshotId === latestSettled.outcomeSnapshotId)
    : undefined;
  const beforeAfter =
    baseline && outcomeSnapshot ? buildBeforeAfter(baseline, outcomeSnapshot) : null;

  return (
    <>
      <nav className="mb-4">
        <Link
          href="/students"
          className="text-body-sm text-ink-muted hover:text-ink underline underline-offset-2"
        >
          All students
        </Link>
      </nav>

      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-h1">{student.name}</h1>
          <p className="text-body-sm text-ink-muted mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <Usn>{student.usn}</Usn>
            <span>
              Semester {student.semester} · Section {student.section}
            </span>
            <span>{student.department}</span>
          </p>
        </div>
        <StudentActions
          usn={student.usn}
          studentName={student.name}
          hasParentContact={Boolean(parent?.phone)}
          parentLanguage={parent?.preferredLanguage ?? 'en-IN'}
          hasSnapshot={snapshot !== null}
          missedTasks={adherence.overdue}
        />
      </header>

      {snapshot === null ? (
        <Card>
          <p className="text-body text-ink-muted">
            No risk snapshot yet. This student has {data.recordCount} academic record
            {data.recordCount === 1 ? '' : 's'}. Upload data and recompute to score them.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:gap-5">
          {/* ── The score, and why ──────────────────────────────────────── */}
          <Card hero className="lg:col-span-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div
                  data-metric
                  className="text-display"
                  style={{ color: LEVEL_PALETTE[snapshot.level].fg }}
                >
                  {snapshot.score}
                </div>
                <p className="text-body-sm text-ink-muted mt-1">
                  Risk score · higher means more risk
                </p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <LevelPill
                  level={snapshot.level}
                  insufficientData={snapshot.insufficientData}
                  escalated={snapshot.escalation !== null}
                />
                <span className="text-body-sm text-ink-faint">
                  rules v{snapshot.rulesVersion}
                </span>
              </div>
            </div>

            {/* Escalation gets the lime strip: the level is higher than the
                number suggests, and that must catch the eye. */}
            {snapshot.escalation ? (
              <p className="bg-lime text-ink text-body-sm mt-5 rounded-[var(--radius-control)] px-3 py-2">
                {snapshot.escalation.reason}
              </p>
            ) : null}

            {snapshot.insufficientData ? (
              <p
                className="text-body-sm mt-5 rounded-[var(--radius-control)] px-3 py-2"
                style={{
                  color: 'var(--color-level-nodata)',
                  background: 'var(--color-level-nodata-fill)',
                }}
              >
                Only {Object.values(snapshot.indicators).filter((i) => i.available).length} of 4
                indicators could be scored, so this score is not yet reliable. It needs data, not
                an intervention.
              </p>
            ) : null}

            <dl className="border-hairline mt-6 grid grid-cols-3 gap-4 border-t pt-5">
              <div>
                <dt className="text-body-sm text-ink-muted">Academic health</dt>
                <dd data-metric className="text-body mt-0.5 font-semibold">
                  {snapshot.academicComposite === null ? '—' : `${snapshot.academicComposite}%`}
                </dd>
              </div>
              <div>
                <dt className="text-body-sm text-ink-muted">Confidence</dt>
                <dd data-metric className="text-body mt-0.5 font-semibold">
                  {Math.round(snapshot.confidence * 100)}%
                </dd>
              </div>
              <div>
                <dt className="text-body-sm text-ink-muted">Change</dt>
                <dd data-metric className="text-body mt-0.5 font-semibold">
                  {snapshot.scoreDelta === null
                    ? '—'
                    : `${snapshot.scoreDelta > 0 ? '+' : ''}${snapshot.scoreDelta}`}
                </dd>
              </div>
            </dl>
          </Card>

          {/* ── Indicator breakdown ─────────────────────────────────────── */}
          <Card className="lg:col-span-7">
            <CardTitle hint="Every indicator, shown against its own thresholds">
              Why this score
            </CardTitle>
            <div className="divide-hairline divide-y">
              {INDICATOR_KEYS.map((key) => {
                const indicator = snapshot.indicators[key];
                if (!indicator) return null;
                return (
                  <IndicatorBand
                    key={key}
                    indicator={indicator}
                    rule={rules.indicators[key]}
                    level={snapshot.level}
                  />
                );
              })}
            </div>

            {snapshot.conflicts.length > 0 ? (
              <div className="border-hairline mt-5 border-t pt-5">
                <h3 className="text-h2 mb-2">Conflicting indicators</h3>
                <ul className="space-y-2">
                  {snapshot.conflicts.map((conflict, index) => (
                    <li key={index} className="text-body-sm text-ink-muted">
                      {conflict.description}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {snapshot.dataGaps.length > 0 ? (
              <div className="border-hairline mt-5 border-t pt-5">
                <h3 className="text-h2 mb-2 flex items-center gap-2">
                  Data gaps
                  <Badge tone="nodata">{snapshot.dataGaps.length}</Badge>
                </h3>
                <ul className="space-y-1">
                  {snapshot.dataGaps.map((gap, index) => (
                    <li key={index} className="text-body-sm text-ink-muted">
                      {gap}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Card>

          {/* ── History ─────────────────────────────────────────────────── */}
          <Card className="lg:col-span-7">
            <CardTitle hint={`${history.length} snapshot${history.length === 1 ? '' : 's'}`}>
              Progress history
            </CardTitle>
            <RiskHistoryChart
              history={history}
              cutoffs={rules.levelCutoffs}
              baselineSnapshotId={latestSettled?.baselineSnapshotId}
              outcomeSnapshotId={latestSettled?.outcomeSnapshotId}
            />

            {beforeAfter && latestSettled ? (
              <div className="border-hairline mt-5 border-t pt-5">
                <h3 className="text-h2 mb-3">
                  Before and after · {INTERVENTION_TYPE_LABELS[latestSettled.type]}
                </h3>
                <div className="flex items-end gap-8">
                  <Metric
                    value={beforeAfter.before.score}
                    label={`Before · ${beforeAfter.before.at.slice(0, 10)}`}
                  />
                  <span aria-hidden="true" className="text-ink-faint pb-6 text-2xl">
                    →
                  </span>
                  <Metric
                    value={beforeAfter.after.score}
                    label={`After · ${beforeAfter.after.at.slice(0, 10)}`}
                    tone={beforeAfter.after.level as never}
                  />
                  <div className="pb-6">
                    <Badge tone={beforeAfter.outcome === 'improved' ? 'lime' : 'neutral'}>
                      {beforeAfter.outcome.replace('_', ' ')}
                    </Badge>
                  </div>
                </div>
              </div>
            ) : null}
          </Card>

          {/* ── Projection / what-if ────────────────────────────────────── */}
          <Card className="lg:col-span-5">
            <CardTitle>Projection</CardTitle>
            <WhatIfPanel snapshot={snapshot} rules={rules} projection={data.projection} />
          </Card>

          {/* ── Claude's report ─────────────────────────────────────────── */}
          <Card className="lg:col-span-7">
            <CardTitle
              hint={report ? `${report.model}` : undefined}
            >
              Report
            </CardTitle>

            {!report ? (
              <p className="text-body-sm text-ink-muted">
                No report yet. Generate one from the actions above.
              </p>
            ) : (
              <>
                {data.reportIsStale ? (
                  <p
                    className="text-body-sm mb-4 rounded-[var(--radius-control)] px-3 py-2"
                    style={{
                      color: 'var(--color-level-watch)',
                      background: 'var(--color-level-watch-fill)',
                    }}
                  >
                    This report explains an earlier snapshot. The numbers have moved since —
                    regenerate it to match the current score.
                  </p>
                ) : null}

                <p className="text-body">{report.body.summary}</p>

                {report.body.strengths.length > 0 ? (
                  <div className="mt-5">
                    <h3 className="text-h2 mb-2">Working well</h3>
                    <ul className="list-disc space-y-1 pl-5">
                      {report.body.strengths.map((item, index) => (
                        <li key={index} className="text-body-sm">
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {report.body.concerns.length > 0 ? (
                  <div className="mt-5">
                    <h3 className="text-h2 mb-2">Concerns</h3>
                    <ul className="space-y-3">
                      {report.body.concerns.map((concern, index) => (
                        <li key={index}>
                          <p className="text-body font-medium">{concern.indicator}</p>
                          <p className="text-body-sm text-ink-muted">{concern.detail}</p>
                          <p className="text-body-sm text-ink-muted mt-0.5">
                            {concern.whyItMatters}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {report.body.actions.length > 0 ? (
                  <div className="mt-5">
                    <h3 className="text-h2 mb-2">Next steps</h3>
                    <ul className="list-disc space-y-1 pl-5">
                      {report.body.actions.map((action, index) => (
                        <li key={index} className="text-body-sm">
                          {action}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {report.body.dataCaveats.length > 0 ? (
                  <div className="border-hairline mt-5 border-t pt-4">
                    <ul className="space-y-1">
                      {report.body.dataCaveats.map((caveat, index) => (
                        <li key={index} className="text-body-sm text-ink-faint">
                          {caveat}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </>
            )}
          </Card>

          {/* ── Interventions timeline ──────────────────────────────────── */}
          <Card className="lg:col-span-5">
            <CardTitle hint={`${interventions.length}`}>Interventions</CardTitle>
            {interventions.length === 0 ? (
              <p className="text-body-sm text-ink-muted">
                Nothing recorded. Create one from the actions above.
              </p>
            ) : (
              <ol className="space-y-4">
                {interventions.map((intervention) => (
                  <li key={intervention.interventionId} className="border-hairline border-l-2 pl-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-body font-medium">
                        {INTERVENTION_TYPE_LABELS[intervention.type]}
                      </span>
                      <Badge>{intervention.status.replace('_', ' ')}</Badge>
                      {intervention.outcome ? (
                        <Badge tone={intervention.outcome === 'improved' ? 'lime' : 'neutral'}>
                          {intervention.outcome.replace('_', ' ')}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="text-body-sm text-ink-muted mt-1">{intervention.reason}</p>
                    {intervention.outcomeScore !== null ? (
                      <p className="text-body-sm mt-1 tabular-nums">
                        {intervention.baselineScore} → {intervention.outcomeScore}
                      </p>
                    ) : null}
                    {intervention.notes ? (
                      <p className="text-body-sm text-ink-faint mt-1">{intervention.notes}</p>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}

            {tasks.length > 0 ? (
              <div className="border-hairline mt-5 border-t pt-5">
                <h3 className="text-h2 mb-2">Recovery tasks</h3>
                <ul className="space-y-2">
                  {tasks.map((task) => (
                    <li key={task.taskId} className="text-body-sm flex items-start gap-2">
                      <span aria-hidden="true" className="text-ink-faint">
                        {task.done ? '☑' : '☐'}
                      </span>
                      <span className={task.done ? 'text-ink-faint line-through' : ''}>
                        {task.title}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Card>

          {/* ── Planly: the plan, and whether it is being followed ──────── */}
          <Card className="lg:col-span-7">
            <CardTitle hint={plan ? `${plan.weeks}-week plan` : undefined}>
              Study plan
            </CardTitle>

            {!plan ? (
              <p className="text-body-sm text-ink-muted">
                {student.name.split(' ')[0]} has not asked Planly for a plan yet. It is offered
                in the app — students build their own, which is rather the point.
              </p>
            ) : (
              <>
                <p className="text-body font-medium">{plan.goal}</p>
                <p className="text-body-sm text-ink-muted mt-2">{plan.rationale}</p>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {plan.focus.map((key) => (
                    <Badge key={key}>{INDICATOR_LABELS[key]}</Badge>
                  ))}
                </div>

                {plan.milestones.length > 0 ? (
                  <ul className="border-hairline mt-4 space-y-2 border-t pt-4">
                    {plan.milestones.map((milestone, index) => (
                      <li key={index} className="text-body-sm">
                        <span className="font-medium">{milestone.title}</span>
                        <span className="text-ink-muted"> — {milestone.target}</span>
                        <span className="text-ink-faint"> by {milestone.byDate}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            )}
          </Card>

          {/* ── Effort, reported beside the score and never inside it ───── */}
          <Card className="lg:col-span-5">
            <CardTitle hint="Not part of the risk score">Effort</CardTitle>

            {adherence.rate === null ? (
              <p className="text-body-sm text-ink-muted">
                Nothing scheduled yet, so there is no effort to measure.
              </p>
            ) : (
              <>
                <div className="flex items-end gap-8">
                  <Metric
                    value={`${Math.round(adherence.rate * 100)}%`}
                    label={`${adherence.done} of ${adherence.due} tasks done`}
                    tone={adherence.rate >= 0.7 ? 'stable' : adherence.rate >= 0.4 ? 'watch' : 'critical'}
                  />
                  <Metric value={adherence.streak} label="day streak" />
                  {adherence.overdue > 0 ? (
                    <Metric value={adherence.overdue} label="overdue" tone="at_risk" />
                  ) : null}
                </div>

                <p className="text-body-sm text-ink-muted mt-4">
                  {adherence.rate >= 0.7
                    ? 'Doing the work. If the score has not moved yet, it will at the next upload — give it time rather than escalating.'
                    : adherence.rate >= 0.4
                      ? 'Partly keeping up. Worth asking which tasks are not landing before adding more.'
                      : 'Not doing the plan. That is a different conversation from being behind academically — find out why before escalating to a parent call.'}
                </p>
              </>
            )}

            {activities.length > 0 ? (
              <div className="border-hairline mt-4 border-t pt-4">
                <h3 className="text-h2 mb-2">Practice</h3>
                <ul className="space-y-1.5">
                  {activities.slice(0, 4).map((activity) => (
                    <li key={activity.activityId} className="text-body-sm flex items-center gap-2">
                      <Badge>{activity.kind}</Badge>
                      <span className="truncate">{activity.title}</span>
                      <span className="text-ink-faint ml-auto shrink-0 tabular-nums">
                        {activity.score === null ? 'not attempted' : `${activity.score}/${activity.outOf}`}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Card>

          {/* ── Student app account ─────────────────────────────────────── */}
          <Card className="lg:col-span-12">
            <CardTitle hint="Mobile app">Student account</CardTitle>

            {!account.exists ? (
              <p className="text-body-sm text-ink-muted">
                No app account yet. {student.name} cannot sign in to the student app until one is
                created and linked to this USN.
              </p>
            ) : (
              <div className="flex flex-wrap items-start gap-x-10 gap-y-4">
                <div>
                  <p className="text-body-sm text-ink-muted">Signs in with</p>
                  <p className="text-body mt-0.5 font-medium">{account.email}</p>
                </div>

                <div>
                  <p className="text-body-sm text-ink-muted">Last signed in</p>
                  <p className="text-body mt-0.5 font-medium">
                    {account.lastSignInAt
                      ? account.lastSignInAt.slice(0, 16).replace('T', ' ')
                      : 'Never'}
                  </p>
                </div>

                <div>
                  <p className="text-body-sm text-ink-muted">Status</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {account.disabled ? (
                      <Badge tone="nodata">disabled</Badge>
                    ) : account.lastSignInAt ? (
                      <Badge tone="lime">active</Badge>
                    ) : (
                      <Badge>not opened yet</Badge>
                    )}
                    {/* Without the usn claim the app signs in and then shows
                        nothing, because the security rules deny every read. */}
                    {!account.claimsOk ? (
                      <Badge tone="nodata" title="Account is missing the role/usn claim">
                        not linked to this USN
                      </Badge>
                    ) : null}
                  </div>
                </div>

                <p className="text-body-sm text-ink-faint max-w-[44ch]">
                  Students set their own password from the Account screen in the app. Faculty
                  cannot see it.
                </p>
              </div>
            )}
          </Card>

          {/* ── Parent calls ────────────────────────────────────────────── */}
          <Card className="lg:col-span-12">
            <CardTitle hint="Faculty only">Parent calls</CardTitle>
            {calls.length === 0 ? (
              <p className="text-body-sm text-ink-muted">
                {parent?.phone
                  ? 'No calls yet.'
                  : 'No parent contact on record, so no call can be placed.'}
              </p>
            ) : (
              <ul className="space-y-4">
                {calls.map((call) => (
                  <li key={call.callId} className="border-hairline rounded-[var(--radius-control)] border p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-body font-medium capitalize">
                        {call.purpose.replace('_', ' ')}
                      </span>
                      <Badge>{call.status}</Badge>
                      <Badge>{call.provider}</Badge>
                      {call.parentResponse ? (
                        <Badge tone="lime">{PARENT_RESPONSE_LABELS[call.parentResponse]}</Badge>
                      ) : null}
                      <span className="text-body-sm text-ink-faint ml-auto">
                        {call.createdAt.slice(0, 16).replace('T', ' ')}
                      </span>
                    </div>

                    <p className="text-body-sm text-ink-muted mt-2">
                      <span className="text-ink font-medium">Approved message: </span>
                      {call.approvedMessage}
                    </p>

                    {call.summary ? (
                      <p className="text-body-sm mt-2">{call.summary}</p>
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
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
