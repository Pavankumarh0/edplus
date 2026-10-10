import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ParentLanguage } from '@eduplus/core';
import { speak } from './sarvam';

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(HERE, '../audio-cache');

/**
 * Generated speech, cached on disk and served over HTTP.
 *
 * Vobiz's <Play> verb fetches audio over the public internet, so the clip must
 * exist at a stable URL before the call connects — it cannot be streamed from
 * memory at request time.
 *
 * Keyed by a hash of (text + language + sample rate), so the same approved
 * message is synthesised once however many parents it is played to. That
 * matters during a demo: re-dialling costs no Sarvam call and adds no latency.
 */

function keyFor(text: string, language: string, sampleRate: number): string {
  return createHash('sha256')
    .update(`${language}|${sampleRate}|${text}`)
    .digest('hex')
    .slice(0, 32);
}

export interface CachedAudio {
  key: string;
  bytes: number;
  /** Path the voice service serves this from. */
  path: string;
}

export async function ensureAudio(options: {
  text: string;
  language: ParentLanguage;
  sampleRate?: 8000 | 16000;
}): Promise<CachedAudio> {
  const sampleRate = options.sampleRate ?? 8000;
  const key = keyFor(options.text, options.language, sampleRate);
  const file = join(CACHE_DIR, `${key}.wav`);

  try {
    const existing = await stat(file);
    if (existing.size > 0) {
      return { key, bytes: existing.size, path: `/audio/${key}.wav` };
    }
  } catch {
    /* not cached yet */
  }

  const wav = await speak({ text: options.text, language: options.language, sampleRate });

  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(file, wav);

  return { key, bytes: wav.length, path: `/audio/${key}.wav` };
}

/** Reads a cached clip. Returns null when the key is unknown. */
export async function readAudio(key: string): Promise<Buffer | null> {
  // The key comes off a URL, so reject anything that is not a plain hash
  // rather than letting it reach the filesystem.
  if (!/^[a-f0-9]{32}$/.test(key)) return null;
  try {
    return await readFile(join(CACHE_DIR, `${key}.wav`));
  } catch {
    return null;
  }
}
