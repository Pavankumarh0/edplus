'use client';

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { COLORS, LEVEL_PALETTE, type LevelCutoffs, type RiskSnapshot } from '@eduplus/core';

/**
 * Snapshot history — the progress history the problem statement asks for.
 *
 * One series only, so no categorical palette is needed. The level bands are
 * drawn behind the line so a reader can see not just that a score moved but
 * which side of a threshold it moved across — the thing that actually changes
 * what a mentor does.
 */
export function RiskHistoryChart({
  history,
  cutoffs,
  baselineSnapshotId,
  outcomeSnapshotId,
}: {
  history: RiskSnapshot[];
  cutoffs: LevelCutoffs;
  baselineSnapshotId?: string | null;
  outcomeSnapshotId?: string | null;
}) {
  // Oldest to newest, which is how a timeline reads.
  const data = [...history]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((snapshot) => ({
      id: snapshot.snapshotId,
      date: snapshot.createdAt.slice(0, 10),
      score: snapshot.score,
      level: snapshot.level,
      insufficientData: snapshot.insufficientData,
    }));

  if (data.length < 2) {
    return (
      <p className="text-body-sm text-ink-muted">
        {data.length === 0
          ? 'No snapshots yet.'
          : 'Only one snapshot so far. Upload the next batch of data to see a trend.'}
      </p>
    );
  }

  const baseline = data.find((d) => d.id === baselineSnapshotId);
  const outcome = data.find((d) => d.id === outcomeSnapshotId);

  return (
    <div className="h-[240px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -16 }}>
          {/* Level bands, lightest at the bottom. */}
          <ReferenceArea y1={0} y2={cutoffs.watch} fill={LEVEL_PALETTE.stable.fill} fillOpacity={0.55} />
          <ReferenceArea y1={cutoffs.watch} y2={cutoffs.atRisk} fill={LEVEL_PALETTE.watch.fill} fillOpacity={0.55} />
          <ReferenceArea y1={cutoffs.atRisk} y2={cutoffs.critical} fill={LEVEL_PALETTE.at_risk.fill} fillOpacity={0.55} />
          <ReferenceArea y1={cutoffs.critical} y2={100} fill={LEVEL_PALETTE.critical.fill} fillOpacity={0.55} />

          <CartesianGrid stroke={COLORS.hairline} vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fill: COLORS.inkFaint, fontSize: 11 }}
            stroke={COLORS.hairline}
          />
          <YAxis
            domain={[0, 100]}
            ticks={[0, cutoffs.watch, cutoffs.atRisk, cutoffs.critical, 100]}
            tick={{ fill: COLORS.inkFaint, fontSize: 11 }}
            stroke={COLORS.hairline}
          />
          <Tooltip
            contentStyle={{
              background: COLORS.surface,
              border: `1px solid ${COLORS.hairline}`,
              borderRadius: 10,
              fontSize: 13,
            }}
            labelStyle={{ color: COLORS.inkMuted }}
            // Recharts types the formatter loosely; narrow inside instead of
            // fighting the signature.
            formatter={((value: unknown, _name: unknown, item: unknown) => {
              const row = (item as { payload?: (typeof data)[number] } | undefined)?.payload;
              const label = row?.insufficientData
                ? 'Insufficient data'
                : LEVEL_PALETTE[(row?.level ?? 'stable') as keyof typeof LEVEL_PALETTE].label;
              return [`${String(value)} — ${label}`, 'Risk score'];
            }) as never}
          />

          <Line
            type="monotone"
            dataKey="score"
            stroke={COLORS.ink}
            strokeWidth={2}
            dot={{ r: 4, fill: COLORS.lime, stroke: COLORS.ink, strokeWidth: 1.5 }}
            activeDot={{ r: 6, fill: COLORS.lime, stroke: COLORS.ink, strokeWidth: 2 }}
            isAnimationActive={false}
          />

          {/* Before/after markers, when an intervention has been settled. */}
          {baseline ? (
            <ReferenceDot
              x={baseline.date}
              y={baseline.score}
              r={7}
              fill="none"
              stroke={COLORS.inkFaint}
              strokeWidth={2}
            />
          ) : null}
          {outcome ? (
            <ReferenceDot
              x={outcome.date}
              y={outcome.score}
              r={7}
              fill="none"
              stroke={LEVEL_PALETTE[outcome.level as keyof typeof LEVEL_PALETTE].fg}
              strokeWidth={2}
            />
          ) : null}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
