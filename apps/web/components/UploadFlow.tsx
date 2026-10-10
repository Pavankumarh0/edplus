'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import type { ColumnMapping, RecordType, RowError } from '@eduplus/core';
import { Badge, Button, Card, CardTitle, cx } from './ui';

interface Preview {
  fileName: string;
  recordType: RecordType;
  headers: string[];
  mapping: ColumnMapping;
  mappingSource: 'heuristic' | 'claude' | 'manual';
  mappingConfidence: number | null;
  mappingNote: string | null;
  unusedHeaders: string[];
  rowsTotal: number;
  rowsOk: number;
  rowsRejected: number;
  duplicatesCollapsed: number;
  warnings: string[];
  errors: RowError[];
  errorsTruncated: boolean;
  studentCount: number;
}

const RECORD_TYPES: { key: RecordType; label: string; hint: string }[] = [
  { key: 'attendance', label: 'Attendance', hint: 'Classes attended out of classes held' },
  { key: 'assessment', label: 'Assessment marks', hint: 'Marks obtained out of maximum' },
  { key: 'submission', label: 'Submissions', hint: 'Assignments submitted out of expected' },
];

const MAPPING_FIELDS: { key: keyof ColumnMapping; label: string; required?: boolean }[] = [
  { key: 'usn', label: 'USN', required: true },
  { key: 'value', label: 'Value', required: true },
  { key: 'maxValue', label: 'Maximum' },
  { key: 'name', label: 'Student name' },
  { key: 'subject', label: 'Subject' },
  { key: 'date', label: 'Date' },
  { key: 'semester', label: 'Semester' },
  { key: 'section', label: 'Section' },
  { key: 'department', label: 'Department' },
  { key: 'parentName', label: 'Parent name' },
  { key: 'parentPhone', label: 'Parent phone' },
  { key: 'parentLanguage', label: 'Parent language' },
];

export function UploadFlow() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [recordType, setRecordType] = useState<RecordType>('attendance');
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<'preview' | 'commit' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  async function readFile(file: File) {
    setError(null);
    setDone(null);
    setPreview(null);
    const text = await file.text();
    setCsv(text);
    setFileName(file.name);
    void runPreview(text, file.name, recordType);
  }

  async function runPreview(
    text: string,
    name: string,
    type: RecordType,
    mapping?: Record<string, string | null>,
  ) {
    setBusy('preview');
    setError(null);
    try {
      const response = await fetch('/api/upload/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ recordType: type, fileName: name, csv: text, mapping }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? 'Could not read that file.');
      setPreview(json as Preview);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not read that file.');
    } finally {
      setBusy(null);
    }
  }

  async function commit() {
    if (!csv || !preview) return;
    setBusy('commit');
    setError(null);
    try {
      const response = await fetch('/api/upload/commit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          recordType: preview.recordType,
          fileName: preview.fileName,
          csv,
          mapping: preview.mapping,
          mappingSource: preview.mappingSource,
          mappingConfidence: preview.mappingConfidence,
        }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? 'Commit failed.');

      setDone(json.message as string);
      setPreview(null);
      setCsv(null);
      setFileName(null);
      if (inputRef.current) inputRef.current.value = '';
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Commit failed.');
    } finally {
      setBusy(null);
    }
  }

  function changeMapping(field: keyof ColumnMapping, column: string) {
    if (!preview || !csv || !fileName) return;
    const next: Record<string, string | null> = { ...preview.mapping };
    next[field] = column === '' ? null : column;
    void runPreview(csv, fileName, preview.recordType, next);
  }

  return (
    <>
      {/* ── Record type ──────────────────────────────────────────────────── */}
      <Card className="mb-4">
        <CardTitle hint="What kind of data is in the file?">Record type</CardTitle>
        <div className="grid gap-3 sm:grid-cols-3">
          {RECORD_TYPES.map((type) => (
            <button
              key={type.key}
              type="button"
              onClick={() => {
                setRecordType(type.key);
                if (csv && fileName) void runPreview(csv, fileName, type.key);
              }}
              aria-pressed={recordType === type.key}
              className={cx(
                'rounded-[var(--radius-control)] border p-3 text-left transition-colors duration-150',
                recordType === type.key
                  ? 'border-lime-edge bg-lime'
                  : 'border-hairline hover:bg-surface-sunk',
              )}
            >
              <span className="text-body block font-medium">{type.label}</span>
              <span className="text-body-sm text-ink-muted mt-0.5 block">{type.hint}</span>
            </button>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <a href={`/api/templates/${recordType}`} download>
            <Button variant="ghost">Download template</Button>
          </a>
        </div>
      </Card>

      {/* ── Drop zone ────────────────────────────────────────────────────── */}
      <Card className="mb-4">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files?.[0];
            if (file) void readFile(file);
          }}
          className={cx(
            'rounded-[var(--radius-control)] border border-dashed px-6 py-10 text-center transition-colors duration-150',
            dragging ? 'border-lime-edge bg-lime/35' : 'border-hairline',
          )}
        >
          <p className="text-body">
            {fileName ? (
              <>
                <span className="font-medium">{fileName}</span> loaded
              </>
            ) : (
              'Drop a CSV here'
            )}
          </p>
          <p className="text-body-sm text-ink-muted mt-1">or</p>
          <div className="mt-3 flex justify-center">
            <Button variant="secondary" onClick={() => inputRef.current?.click()}>
              Choose a file
            </Button>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void readFile(file);
            }}
          />
        </div>

        {busy === 'preview' ? (
          <p className="text-body-sm text-ink-muted mt-3">Reading the file and matching columns…</p>
        ) : null}

        {error ? (
          <p
            role="alert"
            className="text-body-sm mt-3 rounded-[var(--radius-control)] px-3 py-2"
            style={{
              color: 'var(--color-level-critical)',
              background: 'var(--color-level-critical-fill)',
            }}
          >
            {error}
          </p>
        ) : null}

        {done ? (
          <p
            role="status"
            className="text-body-sm mt-3 rounded-[var(--radius-control)] px-3 py-2"
            style={{
              color: 'var(--color-level-stable)',
              background: 'var(--color-level-stable-fill)',
            }}
          >
            {done}
          </p>
        ) : null}
      </Card>

      {/* ── Preview ──────────────────────────────────────────────────────── */}
      {preview ? (
        <>
          <Card className="mb-4">
            <CardTitle
              hint={
                preview.mappingSource === 'claude'
                  ? `Claude proposed this (confidence ${Math.round((preview.mappingConfidence ?? 0) * 100)}%)`
                  : preview.mappingSource === 'manual'
                    ? 'Edited by you'
                    : 'Matched automatically, no AI needed'
              }
            >
              Column mapping
            </CardTitle>

            {preview.mappingNote ? (
              <p className="text-body-sm text-ink-muted mb-4">{preview.mappingNote}</p>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {MAPPING_FIELDS.map((field) => (
                <label key={field.key} className="block">
                  <span className="text-label text-ink-muted flex items-center gap-1.5">
                    {field.label}
                    {field.required ? <Badge>required</Badge> : null}
                  </span>
                  <select
                    value={preview.mapping[field.key] ?? ''}
                    onChange={(e) => changeMapping(field.key, e.target.value)}
                    className="border-hairline text-body mt-1.5 min-h-[40px] w-full rounded-[var(--radius-control)] border bg-white px-2"
                  >
                    <option value="">— not in this file —</option>
                    {preview.headers.map((header) => (
                      <option key={header} value={header}>
                        {header}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>

            {preview.unusedHeaders.length > 0 ? (
              <p className="text-body-sm text-ink-faint mt-4">
                Columns not used: {preview.unusedHeaders.join(', ')}
              </p>
            ) : null}
          </Card>

          <Card className="mb-4">
            <CardTitle hint={preview.fileName}>Preview</CardTitle>

            <div className="mb-5 flex flex-wrap items-end gap-8">
              <div>
                <div data-metric className="text-metric">
                  {preview.rowsOk}
                </div>
                <div className="text-body-sm text-ink-muted mt-1">rows ready</div>
              </div>
              <div>
                <div
                  data-metric
                  className="text-metric"
                  style={
                    preview.rowsRejected > 0 ? { color: 'var(--color-level-critical)' } : undefined
                  }
                >
                  {preview.rowsRejected}
                </div>
                <div className="text-body-sm text-ink-muted mt-1">rejected</div>
              </div>
              <div>
                <div data-metric className="text-metric">
                  {preview.studentCount}
                </div>
                <div className="text-body-sm text-ink-muted mt-1">students</div>
              </div>
              {preview.duplicatesCollapsed > 0 ? (
                <div>
                  <div data-metric className="text-metric">
                    {preview.duplicatesCollapsed}
                  </div>
                  <div className="text-body-sm text-ink-muted mt-1">duplicates merged</div>
                </div>
              ) : null}
            </div>

            {preview.warnings.length > 0 ? (
              <ul className="mb-5 space-y-2">
                {preview.warnings.map((warning, index) => (
                  <li
                    key={index}
                    className="text-body-sm rounded-[var(--radius-control)] px-3 py-2"
                    style={{
                      color: 'var(--color-level-watch)',
                      background: 'var(--color-level-watch-fill)',
                    }}
                  >
                    {warning}
                  </li>
                ))}
              </ul>
            ) : null}

            {preview.errors.length > 0 ? (
              <div className="mb-5">
                <h3 className="text-h2 mb-2">Rows that will not import</h3>
                <div className="border-hairline max-h-[280px] overflow-auto rounded-[var(--radius-control)] border">
                  <table className="w-full border-collapse">
                    <thead className="bg-surface-sunk sticky top-0">
                      <tr className="text-label text-ink-muted">
                        <th scope="col" className="px-3 py-2 text-left font-medium">
                          Row
                        </th>
                        <th scope="col" className="px-3 py-2 text-left font-medium">
                          Column
                        </th>
                        <th scope="col" className="px-3 py-2 text-left font-medium">
                          Why
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.errors.map((rowError, index) => (
                        <tr key={index} className="border-hairline border-t">
                          <td className="text-body-sm px-3 py-2 tabular-nums">{rowError.row}</td>
                          <td className="text-body-sm text-ink-muted px-3 py-2">
                            {rowError.field ?? '—'}
                          </td>
                          <td className="text-body-sm px-3 py-2">{rowError.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {preview.errorsTruncated ? (
                  <p className="text-body-sm text-ink-faint mt-2">
                    Showing the first 50 problems.
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button onClick={commit} disabled={busy !== null || preview.rowsOk === 0}>
                {busy === 'commit'
                  ? 'Importing and rescoring…'
                  : `Commit ${preview.rowsOk} row${preview.rowsOk === 1 ? '' : 's'}`}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setPreview(null);
                  setCsv(null);
                  setFileName(null);
                  if (inputRef.current) inputRef.current.value = '';
                }}
              >
                Discard
              </Button>
            </div>
          </Card>
        </>
      ) : null}
    </>
  );
}
