import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  INTERVENTION_TYPE_LABELS,
  InterventionTypeSchema,
  UsnSchema,
  type InterventionType,
} from '@eduplus/core';
import { executeTool } from '@eduplus/core/tools';
import { errorResponse, facultyContext } from '@/lib/api';

const CreateSchema = z.object({
  usn: UsnSchema,
  type: InterventionTypeSchema,
  reason: z.string().trim().min(10).max(2000),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** Approve straight away and create the student-facing tasks. */
  approve: z.boolean().optional(),
});

const UpdateSchema = z.object({
  interventionId: z.string().min(1),
  status: z.enum(['proposed', 'approved', 'in_progress', 'completed', 'cancelled']),
  notes: z.string().max(4000).optional(),
});

/** Default recovery tasks per intervention type, written for the student. */
const STARTER_TASKS: Partial<Record<InterventionType, { title: string; description?: string }[]>> = {
  mentor_meeting: [
    { title: 'Meet your mentor this week', description: 'Agree a catch-up plan together.' },
    { title: 'Attend every class for the next five working days' },
  ],
  extra_class: [
    { title: 'Attend the extra class sessions this week' },
    { title: 'Bring a list of the topics you are stuck on' },
  ],
  assignment_support: [
    { title: 'Submit the pending assignments', description: 'Hand them to the subject teacher.' },
    { title: 'Ask for the revision sheet before the next test' },
  ],
  peer_tutoring: [{ title: 'Attend the peer tutoring session this week' }],
  counselling: [{ title: 'Attend the counselling appointment' }],
  attendance_warning: [
    { title: 'Attend every class for the next ten working days' },
    { title: 'Tell your mentor in advance if you cannot attend' },
  ],
};

/**
 * Creates an intervention, optionally approving it and seeding the student's
 * recovery tasks in the same action.
 *
 * Both writes go through the shared tool layer, so a faculty-created
 * intervention lands in the audit log beside an agent-proposed one.
 */
export async function POST(request: Request) {
  try {
    const ctx = await facultyContext();

    const parsed = CreateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join('; ') },
        { status: 400 },
      );
    }

    const { usn, type, reason, dueDate, approve } = parsed.data;

    const created = await executeTool<{ interventionId: string }>(
      'propose_intervention',
      { usn, type, reason, dueDate },
      ctx,
    );
    if (!created.ok) return NextResponse.json({ error: created.error }, { status: 400 });

    const interventionId = created.data!.interventionId;
    let taskCount = 0;

    if (approve) {
      const approved = await executeTool(
        'update_intervention',
        { interventionId, status: 'approved' },
        ctx,
      );
      if (!approved.ok) return NextResponse.json({ error: approved.error }, { status: 400 });

      const tasks = STARTER_TASKS[type];
      if (tasks?.length) {
        const made = await executeTool<{ created: number }>(
          'create_student_tasks',
          { usn, interventionId, tasks: tasks.map((t) => ({ ...t, dueDate })) },
          ctx,
        );
        if (made.ok) taskCount = made.data!.created;
      }
    }

    return NextResponse.json({
      interventionId,
      message:
        `${INTERVENTION_TYPE_LABELS[type]} ${approve ? 'approved' : 'proposed'}` +
        (taskCount > 0 ? ` with ${taskCount} task${taskCount === 1 ? '' : 's'} for the student.` : '.'),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Moves an intervention along its lifecycle. */
export async function PATCH(request: Request) {
  try {
    const ctx = await facultyContext();

    const parsed = UpdateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Expected interventionId and status.' }, { status: 400 });
    }

    const result = await executeTool('update_intervention', parsed.data, ctx);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

    return NextResponse.json({
      message: `Intervention ${parsed.data.status.replace('_', ' ')}.`,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
