import {
  classifyTool,
  type ConnectorCard,
  type ConnectorTool,
  type ConnectorSettings,
} from '../schemas/connector';
import type { Actor } from '../schemas/audit';
import { AGENT_TOOLS, toolsForActor } from '../tools/permissions';
import { TOOLS } from '../tools/definitions';
import { googleConfig } from '../meetings/provider';

/**
 * Builds the Connectors page from what is actually wired up.
 *
 * The catalogue is derived at runtime from the tool registry and the agent
 * allowlists rather than stored. That means the page cannot claim a tool the
 * system does not have, cannot miss one that was added in code, and cannot
 * show an agent reaching something its allowlist does not name — the page is a
 * view of the enforcement, not a second copy of it.
 */

const AGENT_LABELS: Record<string, string> = {
  report: 'Report agent',
  copilot: 'Copilot',
  voice: 'Voice agent',
  planly: 'Planly',
};

/** Which agents' allowlists name this tool. */
function agentsFor(toolName: string): string[] {
  return Object.entries(AGENT_TOOLS)
    .filter(([, names]) => names.includes(toolName))
    .map(([agent]) => AGENT_LABELS[agent] ?? agent);
}

function toolCard(name: string, settings: ConnectorSettings): ConnectorTool | null {
  const tool = TOOLS[name];
  if (!tool) return null;
  return {
    name: tool.name,
    title: tool.title,
    // The registry description is written for a model and runs long. The page
    // wants the first sentence, which is the part written for a human.
    description: tool.description.split('. ')[0]!.replace(/\.$/, '') + '.',
    toolClass: classifyTool(tool),
    enabled: !settings.disabledTools.includes(tool.name),
    agents: agentsFor(tool.name),
  };
}

/**
 * The native connector: EduPlus's own tools.
 *
 * Always connected, because there is nothing to connect to — these call our
 * domain services in-process. It is listed as a connector anyway so the page
 * tells the whole truth about what the agents can reach, rather than only the
 * external half.
 */
function nativeConnector(actor: Actor, settings: ConnectorSettings): ConnectorCard {
  const tools = toolsForActor(actor)
    .map((name) => toolCard(name, settings))
    .filter((t): t is ConnectorTool => t !== null)
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    id: 'eduplus-native',
    kind: 'native',
    name: 'EduPlus tools',
    description:
      'The academic record, the risk engine and the workflow, exposed as declared tools. ' +
      'Called in-process — no network hop and no third party.',
    enables: [
      'Read a student’s risk evidence, attendance, marks and submissions',
      'Write reports, interventions, study plans and recovery tasks',
      'Queue a parent call or book a meeting, once a human approves it',
    ],
    authMethod: 'Your EduPlus session',
    status: 'connected',
    statusDetail: null,
    tools,
  };
}

/**
 * The meeting provider.
 *
 * Jitsi by default and by choice: it needs no account on either side, so a
 * mentor and a student can join from their two dashboards with nothing to set
 * up. Google Meet is used instead only when GOOGLE_* credentials are present,
 * and the card says which is actually in use — a page claiming one while the
 * other runs would misstate where the meeting lives.
 */
function meetingsConnector(actor: Actor, settings: ConnectorSettings): ConnectorCard {
  const configured = googleConfig() !== null;
  const meetingTools = ['schedule_meeting', 'cancel_meeting', 'list_meetings', 'propose_meeting']
    .filter((name) => toolsForActor(actor).includes(name))
    .map((name) => toolCard(name, settings))
    .filter((t): t is ConnectorTool => t !== null);

  return {
    id: 'meetings',
    kind: 'google',
    name: configured ? 'Google Meet' : 'Jitsi Meet',
    description: configured
      ? 'Puts a mentor–student meeting on a real Google Calendar with a Meet link, ' +
        'and shows it on both dashboards.'
      : 'Creates a private video room for a mentor–student meeting and puts the link ' +
        'on both dashboards. No account needed on either side.',
    enables: [
      'Create a meeting with a live video link',
      'Show it on the mentor’s agenda and the student’s calendar',
      'Take the link away again when a meeting is cancelled',
    ],
    authMethod: configured ? 'Google OAuth — calendar.events scope' : 'None required',
    // Jitsi needs nothing configured, so it is genuinely connected rather than
    // awaiting setup. Reporting it as "needs setup" would be telling a mentor
    // to fix something that is working.
    status: 'connected',
    statusDetail: configured
      ? null
      : 'Rooms are created on meet.jit.si, which needs no account. Set GOOGLE_CLIENT_ID, ' +
        'GOOGLE_CLIENT_SECRET and GOOGLE_REFRESH_TOKEN to use Google Meet instead — the ' +
        'same button then creates real calendar events.',
    tools: meetingTools,
  };
}

/** Every connector this actor can see, with their tools. */
export function buildCatalogue(actor: Actor, settings: ConnectorSettings): ConnectorCard[] {
  const cards = [nativeConnector(actor, settings), meetingsConnector(actor, settings)];
  // A student has no meeting tools of their own — their mentor books meetings —
  // so an empty card would just be noise on their screen.
  return cards.filter((card) => card.kind === 'native' || card.tools.length > 0);
}

/**
 * Counts for the page header.
 *
 * Counted by distinct tool name, because a tool can legitimately appear under
 * more than one connector — `list_meetings` belongs to both the native
 * registry and the Google card — and summing the cards would report more tools
 * than the system has.
 */
export function catalogueSummary(cards: ConnectorCard[]): {
  connectors: number;
  connected: number;
  tools: number;
  enabled: number;
} {
  const byName = new Map<string, ConnectorTool>();
  for (const card of cards) {
    for (const tool of card.tools) byName.set(tool.name, tool);
  }

  return {
    connectors: cards.length,
    connected: cards.filter((c) => c.status === 'connected').length,
    tools: byName.size,
    enabled: [...byName.values()].filter((t) => t.enabled).length,
  };
}
