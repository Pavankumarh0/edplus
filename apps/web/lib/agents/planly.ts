import 'server-only';
import type Anthropic from '@anthropic-ai/sdk';
import { PLANLY_SYSTEM } from '@eduplus/core';
import {
  availableAnthropicToolsForAgent,
  executeTool,
  formatToolResult,
  type ToolContext,
} from '@eduplus/core/tools';
import { anthropic, model } from './client';

export interface PlanlyReply {
  reply: string;
  toolsUsed: string[];
  /** True when the turn created or changed the plan, so the app refreshes. */
  changedPlan: boolean;
}

const WRITES = new Set([
  'save_study_plan',
  'create_plan_tasks',
  'create_activity',
]);

/**
 * Runs one Planly turn.
 *
 * The whole conversation is replayed each time rather than stored server-side:
 * Planly's facts come from `get_my_progress`, which it is told to call every
 * session, so there is nothing in the history worth trusting over a fresh
 * read. The client holds the transcript; the server holds the authority.
 */
export async function runPlanly(
  messages: { role: 'user' | 'assistant'; content: string }[],
  ctx: ToolContext,
  maxRounds = 8,
): Promise<PlanlyReply> {
  const client = anthropic();
  // Built from what is enabled right now, so a tool switched off on the
  // Connectors page is never offered to the model at all.
  const tools = (await availableAnthropicToolsForAgent(
    ctx.db,
    'planly',
    ctx.actor.usn,
  )) as Anthropic.Tool[];

  const thread: Anthropic.MessageParam[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const toolsUsed: string[] = [];
  let changedPlan = false;

  for (let round = 0; round < maxRounds; round += 1) {
    const response = await client.messages.create({
      model: model(),
      max_tokens: 8000,
      system: PLANLY_SYSTEM,
      tools,
      messages: thread,
      output_config: { effort: 'medium' },
    });

    if (response.stop_reason === 'refusal') {
      return {
        reply: 'I cannot help with that one. Ask me about your studies.',
        toolsUsed,
        changedPlan,
      };
    }

    thread.push({ role: 'assistant', content: response.content });

    const toolUses = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
    );

    if (toolUses.length === 0) {
      const reply = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('')
        .trim();
      return { reply: reply || 'Let me try that again.', toolsUsed, changedPlan };
    }

    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const use of toolUses) {
      toolsUsed.push(use.name);
      if (WRITES.has(use.name)) changedPlan = true;

      const result = await executeTool(use.name, use.input, ctx);
      results.push({
        type: 'tool_result',
        tool_use_id: use.id,
        content: formatToolResult(result),
        is_error: !result.ok,
      });
    }

    thread.push({ role: 'user', content: results });
  }

  return {
    reply:
      'That took longer than it should have. Tell me one thing you want to work on and I will ' +
      'start there.',
    toolsUsed,
    changedPlan,
  };
}
