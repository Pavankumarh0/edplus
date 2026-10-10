import type { ReactNode } from 'react';
import {
  INSUFFICIENT_DATA_PALETTE,
  LEVEL_PALETTE,
  type IndicatorResult,
  type IndicatorRule,
  type RiskLevel,
} from '@eduplus/core';

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

/* ───────────────────────────────────────────────────────────────────────────
   Card
   Cards sit on the canvas by contrast, not shadow. Only genuinely floating
   things get `shadow-raised`.
   ─────────────────────────────────────────────────────────────────────────── */

export function Card({
  children,
  className,
  hero = false,
  as: Tag = 'section',
}: {
  children: ReactNode;
  className?: string;
  hero?: boolean;
  as?: 'section' | 'div' | 'article' | 'aside';
}) {
  return (
    <Tag
      className={cx(
        'bg-surface border border-hairline',
        hero ? 'rounded-[var(--radius-hero)] p-8' : 'rounded-[var(--radius-card)] p-6',
        className,
      )}
    >
      {children}
    </Tag>
  );
}

export function CardTitle({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div className="mb-4 flex items-baseline justify-between gap-3">
      <h2 className="text-h2 text-ink">{children}</h2>
      {hint ? <span className="text-body-sm text-ink-muted">{hint}</span> : null}
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────────────────
   Metric
   ─────────────────────────────────────────────────────────────────────────── */

export function Metric({
  value,
  label,
  sub,
  tone,
}: {
  value: ReactNode;
  label: string;
  sub?: ReactNode;
  tone?: RiskLevel | 'nodata';
}) {
  const color =
    tone === 'nodata'
      ? INSUFFICIENT_DATA_PALETTE.fg
      : tone
        ? LEVEL_PALETTE[tone].fg
        : undefined;

  return (
    <div>
      <div data-metric className="text-metric" style={color ? { color } : undefined}>
        {value}
      </div>
      <div className="text-body-sm text-ink-muted mt-1">{label}</div>
      {sub ? <div className="text-body-sm text-ink-faint mt-2">{sub}</div> : null}
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────────────────
   Level pill — always carries the written label. Never colour alone.
   ─────────────────────────────────────────────────────────────────────────── */

export function LevelPill({
  level,
  insufficientData = false,
  escalated = false,
  size = 'md',
}: {
  level: RiskLevel;
  insufficientData?: boolean;
  escalated?: boolean;
  size?: 'sm' | 'md';
}) {
  // "Insufficient data" replaces the level, because a student we know nothing
  // about must not be shown anywhere on the green-to-red scale.
  const palette = insufficientData ? INSUFFICIENT_DATA_PALETTE : LEVEL_PALETTE[level];

  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-[var(--radius-pill)] border font-medium whitespace-nowrap',
        size === 'sm' ? 'px-2 py-0.5 text-[11.5px]' : 'px-3 py-1 text-label',
      )}
      style={{
        color: palette.fg,
        backgroundColor: palette.fill,
        borderColor: `${palette.fg}59`,
      }}
    >
      {escalated && !insufficientData ? (
        <span aria-hidden="true" className="leading-none">
          ▲
        </span>
      ) : null}
      {palette.label}
    </span>
  );
}

/* ───────────────────────────────────────────────────────────────────────────
   Badges
   ─────────────────────────────────────────────────────────────────────────── */

export function Badge({
  children,
  tone = 'neutral',
  title,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'nodata' | 'lime';
  title?: string;
}) {
  const styles =
    tone === 'nodata'
      ? { color: INSUFFICIENT_DATA_PALETTE.fg, backgroundColor: INSUFFICIENT_DATA_PALETTE.fill }
      : tone === 'lime'
        ? { color: 'var(--color-ink)', backgroundColor: 'var(--color-lime)' }
        : { color: 'var(--color-ink-muted)', backgroundColor: 'var(--color-surface-sunk)' };

  return (
    <span
      title={title}
      className="inline-flex items-center rounded-[var(--radius-pill)] px-2 py-0.5 text-[11.5px] font-medium whitespace-nowrap"
      style={styles}
    >
      {children}
    </span>
  );
}

/** Trend arrow. Remember: a NEGATIVE score delta is good news. */
export function TrendArrow({ delta }: { delta: number | null }) {
  if (delta === null) {
    return (
      <span className="text-ink-faint text-body-sm" title="No earlier snapshot to compare">
        —
      </span>
    );
  }
  if (Math.abs(delta) < 2) {
    return (
      <span className="text-ink-muted text-body-sm" title="Unchanged">
        ±0
      </span>
    );
  }
  const improving = delta < 0;
  return (
    <span
      className="text-body-sm font-medium"
      style={{ color: improving ? LEVEL_PALETTE.stable.fg : LEVEL_PALETTE.critical.fg }}
      title={improving ? 'Risk score fell — improving' : 'Risk score rose — worsening'}
    >
      {improving ? '↓' : '↑'} {Math.abs(delta)}
    </span>
  );
}

/* ───────────────────────────────────────────────────────────────────────────
   Indicator band — the signature component.
   Never a number without what it is measured against.
   ─────────────────────────────────────────────────────────────────────────── */

export function IndicatorBand({
  indicator,
  rule,
  level,
}: {
  indicator: IndicatorResult;
  rule: IndicatorRule | undefined;
  level: RiskLevel;
}) {
  const palette = LEVEL_PALETTE[level];
  const label =
    indicator.key === 'attendance'
      ? 'Attendance'
      : indicator.key === 'assessment'
        ? 'Assessment average'
        : indicator.key === 'submission'
          ? 'Submission completion'
          : 'Trend';

  // Unavailable: a hatched outline, never a bar at zero. An empty bar and a
  // bar at zero mean opposite things.
  if (!indicator.available || indicator.value === null || !rule) {
    return (
      <div className="py-3">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-body font-medium">{label}</span>
          <span className="text-body-sm text-ink-faint">No data</span>
        </div>
        <div
          className="hatched mt-2 h-[10px] rounded-[var(--radius-pill)] border border-dashed border-hairline"
          role="img"
          aria-label={`${label}: no data`}
        />
        <p className="text-body-sm text-ink-muted mt-2">{indicator.reason}</p>
      </div>
    );
  }

  // Trend is a signed change, so it gets its own scale centred on zero rather
  // than a 0-100 track.
  const isTrend = indicator.key === 'trend';
  const min = isTrend ? rule.criticalAt : 0;
  const max = isTrend ? Math.max(Math.abs(rule.criticalAt), 10) : 100;
  const span = max - min;
  const pct = (v: number) => Math.max(0, Math.min(100, ((v - min) / span) * 100));

  const fill = pct(indicator.value);
  const thresholdAt = pct(rule.threshold);
  const criticalAt = pct(rule.criticalAt);

  return (
    <div className="py-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-body font-medium">{label}</span>
        <span className="text-body tabular-nums font-semibold">
          {isTrend && indicator.value > 0 ? '+' : ''}
          {indicator.value}
          {isTrend ? ' pts' : '%'}
        </span>
      </div>

      <div className="relative mt-2">
        <div
          className="bg-surface-sunk h-[10px] overflow-hidden rounded-[var(--radius-pill)]"
          role="img"
          aria-label={indicator.reason}
        >
          <div
            className="h-full rounded-[var(--radius-pill)]"
            style={{ width: `${fill}%`, backgroundColor: palette.fg }}
          />
        </div>

        {/* Ticks: where risk begins, and where it maxes out. */}
        <Tick at={criticalAt} label={`${rule.criticalAt}`} caption="critical" />
        <Tick at={thresholdAt} label={`${rule.threshold}`} caption="target" />
      </div>

      <p className="text-body-sm text-ink-muted mt-6">{indicator.reason}</p>
    </div>
  );
}

function Tick({ at, label, caption }: { at: number; label: string; caption: string }) {
  return (
    <div
      className="pointer-events-none absolute top-0 flex -translate-x-1/2 flex-col items-center"
      style={{ left: `${at}%` }}
      aria-hidden="true"
    >
      <span className="bg-ink/45 block h-[14px] w-[1.5px] -translate-y-[2px]" />
      <span className="text-ink-faint mt-0.5 text-[10.5px] tabular-nums leading-none">{label}</span>
      <span className="text-ink-faint text-[9.5px] leading-none">{caption}</span>
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────────────────
   Pill bar chart
   ─────────────────────────────────────────────────────────────────────────── */

export function PillBarChart({
  rows,
  highlight,
}: {
  rows: { label: string; value: number; color: string; href?: string }[];
  highlight?: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));

  return (
    <ul className="space-y-2.5">
      {rows.map((row) => {
        const active = highlight === row.label;
        return (
          <li key={row.label} className="flex items-center gap-3">
            <span className="text-body-sm text-ink-muted w-[108px] shrink-0">{row.label}</span>
            <span className="bg-surface-sunk relative h-6 flex-1 overflow-hidden rounded-[var(--radius-pill)]">
              <span
                className="absolute inset-y-0 left-0 rounded-[var(--radius-pill)] transition-[width] duration-200"
                style={{
                  width: `${(row.value / max) * 100}%`,
                  backgroundColor: active ? 'var(--color-lime)' : row.color,
                }}
              />
            </span>
            <span data-metric className="text-body w-7 shrink-0 text-right font-semibold">
              {row.value}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/* ───────────────────────────────────────────────────────────────────────────
   Buttons
   ─────────────────────────────────────────────────────────────────────────── */

export function Button({
  children,
  variant = 'primary',
  type = 'button',
  disabled,
  onClick,
  formAction,
  className,
  title,
}: {
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  type?: 'button' | 'submit';
  disabled?: boolean;
  onClick?: () => void;
  formAction?: (formData: FormData) => void | Promise<void>;
  className?: string;
  title?: string;
}) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] px-4 min-h-[40px] text-body font-medium transition-colors duration-150 disabled:opacity-45 disabled:cursor-not-allowed';
  const variants = {
    primary: 'bg-ink text-canvas hover:bg-ink/88',
    secondary: 'bg-surface border border-hairline text-ink hover:bg-surface-sunk',
    ghost: 'text-ink-muted hover:bg-surface-sunk hover:text-ink',
    danger: 'border text-[var(--color-level-critical)] border-[var(--color-level-critical)]/35 bg-[var(--color-level-critical-fill)] hover:brightness-[.97]',
  } as const;

  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      formAction={formAction}
      title={title}
      className={cx(base, variants[variant], className)}
    >
      {children}
    </button>
  );
}

/* ───────────────────────────────────────────────────────────────────────────
   Empty state — an invitation to act, not an apology
   ─────────────────────────────────────────────────────────────────────────── */

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="border-hairline rounded-[var(--radius-card)] border border-dashed px-6 py-10 text-center">
      <p className="text-h2 text-ink">{title}</p>
      {children ? <p className="text-body-sm text-ink-muted mx-auto mt-2 max-w-[48ch]">{children}</p> : null}
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function Usn({ children }: { children: ReactNode }) {
  return <span className="font-mono text-mono text-ink-muted">{children}</span>;
}
