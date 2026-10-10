/**
 * Vobiz call-control XML.
 *
 * Verb set and attribute spellings verified against Vobiz's docs:
 *   <Play>   text content is a public HTTPS URL to MP3/WAV; 8 kHz mono advised
 *   <Gather> attributes are camelCase — numDigits, finishOnKey,
 *            executionTimeout, inputType — and it POSTs `Digits` / `Speech`
 *            to its `action` URL
 *   <Speak>  provider-side TTS; our fallback when Sarvam audio is unavailable
 */

/** Escapes the five XML entities. Call text is faculty-authored, not trusted. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function document(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n${body}\n</Response>`;
}

export interface GatherOptions {
  actionUrl: string;
  numDigits?: number;
  executionTimeout?: number;
  finishOnKey?: string;
}

/**
 * The Tier 1 call: play the Sarvam-generated message, then collect one key.
 *
 * The prompt is played INSIDE <Gather> so a parent who already knows the
 * answer can press a key without waiting for the whole message — and repeated
 * outside it once, because a parent who was finding a pen should not have to
 * guess what the options were.
 */
export function playAndGather(options: {
  audioUrl: string;
  gather: GatherOptions;
  /** Spoken if the audio cannot be fetched or no key is pressed. */
  fallbackText: string;
  language?: string;
}): string {
  const { audioUrl, gather, fallbackText } = options;

  return document(
    `  <Gather action="${escapeXml(gather.actionUrl)}" method="POST" inputType="dtmf"` +
      ` numDigits="${gather.numDigits ?? 1}"` +
      ` executionTimeout="${gather.executionTimeout ?? 12}"` +
      ` finishOnKey="${escapeXml(gather.finishOnKey ?? '#')}">\n` +
      `    <Play>${escapeXml(audioUrl)}</Play>\n` +
      `  </Gather>\n` +
      `  <Play>${escapeXml(audioUrl)}</Play>\n` +
      `  <Speak>${escapeXml(fallbackText)}</Speak>\n` +
      `  <Hangup/>`,
  );
}

/** Plays a message and hangs up. Used for acknowledgements. */
export function playAndHangup(audioUrl: string, fallbackText?: string): string {
  return document(
    `  <Play>${escapeXml(audioUrl)}</Play>` +
      (fallbackText ? `\n  <Speak>${escapeXml(fallbackText)}</Speak>` : '') +
      `\n  <Hangup/>`,
  );
}

/**
 * Provider-side TTS, used only when Sarvam audio could not be produced.
 *
 * This is the third tier of fallback: Sarvam audio, then Vobiz's own voice,
 * then nothing. A parent hearing a robotic English sentence is a much better
 * outcome than a silent call.
 */
export function speakAndHangup(text: string): string {
  return document(`  <Speak>${escapeXml(text)}</Speak>\n  <Hangup/>`);
}

export function speakAndGather(options: { text: string; gather: GatherOptions }): string {
  const { text, gather } = options;
  return document(
    `  <Gather action="${escapeXml(gather.actionUrl)}" method="POST" inputType="dtmf"` +
      ` numDigits="${gather.numDigits ?? 1}"` +
      ` executionTimeout="${gather.executionTimeout ?? 12}"` +
      ` finishOnKey="${escapeXml(gather.finishOnKey ?? '#')}">\n` +
      `    <Speak>${escapeXml(text)}</Speak>\n` +
      `  </Gather>\n` +
      `  <Speak>${escapeXml(text)}</Speak>\n` +
      `  <Hangup/>`,
  );
}

export function hangup(): string {
  return document('  <Hangup/>');
}

export const XML_CONTENT_TYPE = 'text/xml; charset=utf-8';
