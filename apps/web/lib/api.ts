import 'server-only';
import { providerForConnector } from './connector-oauth';
import { NextResponse } from 'next/server';
import { ForbiddenError, UnauthorizedError, actorFor, requireFaculty } from './auth';
import { describeModelError } from './agents/client';
import { getDb } from '@eduplus/core/repositories';
import type { ToolContext } from '@eduplus/core/tools';

/**
 * Everything a faculty-only API route needs: the session, a tool context with
 * the right actor, and the db handle.
 */
/**
 * A faculty member's name as a student should see it.
 *
 * The Actor carries only a uid, because that is all the permission layer and
 * the audit log need. Anything a STUDENT reads needs a human name — an
 * assignment that says "set by 68Hqqh9Z2fQeBnoHntgzj83hp533" is worse than
 * one that says nothing.
 */
export async function facultyDisplayName(): Promise<string> {
  const session = await requireFaculty();
  if (session.name && session.name.trim()) return session.name.trim();
  // Fall back to the local part of the email: "faculty@eduplus.local" reads
  // as "faculty", which is at least a word.
  const local = session.email?.split('@')[0]?.trim();
  return local && local.length > 0 ? local : 'Your mentor';
}

export async function facultyContext(): Promise<ToolContext> {
  const session = await requireFaculty();
  const db = getDb();
  return {
    db,
    actor: actorFor(session),
    // Unsealing a connector's OAuth tokens needs the encryption key and this
    // app's storage, neither of which belongs in @eduplus/core — so the
    // capability is injected here rather than imported there.
    remoteAuthProvider: (connectorId) => providerForConnector(db, connectorId),
  };
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
