import { NextResponse } from 'next/server';
import { z } from 'zod';
import { StudentConnectionSchema, type StudentConnection } from '@eduplus/core';
import { handshakeAndDiscover } from '@eduplus/core/connectors';
import {
  deleteStudentConnection,
  getDb,
  getStudentConnectorPolicy,
  listStudentConnections,
  saveStudentConnection,
  writeAudit,
} from '@eduplus/core/repositories';
import { errorResponse } from '@/lib/api';
import { planlyActor, requireStudent } from '@/lib/student-auth';

/**
 * The student app's connector picker.
 *
 * A student chooses from the college's approved list by id. There is no field
 * anywhere in this file that accepts a URL from the app — that is what makes
 * "notes and calendar only" an actual property of the system rather than a
 * check someone can talk their way past.
 */

const ConnectSchema = z.object({ id: z.string().min(1).max(64) });

const ToggleSchema = z.object({
  id: z.string().min(1).max(64),
  tool: z.string().min(1).max(128),
  enabled: z.boolean(),
});

export async function GET(request: Request) {
  try {
    const student = await requireStudent(request);
    const db = getDb();

    const [policy, connections] = await Promise.all([
      getStudentConnectorPolicy(db),
      listStudentConnections(db, student.usn),
    ]);

    const connected = new Map(connections.map((c) => [c.id, c]));

    return NextResponse.json({
      enabled: policy.enabled,
      available: policy.approved.map((entry) => {
        const connection = connected.get(entry.id);
        return {
          id: entry.id,
          category: entry.category,
          displayName: entry.displayName,
          description: entry.description,
          dataNote: entry.dataNote,
          connected: Boolean(connection),
          tools:
            connection?.discoveredTools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              enabled: connection.enabledTools.includes(tool.name),
            })) ?? [],
        };
      }),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Attaches an approved connector to this student's account. */
export async function POST(request: Request) {
  try {
    const student = await requireStudent(request);
    const db = getDb();

    const parsed = ConnectSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Expected a connector id.' }, { status: 400 });
    }

    const policy = await getStudentConnectorPolicy(db);
    if (!policy.enabled) {
      return NextResponse.json(
        { error: 'Your college has not enabled student connectors.' },
        { status: 403 },
      );
    }

    // The id must name an approved entry. Anything else is simply not found —
    // there is no path here that reaches a server a faculty member did not vet.
    const entry = policy.approved.find((e) => e.id === parsed.data.id);
    if (!entry) {
      return NextResponse.json(
        { error: 'That connector is not on your college’s approved list.' },
        { status: 404 },
      );
    }

    try {
      const result = await handshakeAndDiscover(entry.serverUrl);

      const connection: StudentConnection = StudentConnectionSchema.parse({
        id: entry.id,
        usn: student.usn,
        // Off until the student picks. Connecting a service is not the same as
        // handing an assistant everything that service can do.
        enabledTools: [],
        discoveredTools: result.tools,
        connectedAt: new Date().toISOString(),
        lastError: null,
      });

      await saveStudentConnection(db, connection);
      await writeAudit(db, {
        actor: planlyActor(student),
        tool: 'student_connector.connect',
        args: { id: entry.id, category: entry.category },
        status: 'ok',
      });

      return NextResponse.json({
        message: `${entry.displayName} connected. ${result.tools.length} tool${
          result.tools.length === 1 ? '' : 's'
        } available — switch on the ones you want Planly to use.`,
      });
    } catch (error) {
      return NextResponse.json(
        {
          error: `Could not reach ${entry.displayName}. ${
            error instanceof Error ? error.message : ''
          }`.trim(),
        },
        { status: 400 },
      );
    }
  } catch (error) {
    return errorResponse(error);
  }
}

/** Switches one of a connected service's tools on or off for this student. */
export async function PATCH(request: Request) {
  try {
    const student = await requireStudent(request);
    const db = getDb();

    const parsed = ToggleSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Expected id, tool and enabled.' }, { status: 400 });
    }

    const connections = await listStudentConnections(db, student.usn);
    const connection = connections.find((c) => c.id === parsed.data.id);
    if (!connection) {
      return NextResponse.json({ error: 'You have not connected that service.' }, { status: 404 });
    }
    if (!connection.discoveredTools.some((t) => t.name === parsed.data.tool)) {
      return NextResponse.json({ error: 'That service has no such tool.' }, { status: 400 });
    }

    const enabled = new Set(connection.enabledTools);
    if (parsed.data.enabled) enabled.add(parsed.data.tool);
    else enabled.delete(parsed.data.tool);

    await saveStudentConnection(db, { ...connection, enabledTools: [...enabled].sort() });

    return NextResponse.json({
      message: parsed.data.enabled
        ? `Planly can now use ${parsed.data.tool}.`
        : `${parsed.data.tool} switched off.`,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const student = await requireStudent(request);
    const db = getDb();

    const id = new URL(request.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Expected an id.' }, { status: 400 });

    await deleteStudentConnection(db, student.usn, id);
    return NextResponse.json({ message: 'Disconnected. Planly can no longer use it.' });
  } catch (error) {
    return errorResponse(error);
  }
}
