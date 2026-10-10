import { z } from 'zod';
import { IsoDateTimeSchema } from './common';

/** Who initiated a tool call. */
export const ACTOR_KINDS = ['faculty', 'student', 'agent', 'system'] as const;
export const ActorKindSchema = z.enum(ACTOR_KINDS);
export type ActorKind = z.infer<typeof ActorKindSchema>;

export const ActorSchema = z.object({
  kind: ActorKindSchema,
  /** Firebase uid for humans, agent name for agents. */
  id: z.string().min(1),
  /** Which agent, when kind === 'agent': report | copilot | voice | planly. */
  agentName: z.string().min(1).optional(),
  /**
   * Confines this actor to one student.
   *
   * Set for student sign-ins and for Planly, which runs on a student's behalf.
   * The student-scoped tools take no `usn` argument at all — they read it from
   * here — so Planly acting for one student cannot be argued, prompted or
   * tricked into reading another's record. The capability is absent, not
   * merely discouraged.
   */
  usn: z.string().min(1).optional(),
});

export type Actor = z.infer<typeof ActorSchema>;

/**
 * One line per tool call, written whether the call succeeded or was refused.
 *
 * Refusals matter more than successes here: they are the evidence that the
 * permission allowlist is actually doing its job, which is exactly what a
 * judge or a data-protection reviewer will ask about.
 */
export const AuditEntrySchema = z.object({
  auditId: z.string().trim().min(1),
  actor: ActorSchema,
  tool: z.string().min(1),
  /** Arguments with sensitive fields redacted — never a raw parent phone. */
  args: z.record(z.string(), z.unknown()),
  status: z.enum(['ok', 'validation_error', 'permission_denied', 'error']),
  errorMessage: z.string().max(1000).nullable().default(null),
  /** Milliseconds the tool took. */
  durationMs: z.number().min(0).optional(),
  at: IsoDateTimeSchema,
});

export type AuditEntry = z.infer<typeof AuditEntrySchema>;

/** Field names scrubbed before an audit row is written. */
export const REDACTED_FIELDS = new Set([
  'phone',
  'parentPhone',
  'to',
  'from',
  'privateKey',
  'apiKey',
  'authToken',
  'password',
]);

const MASK_CHAR = '•';

/**
 * Deep-redacts sensitive values for the audit log.
 *
 * Phone numbers keep their first three and last two characters so a human
 * reading the log can still tell two parents apart without the audit log
 * itself becoming a directory of personal phone numbers.
 */
export function redactArgs(args: unknown): Record<string, unknown> {
  const walk = (value: unknown, key?: string): unknown => {
    if (key && REDACTED_FIELDS.has(key) && typeof value === 'string') {
      if (/^\+?\d{6,}$/.test(value)) {
        const masked = MASK_CHAR.repeat(Math.max(0, value.length - 5));
        return value.slice(0, 3) + masked + value.slice(-2);
      }
      return '[redacted]';
    }
    if (Array.isArray(value)) return value.map((v) => walk(v));
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, walk(v, k)]),
      );
    }
    return value;
  };

  const result = walk(args);
  return result && typeof result === 'object' && !Array.isArray(result)
    ? (result as Record<string, unknown>)
    : { value: result };
}
