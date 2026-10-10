import { NextResponse } from 'next/server';
import { z } from 'zod';
import { buildPlanlyGreeting } from '@eduplus/core';
import { getDb } from '@eduplus/core/repositories';
import { runPlanly } from '@/lib/agents/planly';
import { planlyActor, requireStudent } from '@/lib/student-auth';
import { errorResponse } from '@/lib/api';

const BodySchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1).max(6000),
      }),
    )
    .max(40)
    .default([]),
});

export const maxDuration = 120;

/**
 * Planly chat, called by the mobile app.
 *
 * Note what the body does NOT contain: a USN. The student is taken from the
 * verified ID token, so the request cannot ask about anyone else.
 */
export async function POST(request: Request) {
  try {
    const student = await requireStudent(request);

    const parsed = BodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Bad request.' }, { status: 400 });
    }

    // An empty thread means the app just opened: greet them with something
    // specific rather than waiting for a student to compose a first message.
    const messages =
      parsed.data.messages.length > 0
        ? parsed.data.messages
        : [{ role: 'user' as const, content: buildPlanlyGreeting() }];

    const result = await runPlanly(messages, {
      db: getDb(),
      actor: planlyActor(student),
    });

    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
