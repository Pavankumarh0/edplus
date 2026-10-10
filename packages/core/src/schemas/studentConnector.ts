import { z } from 'zod';
import { IsoDateTimeSchema, UsnSchema } from './common';

/**
 * Connectors a STUDENT may attach to their own account.
 *
 * The rule asked for is "notes and calendar only, nothing else". The obvious
 * implementation — look at the tools a server advertises and reject it if they
 * do not look like notes or calendar tools — does not work, and it is worth
 * being explicit about why: a tool's name and description are written by the
 * server. A server that wants through simply calls its tools `create_note` and
 * describes itself as a notes app. Inferring a category from attacker-supplied
 * text is not a control.
 *
 * So the category lives on an entry a faculty member approved, not on anything
 * the server says about itself. A student picks from that list. They cannot
 * paste an arbitrary URL, which means "nothing else" is true by construction
 * rather than by inspection.
 */

export const STUDENT_CONNECTOR_CATEGORIES = ['notes', 'calendar'] as const;
export const StudentConnectorCategorySchema = z.enum(STUDENT_CONNECTOR_CATEGORIES);
export type StudentConnectorCategory = z.infer<typeof StudentConnectorCategorySchema>;

export const STUDENT_CATEGORY_LABELS: Record<StudentConnectorCategory, string> = {
  notes: 'Notes',
  calendar: 'Calendar',
};

/**
 * One entry on the institution's approved list.
 *
 * Added by faculty through the Connectors page. The URL is vetted once, by a
 * person, against the same SSRF rules as any other connector.
 */
export const ApprovedStudentConnectorSchema = z.object({
  id: z.string().min(1).max(64),
  category: StudentConnectorCategorySchema,
  displayName: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300),
  serverUrl: z.string().url(),
  /** What a student is agreeing to share when they connect it. */
  dataNote: z.string().trim().max(300),
  approvedBy: z.string().min(1),
  approvedAt: IsoDateTimeSchema,
});

export type ApprovedStudentConnector = z.infer<typeof ApprovedStudentConnectorSchema>;

/** The approved list, stored at `config/studentConnectors`. */
export const StudentConnectorPolicySchema = z.object({
  /**
   * Off by default.
   *
   * A college that has not thought about this should not have students
   * attaching external servers because the feature happened to ship.
   */
  enabled: z.boolean().default(false),
  approved: z.array(ApprovedStudentConnectorSchema).default([]),
  updatedAt: IsoDateTimeSchema.optional(),
  updatedBy: z.string().min(1).optional(),
});

export type StudentConnectorPolicy = z.infer<typeof StudentConnectorPolicySchema>;

export const DEFAULT_STUDENT_CONNECTOR_POLICY: StudentConnectorPolicy = {
  enabled: false,
  approved: [],
};

/**
 * One student's connection to an approved entry.
 *
 * Stored at `students/{usn}/connectors/{id}`, so it is theirs and the existing
 * rule gives their app the read. The approved entry it points at is the source
 * of truth for the URL — this record never carries one, so revoking an entry
 * centrally revokes it for every student at once and a stale copy cannot keep
 * a de-approved server reachable.
 */
export const StudentConnectionSchema = z.object({
  id: z.string().min(1).max(64),
  usn: UsnSchema,
  /** Tools the student switched on, by name. Empty means connected but idle. */
  enabledTools: z.array(z.string().min(1).max(128)).default([]),
  /** Names and schemas as discovered when they connected. */
  discoveredTools: z
    .array(
      z.object({
        name: z.string().min(1).max(128),
        description: z.string().max(1000),
        inputSchema: z.record(z.string(), z.unknown()),
      }),
    )
    .default([]),
  connectedAt: IsoDateTimeSchema,
  lastError: z.string().max(500).nullable().default(null),
});

export type StudentConnection = z.infer<typeof StudentConnectionSchema>;

/** Namespaced so a student connector cannot shadow one of Planly's own tools. */
export function studentToolName(connectionId: string, toolName: string): string {
  return `smcp__${connectionId}__${toolName}`;
}

export function parseStudentToolName(
  name: string,
): { connectionId: string; toolName: string } | null {
  const match = name.match(/^smcp__([^_]+(?:_[^_]+)*?)__(.+)$/);
  if (!match) return null;
  return { connectionId: match[1]!, toolName: match[2]! };
}
