import { z } from 'zod';
import { IsoDateSchema, IsoDateTimeSchema, UsnSchema } from './common.js';
import { OutcomeSchema } from './snapshot.js';

export const INTERVENTION_TYPES = [
  'mentor_meeting',
  'extra_class',
  'assignment_support',
  'parent_call',
  'ptm_invite',
  'counselling',
  'peer_tutoring',
  'attendance_warning',
] as const;
export const InterventionTypeSchema = z.enum(INTERVENTION_TYPES);
export type InterventionType = z.infer<typeof InterventionTypeSchema>;

export const INTERVENTION_TYPE_LABELS: Record<InterventionType, string> = {
  mentor_meeting: 'Mentor meeting',
  extra_class: 'Extra class',
  assignment_support: 'Assignment support',
  parent_call: 'Parent call',
  ptm_invite: 'Parent–teacher meeting invite',
  counselling: 'Counselling',
  peer_tutoring: 'Peer tutoring',
  attendance_warning: 'Attendance warning',
};

/**
 * Lifecycle: proposed → approved → in_progress → completed | cancelled.
 *
 * `proposed` is the only status an AI agent may create. Everything past it
 * requires a faculty action in the UI — agents advise, humans decide.
 */
export const INTERVENTION_STATUSES = [
  'proposed',
  'approved',
  'in_progress',
  'completed',
  'cancelled',
] as const;
export const InterventionStatusSchema = z.enum(INTERVENTION_STATUSES);
export type InterventionStatus = z.infer<typeof InterventionStatusSchema>;

/** Which status transitions are legal. Enforced in the tool layer. */
export const ALLOWED_STATUS_TRANSITIONS: Record<InterventionStatus, InterventionStatus[]> = {
  proposed: ['approved', 'cancelled'],
  approved: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

export function canTransition(from: InterventionStatus, to: InterventionStatus): boolean {
  return ALLOWED_STATUS_TRANSITIONS[from].includes(to);
}

export const InterventionSchema = z.object({
  interventionId: z.string().trim().min(1),
  usn: UsnSchema,
  type: InterventionTypeSchema,
  /** Why this was raised — should quote real numbers from the snapshot. */
  reason: z.string().trim().min(1).max(2000),
  status: InterventionStatusSchema,
  /** Faculty uid responsible. */
  owner: z.string().trim().min(1).optional(),
  dueDate: IsoDateSchema.optional(),
  notes: z.string().max(4000).optional(),

  /**
   * The snapshot that justified this intervention. Frozen at creation so the
   * before/after comparison is honest even after many later snapshots.
   */
  baselineSnapshotId: z.string().trim().min(1),
  baselineScore: z.number().min(0).max(100),

  /** First snapshot created after completion — fills in automatically. */
  outcomeSnapshotId: z.string().trim().min(1).nullable().default(null),
  outcomeScore: z.number().min(0).max(100).nullable().default(null),
  outcome: OutcomeSchema.nullable().default(null),

  /** Set when an agent proposed this, for the audit trail. */
  proposedBy: z.string().trim().min(1).optional(),
  createdAt: IsoDateTimeSchema.optional(),
  updatedAt: IsoDateTimeSchema.optional(),
  completedAt: IsoDateTimeSchema.optional(),
});

export type Intervention = z.infer<typeof InterventionSchema>;

export const OPEN_STATUSES: InterventionStatus[] = ['proposed', 'approved', 'in_progress'];

export function isOpen(intervention: Pick<Intervention, 'status'>): boolean {
  return OPEN_STATUSES.includes(intervention.status);
}
