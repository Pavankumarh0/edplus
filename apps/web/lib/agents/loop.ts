import 'server-only';
import type Anthropic from '@anthropic-ai/sdk';
import {
  anthropicToolsForAgent,
  executeTool,
  formatToolResult,
  type AgentName,
  type ToolContext,
} from '@eduplus/core/tools';
import { anthropic, model } from './client';

export interface ToolLoopResult {
  messages: Anthropic.MessageParam[];
  /** Names of tools actually called, in order. Shown in the UI for trust. */
  toolsUsed: string[];
  rounds: number;
  inputTokens: number;
  outputTokens: number;
}

export interface ToolLoopOptions {
  agent: AgentName;
  system: string;
  userMessage: string;
  ctx: ToolContext;
  /** Hard stop, so a confused model cannot loop forever on a faculty's bill. */
  maxRounds?: number;
  maxTokens?: number;
  effort?: 'low' | 'medium' | 'high';
}

/**
 * Runs an agent's tool-gathering phase.
 *
 * Every tool call goes through `executeTool`, so the agent is subject to the
 * same allowlist, the same Zod validation and the same audit trail as any
 * other caller. There is no back door where an agent reaches Firestore
 * directly.
 *
 * Tool failures are returned to the model as readable text rather than thrown,
 * so it can correct a bad USN instead of the whole request dying.
 */
export async function runToolLoop(options: ToolLoopOptions): Promise<ToolLoopResult> {
  const client = anthropic();
  const tools = anthropicToolsForAgent(options.agent);
  const maxRounds = options.maxRounds ?? 6;

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: options.userMessage },
  ];

  const toolsUsed: string[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let rounds = 0;

  while (rounds < maxRounds) {
    rounds += 1;

    const response = await client.messages.create({
      model: model(),
      max_tokens: options.maxTokens ?? 8000,
      system: options.system,
      tools: tools as Anthropic.Tool[],
      messages,
      output_config: { effort: options.effort ?? 'medium' },
    });

    inputTokens += response.usage.input_tokens;
    outputTokens += response.usage.output_tokens;

    // Safety classifiers can decline; check before reading content.
    if (response.stop_reason === 'refusal') {
      throw new Error('The model declined this request.');
    }

    messages.push({ role: 'assistant', content: response.content });

    const toolUses = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
    );

    if (toolUses.length === 0) break;

    // Parallel tool calls must come back as tool_result blocks in ONE user
    // message — splitting them teaches the model to stop calling in parallel.
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const use of toolUses) {
      toolsUsed.push(use.name);
      const result = await executeTool(use.name, use.input, options.ctx);
      results.push({
        type: 'tool_result',
        tool_use_id: use.id,
        content: formatToolResult(result),
        is_error: !result.ok,
      });
    }

    messages.push({ role: 'user', content: results });
  }

  return { messages, toolsUsed, rounds, inputTokens, outputTokens };
}
