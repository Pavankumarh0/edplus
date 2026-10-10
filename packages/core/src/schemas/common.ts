import { z } from 'zod';

/**
 * University Seat Number — the primary key for a student across the whole
 * system. Uploads upsert on this, so it is normalised aggressively:
 * trimmed, uppercased, inner whitespace removed.
 */
export const UsnSchema = z
  .string()
  .trim()
  .min(3, 'USN is too short')
  .max(32, 'USN is too long')
  .transform((s) => s.toUpperCase().replace(/\s+/g, ''));

/**
 * Risk levels, ordered least → most severe.
 *
 * The order of this array is load-bearing: `RISK_LEVELS.indexOf(level)` is the
 * sort key used for prioritisation, so never reorder it casually.
 */
export const RISK_LEVELS = ['stable', 'watch', 'at_risk', 'critical'] as const;
export const RiskLevelSchema = z.enum(RISK_LEVELS);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

/** Severity rank of a level — higher means more urgent. */
export function riskLevelRank(level: RiskLevel): number {
  return RISK_LEVELS.indexOf(level);
}

/**
 * The four academic indicators the risk engine evaluates.
 *
 * `trend` is derived (change vs the previous snapshot) rather than read
 * straight off academic records, which is why it is handled separately in the
 * engine but still carries a weight like the others.
 */
export const INDICATOR_KEYS = ['attendance', 'assessment', 'submission', 'trend'] as const;
export const IndicatorKeySchema = z.enum(INDICATOR_KEYS);
export type IndicatorKey = z.infer<typeof IndicatorKeySchema>;

export const INDICATOR_LABELS: Record<IndicatorKey, string> = {
  attendance: 'Attendance',
  assessment: 'Assessment average',
  submission: 'Submission completion',
  trend: 'Trend',
};

/** Languages the parent voice agent can speak, as Sarvam BCP-47 codes. */
export const PARENT_LANGUAGES = [
  'en-IN',
  'hi-IN',
  'kn-IN',
  'ta-IN',
  'te-IN',
  'ml-IN',
  'mr-IN',
  'bn-IN',
  'gu-IN',
  'pa-IN',
  'od-IN',
] as const;
export const ParentLanguageSchema = z.enum(PARENT_LANGUAGES).default('en-IN');
export type ParentLanguage = z.infer<typeof ParentLanguageSchema>;

export const LANGUAGE_LABELS: Record<(typeof PARENT_LANGUAGES)[number], string> = {
  'en-IN': 'English',
  'hi-IN': 'Hindi',
  'kn-IN': 'Kannada',
  'ta-IN': 'Tamil',
  'te-IN': 'Telugu',
  'ml-IN': 'Malayalam',
  'mr-IN': 'Marathi',
  'bn-IN': 'Bengali',
  'gu-IN': 'Gujarati',
  'pa-IN': 'Punjabi',
  'od-IN': 'Odia',
};

/**
 * E.164 phone number. Parent phone numbers are faculty/server-readable only —
 * Firestore rules must never expose them to the student app.
 */
export const PhoneSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{7,14}$/, 'Phone must be E.164, e.g. +918012345678');

/** A percentage, 0–100 inclusive. */
export const PercentSchema = z.number().min(0).max(100);

/**
 * Timestamps cross the Firestore boundary as ISO-8601 strings so that the same
 * schema validates data coming from Firestore, from an API route and from a
 * CSV fixture, with no Firestore `Timestamp` objects leaking into the engine.
 */
export const IsoDateTimeSchema = z.string().datetime({ offset: true });
export const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
