import { z } from 'zod';
import { IsoDateSchema, IsoDateTimeSchema, UsnSchema } from './common.js';

/**
 * A recovery task shown in the student app, created from an approved
 * intervention. Deliberately small and concrete ("Attend all 6 DBMS classes
 * this week") so progress is visible to the student.
 */
export const StudentTaskSchema = z.object({
  taskId: z.string().trim().min(1),
  usn: UsnSchema,
  interventionId: z.string().trim().min(1).nullable().default(null),
  title: z.string().trim().min(1).max(160),
  description: z.string().max(800).optional(),
  dueDate: IsoDateSchema.optional(),
  done: z.boolean().default(false),
  doneAt: IsoDateTimeSchema.nullable().default(null),
  createdAt: IsoDateTimeSchema.optional(),
});

export type StudentTask = z.infer<typeof StudentTaskSchema>;
