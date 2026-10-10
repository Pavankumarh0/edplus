import { z } from 'zod';
import { IsoDateTimeSchema, UsnSchema } from './common.js';
import { InterventionTypeSchema } from './intervention.js';

/**
 * The structured body Claude must return for a student report.
 *
 * This doubles as the `output_config.format` JSON schema for the Report Agent.
 * Forced tool use is rejected by the current Sonnet model, so structured
 * outputs — not a forced `save_report` call — are how we guarantee shape.
 */
export const ReportBodySchema = z.object({
  /** 2–3 sentences, must cite real numbers. */
  summary: z.string().min(1).max(1200),
  /** Genuine strengths only. An empty array is correct and expected when
   *  there is nothing real to praise — vague encouragement is worse than
   *  silence because it teaches the student to ignore the report. */
  strengths: z.array(z.string().min(1).max(400)).max(5),
  concerns: z
    .array(
      z.object({
        indicator: z.string().min(1).max(60),
        detail: z.string().min(1).max(600),
        /** Why this matters for the student, concretely. */
        whyItMatters: z.string().min(1).max(600),
      }),
    )
    .max(6),
  /** Specific, checkable next steps addressed to the student. */
  actions: z.array(z.string().min(1).max(400)).max(6),
  recommendedInterventions: z
    .array(
      z.object({
        type: InterventionTypeSchema,
        reason: z.string().min(1).max(600),
      }),
    )
    .max(4),
  /** Must be filled in when the snapshot carries conflicts or data gaps. */
  dataCaveats: z.array(z.string().min(1).max(400)).max(5),
});

export type ReportBody = z.infer<typeof ReportBodySchema>;

export const StudentReportSchema = z.object({
  reportId: z.string().trim().min(1),
  usn: UsnSchema,
  /** The snapshot this report explains. A report is never shown next to a
   *  different snapshot than the one it was written for. */
  snapshotId: z.string().trim().min(1),
  body: ReportBodySchema,
  /** Rendered markdown, for display and for the student app. */
  rendered: z.string().min(1),
  model: z.string().min(1),
  createdAt: IsoDateTimeSchema,
});

export type StudentReport = z.infer<typeof StudentReportSchema>;
