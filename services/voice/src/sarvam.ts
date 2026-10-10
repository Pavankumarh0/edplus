import { z } from 'zod';
import type { ParentLanguage } from '@eduplus/core';

/**
 * Sarvam AI client — Indian-language speech.
 *
 * Contracts verified against Sarvam's own docs:
 *   TTS  POST https://api.sarvam.ai/text-to-speech
 *        header `api-subscription-key` (NOT a Bearer token)
 *        field  `language_code` (NOT `target_language_code`)
 *        returns base64-encoded WAV strings in `audios[]`
 *   STT  POST https://api.sarvam.ai/speech-to-text
 *        multipart/form-data, 16 kHz preferred
 *
 * `saarika` is deprecated; `saaras:v4` is the current STT model.
 */

const BASE_URL = 'https://api.sarvam.ai';

const TtsResponseSchema = z.object({
  request_id: z.string().nullable().optional(),
  audios: z.array(z.string()).min(1),
});

const SttResponseSchema = z.object({
  request_id: z.string().nullable().optional(),
  transcript: z.string(),
  language_code: z.string().nullable().optional(),
  language_probability: z.number().nullable().optional(),
});

export class SarvamError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'SarvamError';
  }
}

function apiKey(): string {
  const key = process.env.SARVAM_API_KEY;
  if (!key || key.startsWith('PASTE')) {
    throw new SarvamError(
      'SARVAM_API_KEY is not set, so speech is unavailable. Add it to .env.local.',
    );
  }
  return key;
}

export function sarvamConfigured(): boolean {
  const key = process.env.SARVAM_API_KEY;
  return Boolean(key && !key.startsWith('PASTE'));
}

export interface SpeakOptions {
  text: string;
  language: ParentLanguage;
  /** 8 kHz is the telephony default; Vobiz recommends it for <Play>. */
  sampleRate?: 8000 | 16000 | 22050 | 24000;
  pace?: number;
  speaker?: string;
}

/**
 * Text to speech. Returns WAV bytes.
 *
 * Sarvam caps a request at 2500 characters, so long text is split on sentence
 * boundaries and the returned clips are concatenated. Splitting mid-word would
 * be audible; splitting mid-sentence is not.
 */
export async function speak(options: SpeakOptions): Promise<Buffer> {
  const chunks = splitForTts(options.text, 2000);
  const buffers: Buffer[] = [];

  for (const chunk of chunks) {
    const response = await fetch(`${BASE_URL}/text-to-speech`, {
      method: 'POST',
      headers: {
        'api-subscription-key': apiKey(),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        text: chunk,
        model: process.env.SARVAM_TTS_MODEL ?? 'bulbul:v4-flash',
        language_code: options.language,
        speech_sample_rate: options.sampleRate ?? 8000,
        ...(options.pace ? { pace: options.pace } : {}),
        ...(options.speaker ? { speaker: options.speaker } : {}),
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new SarvamError(
        `Sarvam text-to-speech failed (${response.status}): ${detail.slice(0, 300)}`,
        response.status,
      );
    }

    const parsed = TtsResponseSchema.parse(await response.json());
    buffers.push(Buffer.from(parsed.audios.join(''), 'base64'));
  }

  return buffers.length === 1 ? buffers[0]! : concatWav(buffers);
}

export interface TranscribeOptions {
  audio: Buffer;
  /** Null or 'unknown' lets Sarvam detect the language. */
  language?: ParentLanguage | 'unknown';
  fileName?: string;
  mimeType?: string;
}

export interface Transcript {
  text: string;
  language: string | null;
  confidence: number | null;
}

/** Speech to text. */
export async function transcribe(options: TranscribeOptions): Promise<Transcript> {
  const form = new FormData();
  form.append(
    'file',
    new Blob([new Uint8Array(options.audio)], { type: options.mimeType ?? 'audio/wav' }),
    options.fileName ?? 'audio.wav',
  );
  form.append('model', process.env.SARVAM_STT_MODEL ?? 'saaras:v4');
  if (options.language) form.append('language_code', options.language);

  const response = await fetch(`${BASE_URL}/speech-to-text`, {
    method: 'POST',
    headers: { 'api-subscription-key': apiKey() },
    body: form,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new SarvamError(
      `Sarvam speech-to-text failed (${response.status}): ${detail.slice(0, 300)}`,
      response.status,
    );
  }

  const parsed = SttResponseSchema.parse(await response.json());
  return {
    text: parsed.transcript,
    language: parsed.language_code ?? null,
    confidence: parsed.language_probability ?? null,
  };
}

/** Splits on sentence boundaries, never mid-word. */
export function splitForTts(text: string, limit: number): string[] {
  const trimmed = text.trim();
  if (trimmed.length <= limit) return [trimmed];

  const sentences = trimmed.split(/(?<=[.!?।])\s+/);
  const out: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    if (current.length + sentence.length + 1 <= limit) {
      current = current ? `${current} ${sentence}` : sentence;
      continue;
    }
    if (current) out.push(current);

    if (sentence.length <= limit) {
      current = sentence;
    } else {
      // A single sentence longer than the limit: fall back to word splitting.
      let buffer = '';
      for (const word of sentence.split(/\s+/)) {
        if (buffer.length + word.length + 1 > limit) {
          out.push(buffer);
          buffer = word;
        } else {
          buffer = buffer ? `${buffer} ${word}` : word;
        }
      }
      current = buffer;
    }
  }

  if (current) out.push(current);
  return out;
}

/**
 * Joins several WAV buffers into one.
 *
 * Takes the first clip's 44-byte header, concatenates the PCM payloads, and
 * rewrites the two length fields. Naively concatenating whole WAV files would
 * embed headers mid-stream, which most players render as a click or stop at.
 */
export function concatWav(buffers: Buffer[]): Buffer {
  const HEADER = 44;
  const bodies = buffers.map((b) => b.subarray(HEADER));
  const dataLength = bodies.reduce((sum, b) => sum + b.length, 0);

  const header = Buffer.from(buffers[0]!.subarray(0, HEADER));
  header.writeUInt32LE(36 + dataLength, 4); // RIFF chunk size
  header.writeUInt32LE(dataLength, 40); // data chunk size

  return Buffer.concat([header, ...bodies]);
}
