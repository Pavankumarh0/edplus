import { getConnectorSettings } from '../repositories/config';
import type { Firestore } from '../repositories/firestore';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ReportBodySchema } from '../schemas/report';
import { TOOLS } from './definitions';
import { AGENT_TOOLS } from './permissions';
import type { AgentName } from './types';

export interface JsonSchema {
  [key: string]: unknown;
}

/**
 * JSON Schema keywords the structured-outputs endpoint rejects.
 *
 * The API returns a 400 for these rather than ignoring them, e.g.
 * "For 'array' type, property 'maxItems' is not supported". They are purely
 * size/shape constraints, so dropping them costs nothing: the Zod schema they
 * were generated from still validates the model's reply before anything is
 * stored. The model is told the SHAPE here; correctness is enforced after.
 */
const UNSUPPORTED_KEYWORDS = new Set([
  'minItems',
  'maxItems',
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'pattern',
  'format',
  'default',
]);

/** Recursively removes keywords the API will not accept. */
function sanitise(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sanitise);
  if (!node || typeof node !== 'object') return node;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (UNSUPPORTED_KEYWORDS.has(key)) continue;
    out[key] = sanitise(value);
  }
  return out;
}

/**
 * Converts a tool's Zod input schema into the JSON Schema the model is given.
 *
 * Generated rather than hand-written so the schema the model sees and the
 * schema `executeTool` validates against can never drift. A model told a field
 * is optional when the validator requires it produces confident, repeated
 * failures that look like model error and are not.
 */
export function toolInputJsonSchema(toolName: string): JsonSchema {
  const tool = TOOLS[toolName];
  if (!tool) throw new Error(`No such tool: ${toolName}`);

  const schema = zodToJsonSchema(tool.inputSchema, {
    // Inline everything: the Messages API wants a self-contained schema, not
    // one with $ref pointers into a definitions block.
    $refStrategy: 'none',
    target: 'jsonSchema7',
  }) as JsonSchema;

  // The API requires an object schema at the top level.
  delete schema.$schema;
  return schema;
}

/**
 * Tool input schemas keep their constraints — only the structured-OUTPUT
 * endpoint rejects them. `executeTool` validates tool arguments with Zod
 * either way.
 */

export interface AnthropicToolDefinition {
  name: string;
  description: string;
  input_schema: JsonSchema;
}

/** The tool list for one agent, ready to pass to the Messages API. */
export function anthropicToolsForAgent(agent: AgentName): AnthropicToolDefinition[] {
  return AGENT_TOOLS[agent].map((name) => {
    const tool = TOOLS[name]!;
    return {
      name: tool.name,
      description: tool.description,
      input_schema: toolInputJsonSchema(name),
    };
  });
}

/**
 * The same catalogue, minus anything switched off on the Connectors page.
 *
 * Preferred over `anthropicToolsForAgent` wherever a database is in hand: a
 * model that is never offered a tool cannot spend a round discovering it is
 * refused, and cannot tell a user it tried. `executeTool` still re-checks, so
 * this is the polite half of the guarantee rather than the load-bearing half.
 */
export async function availableAnthropicToolsForAgent(
  db: Firestore,
  agent: AgentName,
): Promise<AnthropicToolDefinition[]> {
  const settings = await getConnectorSettings(db);
  const disabled = new Set(settings.disabledTools);
  return anthropicToolsForAgent(agent).filter((tool) => !disabled.has(tool.name));
}

/**
 * JSON Schema for a student report, used as `output_config.format`.
 *
 * Derived from `ReportBodySchema`, which is also what validates the result
 * before it is stored — so the shape the model is asked for and the shape we
 * accept are the same object by construction.
 *
 * Structured outputs rather than a forced `save_report` tool call: the current
 * Sonnet model rejects forced `tool_choice`, and assistant prefill, so this is
 * the supported way to guarantee a shape.
 */
export function reportOutputJsonSchema(): JsonSchema {
  const schema = zodToJsonSchema(ReportBodySchema, {
    $refStrategy: 'none',
    target: 'jsonSchema7',
  }) as JsonSchema;
  delete schema.$schema;
  return sanitise(schema) as JsonSchema;
}
