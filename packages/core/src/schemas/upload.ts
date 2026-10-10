import { z } from 'zod';
import { IsoDateTimeSchema } from './common';
import { RecordTypeSchema } from './records';

/**
 * Which CSV column feeds which field. Produced by header heuristics first and
 * only then by Claude, and always validated here before it is trusted.
 *
 * Values are source column names as they appear in the uploaded file.
 */
export const ColumnMappingSchema = z.object({
  usn: z.string().min(1),
  name: z.string().min(1).nullable().default(null),
  subject: z.string().min(1).nullable().default(null),
  value: z.string().min(1),
  maxValue: z.string().min(1).nullable().default(null),
  date: z.string().min(1).nullable().default(null),
  semester: z.string().min(1).nullable().default(null),
  section: z.string().min(1).nullable().default(null),
  department: z.string().min(1).nullable().default(null),
  parentName: z.string().min(1).nullable().default(null),
  parentPhone: z.string().min(1).nullable().default(null),
  parentLanguage: z.string().min(1).nullable().default(null),
});

export type ColumnMapping = z.infer<typeof ColumnMappingSchema>;

export const MAPPING_SOURCES = ['heuristic', 'claude', 'manual'] as const;
export const MappingSourceSchema = z.enum(MAPPING_SOURCES);
export type MappingSource = z.infer<typeof MappingSourceSchema>;

export const RowErrorSchema = z.object({
  /**
   * 1-based row number as the faculty member sees it in their spreadsheet,
   * counting the header as row 1. Off-by-one here makes every error message
   * useless, so the importer tests pin it.
   */
  row: z.number().int().min(1),
  field: z.string().nullable(),
  message: z.string(),
  /** The offending raw value, so the error is actionable without reopening
   *  the file. */
  rawValue: z.string().nullable().default(null),
});

export type RowError = z.infer<typeof RowErrorSchema>;

export const UploadSchema = z.object({
  uploadId: z.string().trim().min(1),
  fileName: z.string().min(1),
  recordType: RecordTypeSchema,
  uploadedBy: z.string().min(1),
  mapping: ColumnMappingSchema,
  mappingSource: MappingSourceSchema,
  /** If Claude proposed the mapping, how confident it said it was. */
  mappingConfidence: z.number().min(0).max(1).nullable().default(null),
  rowsTotal: z.number().int().min(0),
  rowsOk: z.number().int().min(0),
  rowsRejected: z.number().int().min(0),
  errors: z.array(RowErrorSchema).default([]),
  /** USNs touched, so risk recompute can be scoped to them. */
  affectedUsns: z.array(z.string()).default([]),
  /** Null until the faculty member confirms the preview. */
  committedAt: IsoDateTimeSchema.nullable().default(null),
  createdAt: IsoDateTimeSchema,
});

export type Upload = z.infer<typeof UploadSchema>;
