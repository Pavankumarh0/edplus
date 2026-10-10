import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Encryption for connector OAuth tokens.
 *
 * A refresh token is a long-lived key to someone else's account. Stored in
 * plaintext it is the single worst thing in the database: a Firestore export,
 * a console screenshot or a mis-scoped read hands over every connected
 * service. So it is encrypted at rest, and the key lives in the environment
 * rather than in the project.
 *
 * AES-256-GCM, which authenticates as well as encrypts — a tampered ciphertext
 * fails to decrypt rather than silently yielding a different token. The IV is
 * random per encryption and stored alongside, which is correct: an IV is not a
 * secret, but reusing one with the same key is catastrophic.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

export class MissingEncryptionKeyError extends Error {
  constructor() {
    super(
      'CONNECTOR_ENCRYPTION_KEY is not set, so OAuth tokens cannot be stored safely. ' +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    );
    this.name = 'MissingEncryptionKeyError';
  }
}

/**
 * Derives the 32-byte key.
 *
 * Hashed rather than used raw so any key length works, and so a short or
 * low-entropy value still produces a well-formed key — it does not make a weak
 * secret strong, but it removes a class of silent length errors.
 */
function key(env: NodeJS.ProcessEnv): Buffer {
  const raw = env.CONNECTOR_ENCRYPTION_KEY?.trim();
  if (!raw) throw new MissingEncryptionKeyError();
  return createHash('sha256').update(raw).digest();
}

/** True when tokens can be stored. Checked before starting an OAuth flow. */
export function canStoreSecrets(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.CONNECTOR_ENCRYPTION_KEY?.trim());
}

export interface SealedSecret {
  iv: string;
  tag: string;
  ciphertext: string;
}

export function seal(plaintext: string, env: NodeJS.ProcessEnv = process.env): SealedSecret {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key(env), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

  return {
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

export function open(sealed: SealedSecret, env: NodeJS.ProcessEnv = process.env): string {
  const decipher = createDecipheriv(ALGORITHM, key(env), Buffer.from(sealed.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));

  return Buffer.concat([
    decipher.update(Buffer.from(sealed.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

/**
 * Removes anything token-shaped from text headed for a log or an API response.
 *
 * Belt and braces: the code paths here are written not to leak a token, but an
 * error message from a third-party library is not under our control, and one
 * bad `${error}` is all it takes.
 */
export function redactSecrets(text: string): string {
  return text
    .replace(/\b(access_token|refresh_token|client_secret|code_verifier)=[^\s&"']+/gi, '$1=[redacted]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]{8,}=*/gi, 'Bearer [redacted]')
    // Google refresh tokens, GitHub tokens, and anything else long and opaque.
    .replace(/\b(1\/\/[\w.-]{10,}|gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9-]{20,})\b/g, '[redacted]');
}
