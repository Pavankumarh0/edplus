import { z } from 'zod';
import { IsoDateTimeSchema } from './common';

/**
 * Connectors — what the agents in this system are allowed to reach.
 *
 * A "connector" here is a source of tools, not an integration marketplace
 * entry. Two kinds exist and they are genuinely different:
 *
 *   native   — EduPlus's own tool registry, calling our domain services
 *              directly. No URL, no credentials, no network hop.
 *   google   — a real external provider reached over OAuth. Connected only
 *              when credentials are configured AND a live call succeeds.
 *
 * There is deliberately no "paste any remote MCP server URL" kind. Accepting
 * an arbitrary URL would mean defending against SSRF, DNS rebinding and
 * redirect laundering, and would pipe an untrusted server's tool DESCRIPTIONS
 * into a model's context — a prompt-injection surface pointed straight at a
 * system holding student records. That is a deliberate omission, not a gap.
 */

export const CONNECTOR_KINDS = ['native', 'google'] as const;
export const ConnectorKindSchema = z.enum(CONNECTOR_KINDS);
export type ConnectorKind = z.infer<typeof ConnectorKindSchema>;

export const CONNECTOR_STATUSES = ['connected', 'needs_setup', 'error'] as const;
export const ConnectorStatusSchema = z.enum(CONNECTOR_STATUSES);
export type ConnectorStatus = z.infer<typeof ConnectorStatusSchema>;

/**
 * How consequential a tool is, for the UI and the approval story.
 *
 * Derived from the tool definition rather than stored, so it cannot drift from
 * what the permission layer actually enforces.
 */
export const TOOL_CLASSES = ['read_only', 'internal_write', 'consequential'] as const;
export const ToolClassSchema = z.enum(TOOL_CLASSES);
export type ToolClass = z.infer<typeof ToolClassSchema>;

export const TOOL_CLASS_LABELS: Record<ToolClass, string> = {
  read_only: 'Reads only',
  internal_write: 'Writes records',
  consequential: 'Needs a human',
};

/**
 * Settings a faculty member can change, stored at `config/connectors`.
 *
 * Only the disabled list is persisted. The catalogue itself comes from the
 * tool registry at runtime, so adding a tool to the code adds it here with no
 * migration and no chance of the two drifting.
 */
export const ConnectorSettingsSchema = z.object({
  /**
   * Tools switched off for every agent.
   *
   * Enforced in `executeTool`, not just hidden in the UI — a tool named here
   * is refused and the refusal is audited, even if a model somehow still knows
   * the name.
   */
  disabledTools: z.array(z.string().min(1)).default([]),
  updatedAt: IsoDateTimeSchema.optional(),
  updatedBy: z.string().min(1).optional(),
});

export type ConnectorSettings = z.infer<typeof ConnectorSettingsSchema>;

export const DEFAULT_CONNECTOR_SETTINGS: ConnectorSettings = { disabledTools: [] };

/** One tool as the Connectors page shows it. */
export interface ConnectorTool {
  name: string;
  title: string;
  description: string;
  toolClass: ToolClass;
  enabled: boolean;
  /** Which agents' allowlists name this tool. Empty means faculty-only. */
  agents: string[];
}

/** One connector card. */
export interface ConnectorCard {
  id: string;
  kind: ConnectorKind;
  name: string;
  description: string;
  /** What having it connected actually enables. */
  enables: string[];
  authMethod: string;
  status: ConnectorStatus;
  /** Why it is not connected, when it is not. */
  statusDetail: string | null;
  tools: ConnectorTool[];
}

/** Classifies a tool from its own flags, so the label cannot drift. */
export function classifyTool(tool: { readOnly: boolean; consequential: boolean }): ToolClass {
  if (tool.consequential) return 'consequential';
  return tool.readOnly ? 'read_only' : 'internal_write';
}
