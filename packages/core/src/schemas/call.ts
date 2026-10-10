import { z } from 'zod';
import { IsoDateTimeSchema, ParentLanguageSchema, UsnSchema } from './common';

export const CALL_PURPOSES = ['absence', 'ptm', 'risk_update'] as const;
export const CallPurposeSchema = z.enum(CALL_PURPOSES);
export type CallPurpose = z.infer<typeof CallPurposeSchema>;

export const CALL_STATUSES = [
  'queued',
  'approved',
  'dialing',
  'in_progress',
  'completed',
  'failed',
  'no_answer',
  'cancelled',
] as const;
export const CallStatusSchema = z.enum(CALL_STATUSES);
export type CallStatus = z.infer<typeof CallStatusSchema>;

export const TranscriptTurnSchema = z.object({
  speaker: z.enum(['agent', 'parent', 'system']),
  text: z.string(),
  /** Language the turn was actually spoken in. */
  language: ParentLanguageSchema.optional(),
  at: IsoDateTimeSchema,
});

export type TranscriptTurn = z.infer<typeof TranscriptTurnSchema>;

/**
 * What the parent actually conveyed. Kept as a small closed set plus free
 * text, so the dashboard can show "Will attend PTM" without parsing prose.
 */
export const PARENT_RESPONSES = [
  'confirmed_attending',
  'declined_attending',
  'acknowledged',
  'requested_callback',
  'wrong_number',
  'no_response',
] as const;
export const ParentResponseSchema = z.enum(PARENT_RESPONSES);
export type ParentResponse = z.infer<typeof ParentResponseSchema>;

export const PARENT_RESPONSE_LABELS: Record<ParentResponse, string> = {
  confirmed_attending: 'Will attend',
  declined_attending: 'Cannot attend',
  acknowledged: 'Acknowledged',
  requested_callback: 'Asked for a callback from the mentor',
  wrong_number: 'Wrong number',
  no_response: 'No response',
};

export const CallRecordSchema = z.object({
  callId: z.string().trim().min(1),
  usn: UsnSchema,
  purpose: CallPurposeSchema,
  language: ParentLanguageSchema,
  status: CallStatusSchema,

  /** Provider that handled (or will handle) the call. */
  provider: z.enum(['vobiz', 'simulated']),
  /** Provider-side identifier, e.g. Vobiz call_uuid. */
  providerCallId: z.string().trim().min(1).nullable().default(null),

  /**
   * The exact message approved for this call. The voice agent may not go
   * beyond it: it is the guardrail boundary, not a hint.
   */
  approvedMessage: z.string().min(1).max(2000),
  /** Faculty uid who approved placing this call. Required before dialing. */
  approvedBy: z.string().trim().min(1).nullable().default(null),

  transcript: z.array(TranscriptTurnSchema).default([]),
  summary: z.string().max(2000).nullable().default(null),
  parentResponse: ParentResponseSchema.nullable().default(null),
  /** Verbatim note, e.g. what the parent said when asking for a callback. */
  parentResponseNote: z.string().max(1000).nullable().default(null),
  recordingUrl: z.string().url().nullable().default(null),
  failureReason: z.string().max(500).nullable().default(null),

  /** Set when this call was raised to satisfy an intervention. */
  interventionId: z.string().trim().min(1).nullable().default(null),

  createdAt: IsoDateTimeSchema,
  startedAt: IsoDateTimeSchema.nullable().default(null),
  endedAt: IsoDateTimeSchema.nullable().default(null),
});

export type CallRecord = z.infer<typeof CallRecordSchema>;

/**
 * Minimum-necessary context handed to the voice agent.
 *
 * Note what is absent: per-subject marks, the risk score, the full report.
 * A phone call to a parent is not the place to read out a mark sheet, and an
 * agent cannot leak what it was never given.
 */
export const CallContextSchema = z.object({
  callId: z.string(),
  studentFirstName: z.string(),
  parentName: z.string(),
  language: ParentLanguageSchema,
  purpose: CallPurposeSchema,
  approvedMessage: z.string(),
  /** Coarse band only — never the numeric score. */
  riskBand: z.enum(['needs_attention', 'improving', 'stable']).optional(),
  mentorName: z.string().optional(),
  collegeName: z.string(),
  eventDate: z.string().optional(),
  eventTime: z.string().optional(),
});

export type CallContext = z.infer<typeof CallContextSchema>;
