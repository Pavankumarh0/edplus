import { z } from 'zod';
import { IsoDateTimeSchema, ParentLanguageSchema, PhoneSchema, UsnSchema } from './common';

/**
 * Parent contact details.
 *
 * SENSITIVE. Stored at `students/{usn}/private/parent`, NOT on the student
 * document.
 *
 * The reason is mechanical: Firestore security rules authorise whole
 * documents, never individual fields. There is no way to serve
 * `students/{usn}` to a student while withholding one field from it. Keeping
 * the contact on the student document and simply not rendering it would ship
 * every parent's phone number to every student's device.
 */
export const ParentContactSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: PhoneSchema,
  preferredLanguage: ParentLanguageSchema,
  updatedAt: IsoDateTimeSchema.optional(),
});

export type ParentContact = z.infer<typeof ParentContactSchema>;

/** Firestore path of the private parent-contact document. */
export function parentContactPath(usn: string): string {
  return `students/${usn}/private/parent`;
}

/**
 * The student document. Deliberately carries no contact data of any kind —
 * see `ParentContactSchema`.
 */
export const StudentSchema = z.object({
  usn: UsnSchema,
  name: z.string().trim().min(1).max(120),
  semester: z.number().int().min(1).max(8),
  section: z.string().trim().min(1).max(8),
  department: z.string().trim().min(1).max(80),
  /** Faculty uid who mentors this student. */
  mentorId: z.string().trim().min(1).optional(),
  /** Firebase Auth uid, once the student has signed in to the mobile app. */
  authUid: z.string().trim().min(1).optional(),
  /** True when a parent contact exists in the private subcollection. Lets the
   *  dashboard show or disable "Call parent" without reading the contact. */
  hasParentContact: z.boolean().optional(),
  createdAt: IsoDateTimeSchema.optional(),
  updatedAt: IsoDateTimeSchema.optional(),
});

export type Student = z.infer<typeof StudentSchema>;

/**
 * What the Flutter student app sees about itself.
 *
 * Defence in depth rather than the primary control — the rules are the
 * enforcement point — so that even a server bug in a student-facing API route
 * cannot leak a mentor assignment or an internal uid.
 */
export const PublicStudentSchema = StudentSchema.pick({
  usn: true,
  name: true,
  semester: true,
  section: true,
  department: true,
});

export type PublicStudent = z.infer<typeof PublicStudentSchema>;

export function toPublicStudent(student: Student): PublicStudent {
  return PublicStudentSchema.parse(student);
}

/**
 * Student data recovered from a CSV row, before upsert.
 *
 * This is an input DTO, not a stored shape: `parent` rides along here and the
 * repository splits it out into the private subcollection on write. Everything
 * but the USN is optional, because a valid attendance sheet may carry nothing
 * but USNs and counts — and the repository writes only the fields present, so
 * importing a nameless sheet never blanks a name an earlier upload recorded.
 */
export const StudentUpsertSchema = StudentSchema.partial({
  name: true,
  semester: true,
  section: true,
  department: true,
}).extend({
  parent: ParentContactSchema.omit({ updatedAt: true }).optional(),
}).omit({ createdAt: true, updatedAt: true, hasParentContact: true });

export type StudentUpsert = z.infer<typeof StudentUpsertSchema>;
