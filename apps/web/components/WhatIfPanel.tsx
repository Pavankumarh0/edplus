'use client';

import { useMemo, useState } from 'react';
import {
  LEVEL_PALETTE,
  whatIf,
  type IndicatorKey,
  type Projection,
  type RiskRules,
  type RiskSnapshot,
} from '@eduplus/core';
import { LevelPill, cx } from './ui';

const SLIDERS: { key: IndicatorKey; label: string }[] = [
  { key: 'attendance', label: 'Attendance' },
  { key: 'assessment', label: 'Assessment average' },
  { key: 'submission', label: 'Submission completion' },
];

/**
 * Linear projection plus a what-if slider.
 *
 * Both run the real scoring path from `@eduplus/core` in the browser — the
 * same `bandSubScore` and the same normalised weights the engine uses on the
 * server. That is deliberate: a slider that approximated the model would
 * quietly disagree with what a real upload produces, which is worse than
 * having no slider.
 *
 * The caveat is rendered next to the number, never behind a tooltip. A
 * projection whose caveat is hidden on hover is a projection presented as fact.
 */
export function WhatIfPanel({
  snapshot,
  rules,
  projection,
}: {
  snapshot: RiskSnapshot;
  rules: RiskRules;
  projection: Projection | null;
}) {
  const [active, setActive] = useState<IndicatorKey>('attendance');
  const [value, setValue] = useState<number | null>(null);

  const current = snapshot.indicators[active];
  const rule = rules.indicators[active];

  // Default the slider to the student's own value, or to the critical floor
  // when the indicator has no data — asking "what if we had data" starts from
  // the worst case rather than from an invented one.
  const start = current?.value ?? rule?.criticalAt ?? 0;
  const sliderValue = value ?? start;

  const result = useMemo(
    () => (value === null ? null : whatIf(snapshot, rules, { [active]: value })),
    [snapshot, rules, active, value],
  );

  return (
    <div>
      {/* ── Projection ──────────────────────────────────────────────────── */}
      {projection ? (
        <div className="mb-5">
          <div className="flex items-baseline gap-3">
            <span data-metric className="text-metric text-ink-faint">
              {projection.projectedScore}
            </span>
            <div>
              <LevelPill level={projection.projectedLevel} size="sm" />
              <p className="text-body-sm text-ink-muted mt-1 capitalize">
                {projection.direction} · {projection.slopePerSnapshot > 0 ? '+' : ''}
                {projection.slopePerSnapshot} per snapshot
              </p>
            </div>
          </div>
          <p className="text-body-sm text-ink-faint mt-2">{projection.caveat}</p>
        </div>
      ) : (
        <p className="text-body-sm text-ink-muted mb-5">
          A projection needs at least two snapshots. Upload the next batch of data.
        </p>
      )}

      {/* ── What-if ─────────────────────────────────────────────────────── */}
      <div className="border-hairline border-t pt-5">
        <h3 className="text-h2 mb-3">What if</h3>

        <div className="bg-surface-sunk mb-4 flex flex-wrap gap-1 rounded-[var(--radius-pill)] p-1">
          {SLIDERS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => {
                setActive(item.key);
                setValue(null);
              }}
              aria-pressed={active === item.key}
              className={cx(
                'text-label min-h-[32px] rounded-[var(--radius-pill)] px-3 transition-colors duration-150',
                active === item.key ? 'bg-lime text-ink' : 'text-ink-muted hover:text-ink',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>

        <label className="block">
          <span className="text-body-sm text-ink-muted">
            {SLIDERS.find((s) => s.key === active)?.label} reaches
          </span>
          <span className="text-body ml-2 font-semibold tabular-nums">{sliderValue}%</span>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={sliderValue}
            onChange={(event) => setValue(Number(event.target.value))}
            className="accent-ink mt-2 w-full"
            aria-label={`What if ${active} reaches this value`}
          />
        </label>

        <div className="mt-4 flex items-center gap-4">
          <div>
            <p className="text-body-sm text-ink-muted">Now</p>
            <div className="flex items-baseline gap-2">
              <span data-metric className="text-body font-semibold">
                {snapshot.score}
              </span>
              <LevelPill
                level={snapshot.level}
                insufficientData={snapshot.insufficientData}
                size="sm"
              />
            </div>
          </div>

          <span aria-hidden="true" className="text-ink-faint">
            →
          </span>

          <div>
            <p className="text-body-sm text-ink-muted">Would be</p>
            <div className="flex items-baseline gap-2">
              <span
                data-metric
                className="text-body font-semibold"
                style={result ? { color: LEVEL_PALETTE[result.level].fg } : undefined}
              >
                {result ? result.score : '—'}
              </span>
              {result ? <LevelPill level={result.level} size="sm" /> : null}
            </div>
          </div>

          {result && result.scoreDelta !== 0 ? (
            <span
              className="text-body-sm ml-auto font-medium"
              style={{
                color:
                  result.scoreDelta < 0 ? LEVEL_PALETTE.stable.fg : LEVEL_PALETTE.critical.fg,
              }}
            >
              {result.scoreDelta > 0 ? '+' : ''}
              {result.scoreDelta}
            </span>
          ) : null}
        </div>

        {result ? (
          <p className="text-body-sm text-ink-faint mt-3">{result.caveat}</p>
        ) : (
          <p className="text-body-sm text-ink-faint mt-3">
            Drag the slider to see what the current rules would score.
          </p>
        )}
      </div>
    </div>
  );
}
