import { NextResponse } from 'next/server';
import { z } from 'zod';
import type Anthropic from '@anthropic-ai/sdk';
import { COPILOT_SYSTEM } from '@eduplus/core';
import {
  anthropicToolsForAgent,
  executeTool,
  formatToolResult,
} from '@eduplus/core/tools';
import { anthropic, model } from '@/lib/agents/client';
import { errorResponse, facultyContext } from '@/lib/api';

const MessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(8000),
});

const BodySchema = z.object({
  messages: z.array(MessageSchema).min(1).max(30),
});

export const maxDuration = 120;

/**
 * The faculty copilot.
 *
 * Runs a tool loop against the copilot's allowlist. Only the plain-text
 * conversation is sent back and forth with the client — tool results are never
 * trusted from the browser, they are re-fetched server-side on every turn, so
 * a stale or tampered transcript cannot put numbers in Claude's mouth.
 */
export async function POST(request: Request) {
  try {
    const ctx = await facultyContext();

    const parsed = BodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Expected a messages array.' }, { status: 400 });
    }

    const client = anthropic();
    const tools = anthropicToolsForAgent('copilot') as Anthropic.Tool[];

    const messages: Anthropic.MessageParam[] = parsed.data.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const toolsUsed: string[] = [];
    let rounds = 0;
    const MAX_ROUNDS = 6;

    while (rounds < MAX_ROUNDS) {
      rounds += 1;

      const response = await client.messages.create({
        model: model(),
        max_tokens: 4000,
        system: COPILOT_SYSTEM,
        tools,
        messages,
        output_config: { effort: 'low' },
      });

      if (response.stop_reason === 'refusal') {
        return NextResponse.json(
          { reply: 'I cannot answer that one.', toolsUsed },
          { status: 200 },
        );
      }

      messages.push({ role: 'assistant', content: response.content });

      const toolUses = response.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
      );

      if (toolUses.length === 0) {
        const reply = response.content
          .filter((block): block is Anthropic.TextBlock => block.type === 'text')
          .map((block) => block.text)
          .join('')
          .trim();

        return NextResponse.json({
          reply: reply || 'I could not find an answer to that.',
          toolsUsed,
        });
      }

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const use of toolUses) {
        toolsUsed.push(use.name);
        const result = await executeTool(use.name, use.input, ctx);
        results.push({
          type: 'tool_result',
          tool_use_id: use.id,
          content: formatToolResult(result),
          is_error: !result.ok,
        });
      }

      messages.push({ role: 'user', content: results });
    }

    return NextResponse.json({
      reply:
        'I looked that up several times without settling on an answer. Try asking about one ' +
        'student, or one thing at a time.',
      toolsUsed,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
