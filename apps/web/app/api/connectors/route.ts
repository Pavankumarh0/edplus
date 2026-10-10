import { NextResponse } from 'next/server';
import { z } from 'zod';
import { TOOL_NAMES } from '@eduplus/core/tools';
import { buildCatalogue, catalogueSummary } from '@eduplus/core/connectors';
import { getConnectorSettings, setToolEnabled } from '@eduplus/core/repositories';
import { errorResponse, facultyContext } from '@/lib/api';

/**
 * The Connectors page.
 *
 * The catalogue is built from the live tool registry and the caller's own
 * allowlist, so what a faculty member sees here is the same thing the
 * permission layer enforces — not a second list that could drift from it.
 */

const ToggleSchema = z.object({
  tool: z.string().min(1),
  enabled: z.boolean(),
});

export async function GET() {
  try {
    const ctx = await facultyContext();
    const settings = await getConnectorSettings(ctx.db);
    const connectors = buildCatalogue(ctx.actor, settings);

    return NextResponse.json({
      connectors,
      summary: catalogueSummary(connectors),
      updatedAt: settings.updatedAt ?? null,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Switches one tool on or off for every agent, immediately. */
export async function PATCH(request: Request) {
  try {
    const ctx = await facultyContext();

    const parsed = ToggleSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Expected a tool name and enabled flag.' }, { status: 400 });
    }

    // Guard against a typo silently disabling nothing — and against a client
    // writing junk names into the settings document.
    if (!TOOL_NAMES.includes(parsed.data.tool)) {
      return NextResponse.json(
        { error: `No such tool: "${parsed.data.tool}".` },
        { status: 400 },
      );
    }

    const settings = await setToolEnabled(
      ctx.db,
      parsed.data.tool,
      parsed.data.enabled,
      ctx.actor.id,
    );
    const connectors = buildCatalogue(ctx.actor, settings);

    return NextResponse.json({
      connectors,
      summary: catalogueSummary(connectors),
      message: parsed.data.enabled
        ? `${parsed.data.tool} is available to the agents again.`
        : `${parsed.data.tool} is switched off. Every agent lost it just now.`,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
