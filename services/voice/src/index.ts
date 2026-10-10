import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import { z } from 'zod';
import {
  PARENT_RESPONSE_LABELS,
  type CallContext,
  type CallRecord,
} from '@eduplus/core';
import { executeTool, type ToolContext } from '@eduplus/core/tools';
import {
  appendTranscriptTurn,
  getCall,
  getDb,
  getParentContact,
  isUsingEmulator,
  listCalls,
  updateCall,
} from '@eduplus/core/repositories';
import { ensureAudio, readAudio } from './audio-cache';
import { keypadPrompt, outcomeForDigit, runVoiceTurn } from './agent';
import { sarvamConfigured } from './sarvam';
import { SimulatedProvider } from './telephony/simulated';
import { VobizProvider, publicBaseUrl } from './telephony/vobiz';
import type { TelephonyProvider } from './telephony/types';
import {
  XML_CONTENT_TYPE,
  playAndGather,
  playAndHangup,
  speakAndGather,
  speakAndHangup,
} from './xml';
import { simulatorPage } from './routes/simulator-page';

const PORT = Number(process.env.VOICE_SERVICE_PORT ?? 8787);

/** Chosen by env, so switching tiers never means touching code. */
function provider(): TelephonyProvider {
  return process.env.TELEPHONY_PROVIDER === 'vobiz'
    ? new VobizProvider()
    : new SimulatedProvider();
}

/**
 * The voice agent acts as itself, so its two-tool allowlist applies and every
 * call it makes is audited under `agent:voice`.
 */
function voiceCtx(): ToolContext {
  return { db: getDb(), actor: { kind: 'agent', id: 'agent:voice', agentName: 'voice' } };
}

/** A system actor, for the bookkeeping the agent itself must not do. */
function systemCtx(): ToolContext {
  return { db: getDb(), actor: { kind: 'system', id: 'voice-service' } };
}

async function callContextFor(callId: string): Promise<CallContext> {
  const result = await executeTool<CallContext>('get_call_context', { callId }, voiceCtx());
  if (!result.ok) throw new Error(result.error ?? 'Could not load the call context.');
  return result.data!;
}

/**
 * The full message a parent hears: the faculty-approved text, plus the keypad
 * instructions. The approved text is never altered — the prompt is appended.
 */
function spokenMessage(context: CallContext): string {
  return `This is an automated assistant from ${context.collegeName}. ${context.approvedMessage}${keypadPrompt(
    context.purpose,
  )}`;
}

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });
await app.register(formbody); // Vobiz posts application/x-www-form-urlencoded

// ─────────────────────────────────────────────────────────────────────────────
// Health and configuration
// ─────────────────────────────────────────────────────────────────────────────

app.get('/health', async () => {
  const telephony = provider();
  return {
    ok: true,
    provider: telephony.name,
    providerReady: telephony.isConfigured(),
    providerNote: telephony.describeConfiguration(),
    sarvam: sarvamConfigured() ? 'configured' : 'missing SARVAM_API_KEY',
    anthropic: process.env.ANTHROPIC_API_KEY?.startsWith('sk-ant-') ? 'configured' : 'missing',
    publicBaseUrl: publicBaseUrl(),
    firestore: isUsingEmulator() ? 'emulator' : process.env.FIREBASE_PROJECT_ID ?? '(unset)',
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// Audio — Vobiz fetches these over the public internet
// ─────────────────────────────────────────────────────────────────────────────

app.get<{ Params: { file: string } }>('/audio/:file', async (request, reply) => {
  const key = request.params.file.replace(/\.wav$/i, '');
  const audio = await readAudio(key);
  if (!audio) return reply.code(404).send({ error: 'No such audio clip.' });

  return reply
    .header('content-type', 'audio/wav')
    .header('content-length', String(audio.length))
    .header('cache-control', 'public, max-age=3600')
    .send(audio);
});

// ─────────────────────────────────────────────────────────────────────────────
// Dialling
// ─────────────────────────────────────────────────────────────────────────────

const DialSchema = z.object({ callId: z.string().min(1) });

/**
 * Places a queued call.
 *
 * Refuses anything not already approved by a faculty member: approval happens
 * in the dashboard, and this service only carries out what was approved.
 */
app.post('/calls/dial', async (request, reply) => {
  const parsed = DialSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'Expected a callId.' });

  const db = getDb();
  const call = await getCall(db, parsed.data.callId);
  if (!call) return reply.code(404).send({ error: 'No such call.' });
  if (!call.approvedBy) {
    return reply.code(403).send({ error: 'That call has not been approved by a faculty member.' });
  }
  if (call.status !== 'queued' && call.status !== 'approved') {
    return reply.code(409).send({ error: `Call is already ${call.status}.` });
  }

  const parent = await getParentContact(db, call.usn);
  if (!parent?.phone) {
    await updateCall(db, call.callId, {
      status: 'failed',
      failureReason: 'No parent phone number on record.',
    });
    return reply.code(400).send({ error: 'No parent phone number on record.' });
  }

  const telephony = provider();
  if (!telephony.isConfigured()) {
    return reply.code(503).send({ error: telephony.describeConfiguration() });
  }

  // Pre-generate the audio so <Play> has something to fetch the moment the
  // call connects. Doing this after the phone is ringing would mean silence.
  const context = await callContextFor(call.callId);
  let audioPath: string | null = null;
  try {
    const audio = await ensureAudio({ text: spokenMessage(context), language: call.language });
    audioPath = audio.path;
  } catch (error) {
    // Not fatal: the answer handler falls back to the provider's own voice.
    app.log.warn({ err: error }, 'Sarvam audio unavailable; will fall back to provider TTS');
  }

  const base = publicBaseUrl();

  try {
    const result = await telephony.placeCall({
      callId: call.callId,
      to: parent.phone,
      language: call.language,
      answerUrl: `${base}/vobiz/answer?callId=${encodeURIComponent(call.callId)}`,
      hangupUrl: `${base}/vobiz/hangup?callId=${encodeURIComponent(call.callId)}`,
      fallbackUrl: `${base}/vobiz/fallback?callId=${encodeURIComponent(call.callId)}`,
    });

    await updateCall(db, call.callId, {
      status: telephony.name === 'simulated' ? 'queued' : 'dialing',
      providerCallId: result.providerCallId,
      startedAt: new Date().toISOString(),
    });

    return {
      callId: call.callId,
      provider: telephony.name,
      providerCallId: result.providerCallId,
      audioPath,
      simulatorUrl:
        telephony.name === 'simulated'
          ? `${base}/simulator?callId=${encodeURIComponent(call.callId)}`
          : null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateCall(db, call.callId, { status: 'failed', failureReason: message });
    return reply.code(502).send({ error: message });
  }
});

/** Queued calls, for the simulator page to pick up. */
app.get('/calls/queued', async () => {
  const calls = await listCalls(getDb());
  return {
    calls: calls
      .filter((c: CallRecord) => c.status === 'queued' || c.status === 'approved')
      .map((c: CallRecord) => ({
        callId: c.callId,
        usn: c.usn,
        purpose: c.purpose,
        language: c.language,
        approvedMessage: c.approvedMessage,
      })),
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// Vobiz webhooks — these return call-control XML
// ─────────────────────────────────────────────────────────────────────────────

const CallIdQuery = z.object({ callId: z.string().min(1) });

/**
 * The call connected. Returns the XML that drives it.
 *
 * Three tiers of fallback, because a silent call is the worst outcome:
 *   1. Sarvam audio in the parent's own language
 *   2. the provider's own text-to-speech
 *   3. a short spoken apology and a clean hang-up
 */
app.post('/vobiz/answer', async (request, reply) => {
  const parsed = CallIdQuery.safeParse(request.query);
  if (!parsed.success) {
    return reply.type(XML_CONTENT_TYPE).send(speakAndHangup('Configuration error. Goodbye.'));
  }

  const { callId } = parsed.data;
  const db = getDb();

  try {
    const context = await callContextFor(callId);
    const text = spokenMessage(context);
    const actionUrl = `${publicBaseUrl()}/vobiz/gather?callId=${encodeURIComponent(callId)}`;

    await updateCall(db, callId, { status: 'in_progress', startedAt: new Date().toISOString() });
    await appendTranscriptTurn(db, callId, {
      speaker: 'agent',
      text,
      language: context.language,
      at: new Date().toISOString(),
    });

    try {
      const audio = await ensureAudio({ text, language: context.language });
      return reply.type(XML_CONTENT_TYPE).send(
        playAndGather({
          audioUrl: `${publicBaseUrl()}${audio.path}`,
          gather: { actionUrl, numDigits: 1, executionTimeout: 12 },
          fallbackText: 'We did not receive a response. The college will try again. Goodbye.',
        }),
      );
    } catch {
      // Tier 2: the provider speaks it instead.
      return reply.type(XML_CONTENT_TYPE).send(
        speakAndGather({ text, gather: { actionUrl, numDigits: 1, executionTimeout: 12 } }),
      );
    }
  } catch (error) {
    app.log.error({ err: error }, 'answer webhook failed');
    await updateCall(db, callId, {
      status: 'failed',
      failureReason: error instanceof Error ? error.message : String(error),
    }).catch(() => {});
    return reply
      .type(XML_CONTENT_TYPE)
      .send(speakAndHangup('Sorry, we cannot complete this call right now. Goodbye.'));
  }
});

const GatherBody = z.object({
  Digits: z.string().optional(),
  Speech: z.string().optional(),
  CallUUID: z.string().optional(),
});

/** The parent pressed a key (Tier 1) or spoke (Tier 2). */
app.post('/vobiz/gather', async (request, reply) => {
  const query = CallIdQuery.safeParse(request.query);
  if (!query.success) {
    return reply.type(XML_CONTENT_TYPE).send(speakAndHangup('Goodbye.'));
  }

  const { callId } = query.data;
  const body = GatherBody.parse(request.body ?? {});
  const db = getDb();

  try {
    const context = await callContextFor(callId);
    const digits = (body.Digits ?? '').trim();
    const speech = (body.Speech ?? '').trim();

    if (digits) {
      await appendTranscriptTurn(db, callId, {
        speaker: 'parent',
        text: `[pressed ${digits}]`,
        at: new Date().toISOString(),
      });

      const outcome = outcomeForDigit(digits, context.purpose);

      if (!outcome) {
        // An unrecognised key: ask once more rather than guess.
        const retry = `Sorry, I did not understand that.${keypadPrompt(context.purpose)}`;
        return reply.type(XML_CONTENT_TYPE).send(
          speakAndGather({
            text: retry,
            gather: {
              actionUrl: `${publicBaseUrl()}/vobiz/gather?callId=${encodeURIComponent(callId)}`,
              numDigits: 1,
              executionTimeout: 10,
            },
          }),
        );
      }

      await executeTool(
        'log_call_outcome',
        { callId, parentResponse: outcome.parentResponse, summary: outcome.summary },
        voiceCtx(),
      );

      const closing =
        outcome.parentResponse === 'requested_callback'
          ? 'Thank you. The mentor will call you back. Goodbye.'
          : 'Thank you. Goodbye.';

      await appendTranscriptTurn(db, callId, {
        speaker: 'agent',
        text: closing,
        language: context.language,
        at: new Date().toISOString(),
      });

      try {
        const audio = await ensureAudio({ text: closing, language: context.language });
        return reply
          .type(XML_CONTENT_TYPE)
          .send(playAndHangup(`${publicBaseUrl()}${audio.path}`, closing));
      } catch {
        return reply.type(XML_CONTENT_TYPE).send(speakAndHangup(closing));
      }
    }

    if (speech) {
      // Tier 2: a real conversational turn.
      const existing = await getCall(db, callId);
      const turn = await runVoiceTurn({
        context,
        history: [],
        parentSaid: speech,
        priorTurns: existing?.transcript ?? [],
        ctx: voiceCtx(),
      });

      await appendTranscriptTurn(db, callId, {
        speaker: 'parent',
        text: speech,
        at: new Date().toISOString(),
      });
      await appendTranscriptTurn(db, callId, {
        speaker: 'agent',
        text: turn.say,
        language: context.language,
        at: new Date().toISOString(),
      });

      try {
        const audio = await ensureAudio({ text: turn.say, language: context.language });
        return reply
          .type(XML_CONTENT_TYPE)
          .send(playAndHangup(`${publicBaseUrl()}${audio.path}`, turn.say));
      } catch {
        return reply.type(XML_CONTENT_TYPE).send(speakAndHangup(turn.say));
      }
    }

    // Timed out with no input at all.
    await executeTool(
      'log_call_outcome',
      {
        callId,
        parentResponse: 'no_response',
        summary: 'The call connected but the parent did not respond.',
      },
      voiceCtx(),
    );
    return reply.type(XML_CONTENT_TYPE).send(speakAndHangup('We did not receive a response. Goodbye.'));
  } catch (error) {
    app.log.error({ err: error }, 'gather webhook failed');
    return reply.type(XML_CONTENT_TYPE).send(speakAndHangup('Thank you. Goodbye.'));
  }
});

/** The call ended. */
app.post('/vobiz/hangup', async (request, reply) => {
  const query = CallIdQuery.safeParse(request.query);
  if (query.success) {
    const db = getDb();
    const call = await getCall(db, query.data.callId);
    // Only close a call that never reached an outcome — never overwrite one.
    if (call && call.status !== 'completed') {
      await updateCall(db, query.data.callId, {
        status: call.parentResponse ? 'completed' : 'no_answer',
        endedAt: new Date().toISOString(),
      });
    }
  }
  return reply.code(204).send();
});

/** The provider could not fetch our answer URL. */
app.post('/vobiz/fallback', async (request, reply) => {
  const query = CallIdQuery.safeParse(request.query);
  if (query.success) {
    await updateCall(getDb(), query.data.callId, {
      status: 'failed',
      failureReason: 'The telephony provider could not reach the answer URL.',
      endedAt: new Date().toISOString(),
    }).catch(() => {});
  }
  return reply
    .type(XML_CONTENT_TYPE)
    .send(speakAndHangup('Sorry, we cannot complete this call right now. Goodbye.'));
});

// ─────────────────────────────────────────────────────────────────────────────
// Simulator — the same pipeline, in a browser
// ─────────────────────────────────────────────────────────────────────────────

app.get('/simulator', async (_request, reply) =>
  reply.type('text/html; charset=utf-8').send(simulatorPage(publicBaseUrl())),
);

/** Starts a simulated call: returns the spoken text and its audio. */
app.post('/simulator/start', async (request, reply) => {
  const parsed = DialSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'Expected a callId.' });

  try {
    const context = await callContextFor(parsed.data.callId);
    const text = spokenMessage(context);
    const db = getDb();

    await updateCall(db, parsed.data.callId, {
      status: 'in_progress',
      provider: 'simulated',
      startedAt: new Date().toISOString(),
    });
    await appendTranscriptTurn(db, parsed.data.callId, {
      speaker: 'agent',
      text,
      language: context.language,
      at: new Date().toISOString(),
    });

    let audioPath: string | null = null;
    try {
      audioPath = (await ensureAudio({ text, language: context.language })).path;
    } catch (error) {
      app.log.warn({ err: error }, 'simulator: Sarvam unavailable, showing text only');
    }

    return {
      callId: parsed.data.callId,
      language: context.language,
      parentName: context.parentName,
      studentFirstName: context.studentFirstName,
      purpose: context.purpose,
      say: text,
      audioPath,
      keypad: keypadPrompt(context.purpose),
    };
  } catch (error) {
    return reply
      .code(400)
      .send({ error: error instanceof Error ? error.message : String(error) });
  }
});

const SimulatorReplySchema = z.object({
  callId: z.string().min(1),
  digit: z.string().optional(),
  said: z.string().max(1000).optional(),
});

/** The simulated parent pressed a key or typed a reply. */
app.post('/simulator/reply', async (request, reply) => {
  const parsed = SimulatorReplySchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'Expected a callId.' });

  const { callId, digit, said } = parsed.data;
  const db = getDb();

  try {
    const context = await callContextFor(callId);

    if (digit) {
      const outcome = outcomeForDigit(digit, context.purpose);
      if (!outcome) {
        return { say: `Sorry, I did not understand that.${keypadPrompt(context.purpose)}`, finished: false };
      }

      await appendTranscriptTurn(db, callId, {
        speaker: 'parent',
        text: `[pressed ${digit}]`,
        at: new Date().toISOString(),
      });
      await executeTool(
        'log_call_outcome',
        { callId, parentResponse: outcome.parentResponse, summary: outcome.summary },
        voiceCtx(),
      );

      const closing =
        outcome.parentResponse === 'requested_callback'
          ? 'Thank you. The mentor will call you back. Goodbye.'
          : 'Thank you. Goodbye.';

      await appendTranscriptTurn(db, callId, {
        speaker: 'agent',
        text: closing,
        language: context.language,
        at: new Date().toISOString(),
      });
      await updateCall(db, callId, { status: 'completed', endedAt: new Date().toISOString() });

      let audioPath: string | null = null;
      try {
        audioPath = (await ensureAudio({ text: closing, language: context.language })).path;
      } catch {
        /* text is enough */
      }

      return {
        say: closing,
        audioPath,
        finished: true,
        outcome: PARENT_RESPONSE_LABELS[outcome.parentResponse as never] ?? outcome.parentResponse,
      };
    }

    if (said) {
      await appendTranscriptTurn(db, callId, {
        speaker: 'parent',
        text: said,
        at: new Date().toISOString(),
      });

      const existing = await getCall(db, callId);
      const turn = await runVoiceTurn({
        context,
        history: [],
        parentSaid: said,
        priorTurns: existing?.transcript ?? [],
        ctx: voiceCtx(),
      });

      await appendTranscriptTurn(db, callId, {
        speaker: 'agent',
        text: turn.say,
        language: context.language,
        at: new Date().toISOString(),
      });

      if (turn.finished) {
        await updateCall(db, callId, { status: 'completed', endedAt: new Date().toISOString() });
      }

      let audioPath: string | null = null;
      try {
        audioPath = (await ensureAudio({ text: turn.say, language: context.language })).path;
      } catch {
        /* text is enough */
      }

      return { say: turn.say, audioPath, finished: turn.finished, toolsUsed: turn.toolsUsed };
    }

    return reply.code(400).send({ error: 'Send either a digit or something the parent said.' });
  } catch (error) {
    return reply
      .code(400)
      .send({ error: error instanceof Error ? error.message : String(error) });
  }
});

// ─────────────────────────────────────────────────────────────────────────────

async function start() {
  const telephony = provider();
  await app.listen({ port: PORT, host: '0.0.0.0' });

  app.log.info(
    `voice service ready on :${PORT} · provider=${telephony.name} · ${telephony.describeConfiguration()}`,
  );
  if (telephony.name === 'simulated') {
    app.log.info(`simulator: ${publicBaseUrl()}/simulator`);
  }
  // Referenced so the unused-import lint stays honest about systemCtx's role.
  void systemCtx;
}

start().catch((error) => {
  app.log.error({ err: error }, 'voice service failed to start');
  process.exit(1);
});
