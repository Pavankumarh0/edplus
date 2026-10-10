'use client';

import { useMemo, useState } from 'react';
import { RISK_LEVELS, LEVEL_PALETTE, type PrioritisableStudent, type RiskLevel } from '@eduplus/core';
import { PriorityQueue } from './PriorityQueue';
import { cx } from './ui';

type Filter = 'all' | RiskLevel | 'nodata';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  ...[...RISK_LEVELS].reverse().map((level) => ({
    key: level as Filter,
    label: LEVEL_PALETTE[level].label,
  })),
  { key: 'nodata', label: 'Insufficient data' },
];

/**
 * Search + pill tabs over the student table.
 *
 * Client-side because the cohort is a classroom, not a database — filtering 60
 * rows in the browser is instant and avoids a round trip per keystroke. If this
 * ever served a whole college it would move to a server query.
 */
export function StudentSearch({ rows }: { rows: PrioritisableStudent[] }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const counts = useMemo(() => {
    const out: Record<string, number> = { all: rows.length, nodata: 0 };
    for (const level of RISK_LEVELS) out[level] = 0;
    for (const row of rows) {
      out[row.snapshot.level] = (out[row.snapshot.level] ?? 0) + 1;
      if (row.snapshot.insufficientData) out.nodata! += 1;
    }
    return out;
  }, [rows]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (filter === 'nodata' && !row.snapshot.insufficientData) return false;
      if (filter !== 'all' && filter !== 'nodata' && row.snapshot.level !== filter) return false;
      if (!needle) return true;
      return (
        row.usn.toLowerCase().includes(needle) ||
        (row.name ?? '').toLowerCase().includes(needle)
      );
    });
  }, [rows, query, filter]);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="relative flex-1 min-w-[220px]">
          <span className="sr-only">Search students by name or USN</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search name or USN"
            className="border-hairline text-body min-h-[40px] w-full rounded-[var(--radius-control)] border bg-white px-3"
          />
        </label>

        {/* Pill tabs on a sunk track. */}
        <div
          role="tablist"
          aria-label="Filter by risk level"
          className="bg-surface-sunk flex flex-wrap gap-1 rounded-[var(--radius-pill)] p-1"
        >
          {FILTERS.map((item) => {
            const active = filter === item.key;
            return (
              <button
                key={item.key}
                role="tab"
                aria-selected={active}
                type="button"
                onClick={() => setFilter(item.key)}
                className={cx(
                  'text-label min-h-[32px] rounded-[var(--radius-pill)] px-3 transition-colors duration-150',
                  active ? 'bg-lime text-ink' : 'text-ink-muted hover:text-ink',
                )}
              >
                {item.label}
                <span className="ml-1.5 tabular-nums opacity-60">{counts[item.key] ?? 0}</span>
              </button>
            );
          })}
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="text-body-sm text-ink-muted py-8 text-center">
          No students match {query ? `“${query}”` : 'that filter'}.
        </p>
      ) : (
        <PriorityQueue rows={visible} caption="All students, prioritised" />
      )}
    </>
  );
}
