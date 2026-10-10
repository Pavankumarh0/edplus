'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import {
  DEFAULT_RISK_RULES,
  INDICATOR_KEYS,
  INDICATOR_LABELS,
  LEVEL_PALETTE,
  RISK_LEVELS,
  bandSubScore,
  type IndicatorKey,
  type IndicatorRule,
  type RiskRules,
} from '@eduplus/core';
import { Badge, Button, Card, CardTitle, LevelPill } from './ui';

/** Plain-language note per indicator, so the numbers are not bare. */
const NOTES: Record<IndicatorKey, string> = {
  attendance:
    'The institutional eligibility bar is 75%. The threshold here sits above it on purpose — a system that waits until a student is already ineligible is not early warning.',
  assessment:
    'The pass mark is 40%. Again the threshold sits above it: barely passing is not safe.',
  submission: 'Missed submissions are the earliest signal of a student disengaging.',
  trend:
    'A signed change in academic health, in percentage points, since the previous snapshot. A fall of 12 points is maximum concern.',
};

export function RulesEditor({
  rules: initial,
  studentCount,
}: {
  rules: RiskRules;
  studentCount: number;
}) {
  const router = useRouter();
  const [rules, setRules] = useState<RiskRules>(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const dirty = useMemo(
    () => JSON.stringify({ ...rules, rulesVersion: 0 }) !== JSON.stringify({ ...initial, rulesVersion: 0 }),
    [rules, initial],
  );

  const weightTotal = INDICATOR_KEYS.reduce(
    (sum, key) => sum + (rules.indicators[key]?.weight ?? 0),
    0,
  );

  function setIndicator(key: IndicatorKey, patch: Partial<IndicatorRule>) {
    setRules((current) => ({
      ...current,
      indicators: {
        ...current.indicators,
        [key]: { ...current.indicators[key]!, ...patch },
      },
    }));
  }

  async function save(recalculateAll: boolean) {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch('/api/rules', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          indicators: rules.indicators,
          levelCutoffs: rules.levelCutoffs,
          minIndicatorsForScore: rules.minIndicatorsForScore,
          escalation: rules.escalation,
          recalculateAll,
        }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? 'Could not save.');
      setMessage({ kind: 'ok', text: json.message as string });
      router.refresh();
    } catch (caught) {
      setMessage({
        kind: 'error',
        text: caught instanceof Error ? caught.message : 'Could not save.',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/* ── Indicators ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {INDICATOR_KEYS.map((key) => {
          const rule = rules.indicators[key]!;
          const invalid = rule.threshold <= rule.criticalAt;
          const unit = rule.unit === 'percent' ? '%' : ' pts';

          return (
            <Card key={key}>
              <CardTitle hint={`weight ${rule.weight}`}>{INDICATOR_LABELS[key]}</CardTitle>

              <p className="text-body-sm text-ink-muted mb-4">{NOTES[key]}</p>

              <div className="grid grid-cols-2 gap-3">
                <NumberField
                  label={`Threshold (no risk at or above)`}
                  value={rule.threshold}
                  onChange={(v) => setIndicator(key, { threshold: v })}
                  suffix={unit}
                />
                <NumberField
                  label="Critical floor (max risk at or below)"
                  value={rule.criticalAt}
                  onChange={(v) => setIndicator(key, { criticalAt: v })}
                  suffix={unit}
                />
                <NumberField
                  label="Weight"
                  value={rule.weight}
                  step={0.05}
                  min={0}
                  max={1}
                  onChange={(v) => setIndicator(key, { weight: v })}
                />
                <NumberField
                  label="Minimum records"
                  value={rule.minRecords}
                  step={1}
                  min={0}
                  onChange={(v) => setIndicator(key, { minRecords: Math.round(v) })}
                />
              </div>

              {invalid ? (
                <p
                  className="text-body-sm mt-3 rounded-[var(--radius-control)] px-3 py-2"
                  style={{
                    color: 'var(--color-level-critical)',
                    background: 'var(--color-level-critical-fill)',
                  }}
                >
                  The threshold must be greater than the critical floor.
                </p>
              ) : (
                <BandPreview rule={rule} unit={unit} />
              )}
            </Card>
          );
        })}
      </div>

      {/* ── Levels ───────────────────────────────────────────────────────── */}
      <Card className="mt-4">
        <CardTitle hint="Score 0–100, higher means more risk">Level cut-offs</CardTitle>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <NumberField
            label="Watch at or above"
            value={rules.levelCutoffs.watch}
            onChange={(v) =>
              setRules((c) => ({ ...c, levelCutoffs: { ...c.levelCutoffs, watch: v } }))
            }
          />
          <NumberField
            label="At Risk at or above"
            value={rules.levelCutoffs.atRisk}
            onChange={(v) =>
              setRules((c) => ({ ...c, levelCutoffs: { ...c.levelCutoffs, atRisk: v } }))
            }
          />
          <NumberField
            label="Critical at or above"
            value={rules.levelCutoffs.critical}
            onChange={(v) =>
              setRules((c) => ({ ...c, levelCutoffs: { ...c.levelCutoffs, critical: v } }))
            }
          />
        </div>

        <div className="mt-4 flex h-7 overflow-hidden rounded-[var(--radius-pill)]">
          {RISK_LEVELS.map((level) => {
            const start =
              level === 'stable'
                ? 0
                : level === 'watch'
                  ? rules.levelCutoffs.watch
                  : level === 'at_risk'
                    ? rules.levelCutoffs.atRisk
                    : rules.levelCutoffs.critical;
            const end =
              level === 'stable'
                ? rules.levelCutoffs.watch
                : level === 'watch'
                  ? rules.levelCutoffs.atRisk
                  : level === 'at_risk'
                    ? rules.levelCutoffs.critical
                    : 100;
            const width = Math.max(0, end - start);
            return (
              <span
                key={level}
                className="text-[11px] font-medium leading-7 text-center"
                style={{
                  width: `${width}%`,
                  background: LEVEL_PALETTE[level].fill,
                  color: LEVEL_PALETTE[level].fg,
                }}
              >
                {width > 12 ? LEVEL_PALETTE[level].label : ''}
              </span>
            );
          })}
        </div>
      </Card>

      {/* ── Data sufficiency and escalation ─────────────────────────────── */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>Data sufficiency</CardTitle>
          <p className="text-body-sm text-ink-muted mb-4">
            How many <strong>academic</strong> indicators must be scoreable before a score is
            trusted. Below this the student is flagged &ldquo;Insufficient data&rdquo; — they need
            data entry, not an intervention. Trend does not count here, because it is derived from
            the other three.
          </p>
          <NumberField
            label="Minimum academic indicators"
            value={rules.minIndicatorsForScore}
            step={1}
            min={1}
            max={3}
            onChange={(v) =>
              setRules((c) => ({ ...c, minIndicatorsForScore: Math.round(v) }))
            }
          />
        </Card>

        <Card>
          <CardTitle>Escalation</CardTitle>
          <p className="text-body-sm text-ink-muted mb-4">
            Stops one catastrophic indicator being averaged away. A student at 96% attendance and
            18% marks lands mid-scale, because good attendance dilutes a failing grade. When any
            single academic indicator reaches the sub-score below, the <em>level</em> is raised —
            the score itself is never altered.
          </p>

          <label className="text-body-sm mb-4 flex items-center gap-2">
            <input
              type="checkbox"
              checked={rules.escalation.enabled}
              onChange={(e) =>
                setRules((c) => ({
                  ...c,
                  escalation: { ...c.escalation, enabled: e.target.checked },
                }))
              }
              className="accent-ink size-4"
            />
            Enabled
          </label>

          <div className="grid grid-cols-2 gap-3">
            <NumberField
              label="Sub-score that triggers it"
              value={rules.escalation.singleIndicatorSubScore}
              onChange={(v) =>
                setRules((c) => ({
                  ...c,
                  escalation: { ...c.escalation, singleIndicatorSubScore: v },
                }))
              }
            />
            <label className="block">
              <span className="text-label text-ink-muted">Raise level to at least</span>
              <select
                value={rules.escalation.minimumLevel}
                onChange={(e) =>
                  setRules((c) => ({
                    ...c,
                    escalation: { ...c.escalation, minimumLevel: e.target.value as never },
                  }))
                }
                className="border-hairline text-body mt-1.5 min-h-[40px] w-full rounded-[var(--radius-control)] border bg-white px-2"
              >
                {RISK_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {LEVEL_PALETTE[level].label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </Card>
      </div>

      {/* ── Save ─────────────────────────────────────────────────────────── */}
      <Card className="mt-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => void save(true)} disabled={busy || !dirty}>
            {busy ? 'Saving and rescoring…' : `Save and recalculate all ${studentCount}`}
          </Button>
          <Button variant="secondary" onClick={() => void save(false)} disabled={busy || !dirty}>
            Save without recalculating
          </Button>
          <Button
            variant="ghost"
            onClick={() => setRules({ ...DEFAULT_RISK_RULES, rulesVersion: rules.rulesVersion })}
            disabled={busy}
          >
            Reset to defaults
          </Button>

          <span className="text-body-sm text-ink-faint ml-auto">
            Weights total {weightTotal.toFixed(2)}
            {Math.abs(weightTotal - 1) > 0.001 ? ' — normalised at scoring time' : ''}
          </span>
        </div>

        {!dirty ? (
          <p className="text-body-sm text-ink-faint mt-3">No changes yet.</p>
        ) : (
          <p className="text-body-sm text-ink-muted mt-3">
            Saving bumps the rules version. Recalculating brings every student onto it — without
            that, scores from different versions are not comparable.
          </p>
        )}

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
          </p>
        ) : null}
      </Card>
    </>
  );
}

function NumberField({
  label,
  value,
  onChange,
  step = 1,
  min,
  max,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: number;
  min?: number;
  max?: number;
  suffix?: string;
}) {
  return (
    <label className="block">
      <span className="text-label text-ink-muted">{label}</span>
      <span className="relative mt-1.5 block">
        <input
          type="number"
          value={value}
          step={step}
          min={min}
          max={max}
          onChange={(e) => {
            const next = Number(e.target.value);
            if (Number.isFinite(next)) onChange(next);
          }}
          className="border-hairline text-body min-h-[40px] w-full rounded-[var(--radius-control)] border bg-white px-2 tabular-nums"
        />
        {suffix ? (
          <span className="text-body-sm text-ink-faint pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
            {suffix}
          </span>
        ) : null}
      </span>
    </label>
  );
}

/** Shows what the band does to three sample values — makes an edit predictable. */
function BandPreview({ rule, unit }: { rule: IndicatorRule; unit: string }) {
  const span = rule.threshold - rule.criticalAt;
  const samples = [
    rule.criticalAt,
    Math.round((rule.criticalAt + span / 2) * 10) / 10,
    rule.threshold,
  ];

  return (
    <div className="border-hairline mt-4 border-t pt-3">
      <p className="text-label text-ink-muted mb-2">Sub-score at</p>
      <div className="flex flex-wrap gap-2">
        {samples.map((sample) => (
          <Badge key={sample}>
            {sample}
            {unit} → {Math.round(bandSubScore(sample, rule))}
          </Badge>
        ))}
      </div>
    </div>
  );
}
