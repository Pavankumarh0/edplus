import 'server-only';
import type Anthropic from '@anthropic-ai/sdk';
import {
  REPORT_AGENT_SYSTEM,
  ReportBodySchema,
  buildReportRequest,
  renderReportMarkdown,
  type ReportBody,
} from '@eduplus/core';
import { executeTool, reportOutputJsonSchema, type ToolContext } from '@eduplus/core/tools';
import { getLatestSnapshot, getSnapshotHistory } from '@eduplus/core/repositories';
import { getStudent } from '@eduplus/core/repositories';
import { anthropic, model } from './client';
import { runToolLoop } from './loop';

export interface GeneratedReport {
  reportId: string;
  body: ReportBody;
  rendered: string;
  toolsUsed: string[];
  inputTokens: number;
  outputTokens: number;
}

/**
 * Writes and stores one student's report.
 *
 * Two phases on purpose:
 *
 *  1. A real tool loop, so the agent reads the snapshot and history through
 *     the shared registry — allowlisted, validated and audited like any other
 *     caller.
 *  2. A final call with `output_config.format`, which guarantees the JSON
 *     shape. Forced `tool_choice` is rejected by the current Sonnet model, so
 *     structured outputs are how shape is enforced; the server then persists
 *     through `save_report` rather than trusting the model to call it.
 *
 * Splitting the phases means each request uses one well-supported feature
 * instead of relying on tools and structured outputs interacting.
 */
export async function generateReport(usn: string, ctx: ToolContext): Promise<GeneratedReport> {
  const student = await getStudent(ctx.db, usn);
  if (!student) throw new Error(`No student with USN ${usn}.`);

  const snapshot = await getLatestSnapshot(ctx.db, usn);
  if (!snapshot) {
    throw new Error(
      `${student.name} has no risk snapshot yet. Upload academic data for them first.`,
    );
  }

  const history = await getSnapshotHistory(ctx.db, usn, 8);

  // ── Phase 1: gather through the tool layer ────────────────────────────────
  const gathering = await runToolLoop({
    agent: 'report',
    system: REPORT_AGENT_SYSTEM,
    userMessage: buildReportRequest({
      studentName: student.name,
      usn: student.usn,
      semester: student.semester,
      snapshotJson: JSON.stringify(snapshot, null, 2),
      historyJson: JSON.stringify(
        history.map((s) => ({
          createdAt: s.createdAt,
          score: s.score,
          level: s.level,
          scoreDelta: s.scoreDelta,
          academicComposite: s.academicComposite,
        })),
        null,
        2,
      ),
    }),
    ctx,
    maxRounds: 4,
    effort: 'medium',
  });

  // ── Phase 2: shape the answer ─────────────────────────────────────────────
  const client = anthropic();
  const shaped = await client.messages.create({
    model: model(),
    max_tokens: 8000,
    system: REPORT_AGENT_SYSTEM,
    messages: [
      ...gathering.messages,
      {
        role: 'user',
        content:
          'Now return the report as JSON matching the required schema. ' +
          'Cite the real figures. Leave strengths empty if there is nothing genuine ' +
          'to say. Fill dataCaveats if the snapshot shows gaps, low confidence or conflicts.',
      },
    ],
    output_config: {
      effort: 'medium',
      format: { type: 'json_schema', schema: reportOutputJsonSchema() },
    },
  });

  if (shaped.stop_reason === 'refusal') {
    throw new Error('The model declined to write this report.');
  }

  const text = shaped.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();

  if (!text) {
    throw new Error('The model returned an empty report.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('The model returned something that was not valid JSON.');
  }

  // Validated against the same schema the JSON Schema was generated from.
  const body = ReportBodySchema.parse(parsed);
  const rendered = renderReportMarkdown(body, {
    studentName: student.name,
    usn: student.usn,
  });

  // Persisted through the tool layer, so the write is audited like any other.
  const saved = await executeTool<{ reportId: string }>(
    'save_report',
    {
      usn: student.usn,
      snapshotId: snapshot.snapshotId,
      body,
      rendered,
      model: model(),
    },
    ctx,
  );

  if (!saved.ok) throw new Error(saved.error ?? 'Could not save the report.');

  return {
    reportId: saved.data!.reportId,
    body,
    rendered,
    toolsUsed: gathering.toolsUsed,
    inputTokens: gathering.inputTokens + shaped.usage.input_tokens,
    outputTokens: gathering.outputTokens + shaped.usage.output_tokens,
  };
}
