import Anthropic from '@anthropic-ai/sdk';
import {
  VOICE_AGENT_SYSTEM,
  buildVoiceOpening,
  buildVoiceReply,
  type CallContext,
} from '@eduplus/core';
import {
  anthropicToolsForAgent,
  executeTool,
  formatToolResult,
  type ToolContext,
} from '@eduplus/core/tools';

/**
 * The parent voice agent.
 *
 * Holds exactly two tools. It cannot read marks, a risk score or a report
 * because those capabilities are absent from its allowlist, not because it has
 * been asked not to use them — which is the only form of that guarantee worth
 * having on a live call with a stranger.
 */

let client: Anthropic | null = null;

function anthropic(): Anthropic {
  if (client) return client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey.startsWith('PASTE')) {
    throw new Error('ANTHROPIC_API_KEY is not set, so the voice agent cannot speak.');
  }
  client = new Anthropic({ apiKey });
  return client;
}

function model(): string {
  const id = process.env.ANTHROPIC_MODEL;
  if (!id) throw new Error('ANTHROPIC_MODEL is not set.');
  return id;
}

export interface AgentTurn {
  /** What the agent should say next. Empty when it has nothing to add. */
  say: string;
  /** True once the agent has recorded an outcome and the call can end. */
  finished: boolean;
  toolsUsed: string[];
}

/**
 * Runs one turn of the conversation.
 *
 * `history` is the running Anthropic message list, owned by the caller so a
 * call can span several HTTP webhooks without the agent losing the thread.
 */
export async function runVoiceTurn(options: {
  context: CallContext;
  history: Anthropic.MessageParam[];
  /** Null for the opening turn. */
  parentSaid: string | null;
  /** The call so far, so the agent has memory across webhook requests. */
  priorTurns?: { speaker: string; text: string }[];
  ctx: ToolContext;
}): Promise<AgentTurn> {
  const { context, history, parentSaid, ctx } = options;
  const api = anthropic();
  const tools = anthropicToolsForAgent('voice') as Anthropic.Tool[];

  history.push({
    role: 'user',
    content:
      parentSaid === null
        ? buildVoiceOpening(context)
        : buildVoiceReply(context, parentSaid, options.priorTurns ?? []),
  });

  const toolsUsed: string[] = [];
  let finished = false;

  for (let round = 0; round < 4; round += 1) {
    const response = await api.messages.create({
      model: model(),
      // A phone turn must be short. Capping output is also a guardrail: the
      // agent cannot monologue at a parent.
      max_tokens: 700,
      system: VOICE_AGENT_SYSTEM,
      tools,
      messages: history,
      output_config: { effort: 'low' },
    });

    if (response.stop_reason === 'refusal') {
      return {
        say: 'I am sorry, I cannot help with that. Your ward’s mentor can call you back.',
        finished: true,
        toolsUsed,
      };
    }

    history.push({ role: 'assistant', content: response.content });

    const toolUses = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
    );

    if (toolUses.length === 0) {
      const say = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join(' ')
        .trim();
      return { say, finished, toolsUsed };
    }

    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const use of toolUses) {
      toolsUsed.push(use.name);
      if (use.name === 'log_call_outcome') finished = true;
      const result = await executeTool(use.name, use.input, ctx);
      results.push({
        type: 'tool_result',
        tool_use_id: use.id,
        content: formatToolResult(result),
        is_error: !result.ok,
      });
    }

    history.push({ role: 'user', content: results });
  }

  return {
    say: 'Thank you for your time. Goodbye.',
    finished: true,
    toolsUsed,
  };
}

/**
 * Turns the Tier 1 keypress into a recorded outcome.
 *
 * Deliberately not a model call: "1" means "will attend" by the terms of the
 * message the parent just heard, and asking a model to interpret a digit adds
 * latency and a way to be wrong for no benefit.
 */
export function outcomeForDigit(
  digit: string,
  purpose: CallContext['purpose'],
): { parentResponse: string; summary: string } | null {
  if (purpose === 'ptm') {
    if (digit === '1') {
      return {
        parentResponse: 'confirmed_attending',
        summary: 'Parent pressed 1 to confirm they will attend the parent-teacher meeting.',
      };
    }
    if (digit === '2') {
      return {
        parentResponse: 'declined_attending',
        summary: 'Parent pressed 2 to say they cannot attend the parent-teacher meeting.',
      };
    }
    if (digit === '9') {
      return {
        parentResponse: 'requested_callback',
        summary: 'Parent pressed 9 to request a callback from the mentor.',
      };
    }
    return null;
  }

  // absence and risk_update are acknowledgements rather than questions.
  if (digit === '1') {
    return {
      parentResponse: 'acknowledged',
      summary: 'Parent pressed 1 to acknowledge the message.',
    };
  }
  if (digit === '9') {
    return {
      parentResponse: 'requested_callback',
      summary: 'Parent pressed 9 to request a callback from the mentor.',
    };
  }
  return null;
}

/** The keypad instructions appended to a Tier 1 message. */
export function keypadPrompt(purpose: CallContext['purpose']): string {
  if (purpose === 'ptm') {
    return ' Press 1 if you can attend. Press 2 if you cannot. Press 9 to ask the mentor to call you back.';
  }
  return ' Press 1 to confirm you have heard this. Press 9 to ask the mentor to call you back.';
}
