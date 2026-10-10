import { z } from 'zod';
import { IsoDateSchema, IsoDateTimeSchema, UsnSchema } from './common';

export const RECORD_TYPES = ['attendance', 'assessment', 'submission'] as const;
export const RecordTypeSchema = z.enum(RECORD_TYPES);
export type RecordType = z.infer<typeof RecordTypeSchema>;

/**
 * One academic data point for one student in one subject.
 *
 * The three record types share a shape rather than being separate collections
 * because the risk engine, the CSV importer and the repositories all want to
 * treat "a thing we know about this student" uniformly. The meaning of
 * `value`/`maxValue` is what differs:
 *
 *   attendance → value = classes attended,   maxValue = classes held
 *   assessment → value = marks scored,       maxValue = marks possible
 *   submission → value = submissions made,   maxValue = submissions expected
 *
 * Storing the raw pair rather than a pre-divided percentage is deliberate: it
 * lets the engine aggregate correctly across subjects of different sizes
 * (a 50-class subject should outweigh a 10-class one) instead of averaging
 * percentages, which would silently distort the result.
 */
export const AcademicRecordSchema = z
  .object({
    recordId: z.string().trim().min(1),
    usn: UsnSchema,
    type: RecordTypeSchema,
    subject: z.string().trim().min(1).max(120),
    value: z.number().min(0),
    maxValue: z.number().min(0),
    date: IsoDateSchema,
    /** Which upload produced this record — used for idempotency and audit. */
    sourceUploadId: z.string().trim().min(1),
    createdAt: IsoDateTimeSchema.optional(),
  })
  .refine((r) => r.maxValue > 0, {
    message: 'maxValue must be greater than 0 — a record out of zero carries no information',
    path: ['maxValue'],
  })
  .refine((r) => r.value <= r.maxValue, {
    message: 'value cannot exceed maxValue',
    path: ['value'],
  });

export type AcademicRecord = z.infer<typeof AcademicRecordSchema>;

/** Percentage for a single record. */
export function recordPercent(record: Pick<AcademicRecord, 'value' | 'maxValue'>): number {
  return (record.value / record.maxValue) * 100;
}

/**
 * Deterministic record id, so re-importing the same CSV is idempotent rather
 * than doubling every student's record count.
 *
 * Note what is NOT in the key: `sourceUploadId`. Two different uploads
 * carrying the same fact (same student, type, subject, date) must collapse to
 * one record — that is precisely the duplicate case the brief asks to handle.
 * Including the upload id would defeat it.
 */
export function makeRecordId(input: {
  usn: string;
  type: RecordType;
  subject: string;
  date: string;
}): string {
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return [slug(input.usn), input.type, slug(input.subject), input.date].join('__');
}
