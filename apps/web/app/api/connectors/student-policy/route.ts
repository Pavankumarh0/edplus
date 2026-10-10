import { NextResponse } from 'next/server';
import { z } from 'zod';
import { StudentConnectorCategorySchema } from '@eduplus/core';
import { executeTool } from '@eduplus/core/tools';
import { getStudentConnectorPolicy } from '@eduplus/core/repositories';
import { errorResponse, facultyContext } from '@/lib/api';

/**
 * The list of services students may attach.
 *
 * Faculty-only, and routed through the tool layer so approving a server lands
 * in the same audit log as every other consequential action.
 */

const ApproveSchema = z.object({
  id: z.string().trim().min(1).max(64),
  category: StudentConnectorCategorySchema,
  displayName: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300),
  serverUrl: z.string().min(1).max(2000),
  dataNote: z.string().trim().max(300),
});

export async function GET() {
  try {
    const ctx = await facultyContext();
    const policy = await getStudentConnectorPolicy(ctx.db);
    return NextResponse.json({ policy });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Approves a server. The handshake runs first — an unreachable one is refused. */
export async function POST(request: Request) {
  try {
    const ctx = await facultyContext();

    const parsed = ApproveSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join('; ') },
        { status: 400 },
      );
    }

    const result = await executeTool('approve_student_connector', parsed.data, ctx);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

    const policy = await getStudentConnectorPolicy(ctx.db);
    return NextResponse.json({
      policy,
      message: `${parsed.data.displayName} approved as a ${parsed.data.category} service. Students can connect it now.`,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Revokes a server, which removes it from every student at once. */
export async function DELETE(request: Request) {
  try {
    const ctx = await facultyContext();
    const id = new URL(request.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Expected an id.' }, { status: 400 });

    const result = await executeTool('revoke_student_connector', { id }, ctx);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

    const policy = await getStudentConnectorPolicy(ctx.db);
    return NextResponse.json({
      policy,
      message: 'Revoked. Every student who had it attached has lost it.',
    });
  } catch (error) {
    return errorResponse(error);
  }
}
