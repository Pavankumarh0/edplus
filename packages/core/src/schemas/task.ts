import { z } from 'zod';
import { IsoDateSchema, IsoDateTimeSchema, UsnSchema } from './common';
import { TaskKindSchema } from './plan';

/**
 * A recovery task shown in the student app, created from an approved
 * intervention. Deliberately small and concrete ("Attend all 6 DBMS classes
 * this week") so progress is visible to the student.
 */
export const StudentTaskSchema = z.object({
  taskId: z.string().trim().min(1),
  usn: UsnSchema,
  /** Set when a mentor's intervention created this. */
  interventionId: z.string().trim().min(1).nullable().default(null),
  /** Set when Planly created this. One task collection, two sources — the
   *  student sees a single list and does not need to care which. */
  planId: z.string().trim().min(1).nullable().default(null),

  title: z.string().trim().min(1).max(160),
  description: z.string().max(800).optional(),
  kind: TaskKindSchema.default('study'),
  /** The day this lands on the student's calendar. `dueDate` is a deadline;
   *  this is "do it on this day", which is what a daily plan needs. */
  scheduledFor: IsoDateSchema.nullable().default(null),
  /** Rough effort, so a day's plan can be kept realistic. */
  minutes: z.number().int().min(5).max(240).nullable().default(null),
  /** Links a task to the quiz or coding exercise it opens. */
  activityId: z.string().trim().min(1).nullable().default(null),

  dueDate: IsoDateSchema.optional(),
  done: z.boolean().default(false),
  doneAt: IsoDateTimeSchema.nullable().default(null),
  createdAt: IsoDateTimeSchema.optional(),
});

export type StudentTask = z.infer<typeof StudentTaskSchema>;
