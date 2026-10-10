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
 *   remote_mcp — a remote MCP server someone pasted the URL of.
 *
 * `remote_mcp` is the dangerous one and is treated accordingly: the URL is
 * checked against SSRF and DNS-rebinding rules before any request, redirects
 * are refused, a connector is only "connected" once a handshake and a
 * tools/list actually succeeded, every discovered tool starts DISABLED, and
 * results are fenced as untrusted data before a model reads them.
 */

export const CONNECTOR_KINDS = ['native', 'google', 'remote_mcp'] as const;
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

// ─────────────────────────────────────────────────────────────────────────────
// Remote MCP connectors
// ─────────────────────────────────────────────────────────────────────────────

/** One tool discovered from a remote server, with the schema it advertised. */
export const RemoteToolSchema = z.object({
  name: z.string().min(1).max(128),
  /**
   * The server's own words, kept verbatim but capped.
   *
   * Stored as written — including anything that reads like an instruction —
   * because an administrator reviewing a connector needs to see exactly what
   * it is advertising before switching it on. It is fenced, never trusted.
   */
  description: z.string().max(1000),
  inputSchema: z.record(z.string(), z.unknown()),
  /**
   * Off until a human turns it on.
   *
   * A newly discovered tool from a third-party server is not something to
   * hand an agent automatically.
   */
  enabled: z.boolean().default(false),
});

export type RemoteTool = z.infer<typeof RemoteToolSchema>;

export const RemoteConnectorSchema = z.object({
  connectorId: z.string().min(1),
  displayName: z.string().trim().min(1).max(80),
  serverUrl: z.string().url(),
  description: z.string().trim().max(500).optional(),

  /** Who added it. Connectors are institution-wide, added by faculty. */
  ownerId: z.string().min(1),

  /** Set by an actual handshake, never by saving the URL. */
  status: ConnectorStatusSchema,
  /** What the server called itself during the handshake. */
  serverName: z.string().max(200).nullable().default(null),
  serverVersion: z.string().max(80).nullable().default(null),

  tools: z.array(RemoteToolSchema).default([]),

  lastConnectedAt: IsoDateTimeSchema.nullable().default(null),
  /** Redacted before storage — never a credential or a full URL with secrets. */
  lastError: z.string().max(500).nullable().default(null),

  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

export type RemoteConnector = z.infer<typeof RemoteConnectorSchema>;

/**
 * The tool name an agent sees for a remote tool.
 *
 * Namespaced so a remote server cannot shadow a native tool: a connector
 * advertising `get_student` must not be able to intercept calls meant for
 * ours. The prefix also tells the model, and the audit log, where a tool came
 * from.
 */
export function remoteToolName(connectorId: string, toolName: string): string {
  return `mcp__${connectorId}__${toolName}`;
}

/** Splits a namespaced name back into its parts, or null if it is not one. */
export function parseRemoteToolName(
  name: string,
): { connectorId: string; toolName: string } | null {
  const match = name.match(/^mcp__([^_]+(?:_[^_]+)*?)__(.+)$/);
  if (!match) return null;
  return { connectorId: match[1]!, toolName: match[2]! };
}
