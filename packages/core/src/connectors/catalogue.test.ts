import { describe, expect, it } from 'vitest';
import { buildCatalogue, catalogueSummary } from './catalogue';
import { classifyTool, DEFAULT_CONNECTOR_SETTINGS } from '../schemas/connector';
import { AGENT_TOOLS } from '../tools/permissions';
import { TOOLS } from '../tools/definitions';
import type { Actor } from '../schemas/audit';

const faculty: Actor = { kind: 'faculty', id: 'faculty-1' };
const student: Actor = { kind: 'student', id: 'student-1', usn: '1OX21IS045' };
const planly: Actor = { kind: 'agent', id: 'planly', agentName: 'planly', usn: '1OX21IS045' };

describe('the connector catalogue', () => {
  it('is derived from the live registry, not a stored copy', () => {
    // If someone adds a tool to the registry, the page must show it without a
    // second edit — otherwise the two drift and the page starts lying about
    // what the agents can reach.
    const cards = buildCatalogue(faculty, DEFAULT_CONNECTOR_SETTINGS);
    const listed = new Set(cards.flatMap((c) => c.tools.map((t) => t.name)));

    for (const name of Object.keys(TOOLS)) {
      expect(listed.has(name), `${name} missing from the catalogue`).toBe(true);
    }
  });

  it('shows a tool’s class from its own flags, so the label cannot drift', () => {
    const cards = buildCatalogue(faculty, DEFAULT_CONNECTOR_SETTINGS);
    for (const card of cards) {
      for (const tool of card.tools) {
        expect(tool.toolClass).toBe(classifyTool(TOOLS[tool.name]!));
      }
    }
  });

  it('names every consequential tool as needing a human', () => {
    const cards = buildCatalogue(faculty, DEFAULT_CONNECTOR_SETTINGS);
    const consequential = cards
      .flatMap((c) => c.tools)
      .filter((t) => t.toolClass === 'consequential')
      .map((t) => t.name);

    expect(new Set(consequential)).toEqual(
      new Set([
        'add_connector',
        'approve_student_connector',
        'cancel_meeting',
        'remove_connector',
        'revoke_student_connector',
        'schedule_meeting',
        'schedule_parent_call',
        'set_connector_tool',
      ]),
    );
  });

  it('says which agents can reach a tool, matching the allowlists', () => {
    const cards = buildCatalogue(faculty, DEFAULT_CONNECTOR_SETTINGS);
    const planlyTool = cards
      .flatMap((c) => c.tools)
      .find((t) => t.name === 'get_my_progress');

    expect(planlyTool?.agents).toEqual(['Planly']);

    // A consequential tool is in no agent's allowlist, and the page must say so
    // rather than leaving it ambiguous.
    const call = cards.flatMap((c) => c.tools).find((t) => t.name === 'schedule_parent_call');
    expect(call?.agents).toEqual([]);
  });

  it('marks a disabled tool as disabled', () => {
    const cards = buildCatalogue(faculty, { disabledTools: ['get_student'] });
    const tool = cards.flatMap((c) => c.tools).find((t) => t.name === 'get_student');

    expect(tool?.enabled).toBe(false);
    // Still listed: a mentor has to be able to find it again to switch it on.
    expect(tool).toBeDefined();
  });
});

describe('what each actor sees', () => {
  it('shows a student nothing, because tools are granted to agents not students', () => {
    // A student's app reads Firestore directly under the security rules. The
    // only tools in their world are the ones Planly runs on their behalf.
    const cards = buildCatalogue(student, DEFAULT_CONNECTOR_SETTINGS);
    expect(cards.flatMap((c) => c.tools)).toEqual([]);
  });

  it('never shows an actor a tool their allowlist does not grant', () => {
    for (const actor of [student, planly]) {
      const listed = buildCatalogue(actor, DEFAULT_CONNECTOR_SETTINGS).flatMap((c) =>
        c.tools.map((t) => t.name),
      );
      for (const name of listed) {
        const reachable =
          actor.kind === 'agent'
            ? AGENT_TOOLS[actor.agentName as keyof typeof AGENT_TOOLS].includes(name)
            : false;
        expect(reachable, `${actor.kind} should not see ${name}`).toBe(true);
      }
    }
  });

  it('drops the Google card for an actor with no meeting tools', () => {
    // An empty connector card is noise on a student's screen.
    const cards = buildCatalogue(planly, DEFAULT_CONNECTOR_SETTINGS);
    expect(cards.some((c) => c.id === 'google-calendar')).toBe(false);
  });
});

describe('connector status', () => {
  it('does not claim Google is connected without credentials', () => {
    // The meetings feature silently falls back to a Jitsi room when Google is
    // unconfigured. A page reading "Connected" while the fallback runs would
    // be telling a mentor their data is somewhere it is not.
    const cards = buildCatalogue(faculty, DEFAULT_CONNECTOR_SETTINGS);
    const google = cards.find((c) => c.id === 'google-calendar')!;

    if (process.env.GOOGLE_REFRESH_TOKEN) {
      expect(google.status).toBe('connected');
    } else {
      expect(google.status).toBe('needs_setup');
      expect(google.statusDetail).toMatch(/GOOGLE_CLIENT_ID/);
    }
  });

  it('counts enabled tools for the header', () => {
    const cards = buildCatalogue(faculty, { disabledTools: ['get_student', 'list_meetings'] });
    const summary = catalogueSummary(cards);

    expect(summary.tools - summary.enabled).toBe(2);
    expect(summary.connectors).toBe(2);
  });
});
