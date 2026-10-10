import { NextResponse } from 'next/server';
import { z } from 'zod';
import { buildPlanRequest } from '@eduplus/core';
import { getActivePlan, getDb, listActivities, listTasks } from '@eduplus/core/repositories';
import { computeAdherence } from '@eduplus/core';
import { runPlanly } from '@/lib/agents/planly';
import { planlyActor, requireStudent } from '@/lib/student-auth';
import { errorResponse } from '@/lib/api';

const BodySchema = z.object({
  weeks: z.number().int().min(1).max(8).default(2),
  /** Anything the student wants taken into account. */
  note: z.string().max(600).optional(),
});

export const maxDuration = 180;

/** Generates a whole plan in one request — the "Make me a plan" button. */
export async function POST(request: Request) {
  try {
    const student = await requireStudent(request);

    const parsed = BodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Bad request.' }, { status: 400 });
    }

    const result = await runPlanly(
      [
        {
          role: 'user',
          content: buildPlanRequest({
            weeks: parsed.data.weeks,
            startDate: new Date().toISOString().slice(0, 10),
            note: parsed.data.note,
          }),
        },
      ],
      { db: getDb(), actor: planlyActor(student) },
      12,
    );

    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}

/** The current plan, its tasks and how the student is doing against it. */
export async function GET(request: Request) {
  try {
    const student = await requireStudent(request);
    const db = getDb();

    const [plan, tasks, activities] = await Promise.all([
      getActivePlan(db, student.usn),
      listTasks(db, student.usn),
      listActivities(db, student.usn),
    ]);

    return NextResponse.json({
      plan,
      adherence: computeAdherence(tasks, new Date().toISOString().slice(0, 10)),
      taskCount: tasks.length,
      activityCount: activities.length,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
