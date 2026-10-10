import 'server-only';
import { NextResponse } from 'next/server';
import { ForbiddenError, UnauthorizedError, actorFor, requireFaculty } from './auth';
import { describeModelError } from './agents/client';
import { getDb } from '@eduplus/core/repositories';
import type { ToolContext } from '@eduplus/core/tools';

/**
 * Everything a faculty-only API route needs: the session, a tool context with
 * the right actor, and the db handle.
 */
export async function facultyContext(): Promise<ToolContext> {
  const session = await requireFaculty();
  return { db: getDb(), actor: actorFor(session) };
}

/**
 * Turns a thrown error into a response a person can act on.
 *
 * Auth failures keep their own status so the client can tell "sign in again"
 * from "that did not work".
 */
export function errorResponse(error: unknown): NextResponse {
  if (error instanceof UnauthorizedError) {
    return NextResponse.json({ error: error.message }, { status: 401 });
  }
  if (error instanceof ForbiddenError) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }

  const described = describeModelError(error);
  return NextResponse.json({ error: described.message }, { status: described.status });
}
