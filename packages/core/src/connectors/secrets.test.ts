import { describe, expect, it } from 'vitest';
import {
  MissingEncryptionKeyError,
  canStoreSecrets,
  open,
  redactSecrets,
  seal,
} from './secrets';
import { NeedsAuthorizationError, WebOAuthProvider, isExpired, newState } from './oauth';

const ENV = { CONNECTOR_ENCRYPTION_KEY: 'test-key-not-a-real-one' } as NodeJS.ProcessEnv;

describe('sealing a token', () => {
  it('round-trips', () => {
    const secret = 'refresh-token-value';
    expect(open(seal(secret, ENV), ENV)).toBe(secret);
  });

  it('never stores the plaintext', () => {
    const sealed = seal('refresh-token-value', ENV);
    expect(JSON.stringify(sealed)).not.toContain('refresh-token-value');
  });

  it('uses a fresh IV each time, so the same token seals differently', () => {
    // Reusing an IV with the same key in GCM is catastrophic — identical
    // ciphertexts would also leak that two connectors share a token.
    const a = seal('same-token', ENV);
    const b = seal('same-token', ENV);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it('refuses a tampered ciphertext rather than returning something else', () => {
    const sealed = seal('refresh-token-value', ENV);
    const flipped = Buffer.from(sealed.ciphertext, 'base64');
    flipped[0] ^= 0xff;

    expect(() =>
      open({ ...sealed, ciphertext: flipped.toString('base64') }, ENV),
    ).toThrow();
  });

  it('refuses a ciphertext sealed with a different key', () => {
    const sealed = seal('refresh-token-value', ENV);
    expect(() =>
      open(sealed, { CONNECTOR_ENCRYPTION_KEY: 'a-different-key' } as NodeJS.ProcessEnv),
    ).toThrow();
  });

  it('says clearly when no key is configured', () => {
    expect(canStoreSecrets({} as NodeJS.ProcessEnv)).toBe(false);
    expect(() => seal('x', {} as NodeJS.ProcessEnv)).toThrow(MissingEncryptionKeyError);
  });
});

describe('redaction', () => {
  it('strips token-shaped values from text headed for a log', () => {
    // The code paths are written not to leak a token, but a third-party
    // library's error message is not under our control.
    const samples = [
      'failed: access_token=ya29.a0AfH6SMBxxxxxxxxxxxx&foo=1',
      'Authorization: Bearer ya29.a0AfH6SMBxxxxxxxxxxxxxxxx',
      'refresh_token=1//0gLONGTOKENVALUEHERE',
      'got sk-ant-abcdefghijklmnopqrstuvwxyz123',
    ];
    for (const sample of samples) {
      const safe = redactSecrets(sample);
      expect(safe, sample).toMatch(/\[redacted\]/);
      expect(safe).not.toMatch(/ya29\.a0AfH6SMBxxxxxxxxxxxxxxxx/);
    }
  });

  it('leaves ordinary text alone', () => {
    const text = 'The MCP handshake failed. Check the URL serves MCP over Streamable HTTP.';
    expect(redactSecrets(text)).toBe(text);
  });
});

describe('the authorization flow', () => {
  it('hands the authorization URL out instead of navigating', () => {
    // A Next.js route cannot open a browser, so the provider throws and the
    // caller gives the URL to the one browser that can.
    const provider = new WebOAuthProvider({
      redirectUrl: 'https://eduplus.test/api/connectors/remote/callback',
      state: 'abc',
    });

    expect(() => provider.redirectToAuthorization(new URL('https://auth.example.com/go'))).toThrow(
      NeedsAuthorizationError,
    );

    try {
      provider.redirectToAuthorization(new URL('https://auth.example.com/go'));
    } catch (error) {
      expect((error as NeedsAuthorizationError).authorizationUrl).toBe(
        'https://auth.example.com/go',
      );
    }
  });

  it('refuses to continue without a PKCE verifier', () => {
    // Without PKCE the authorization code is bearer-grade on its own.
    const provider = new WebOAuthProvider({ redirectUrl: 'https://x/cb', state: 'abc' });
    expect(() => provider.codeVerifier()).toThrow(/code verifier/);
  });

  it('collects what the second request will need', () => {
    const provider = new WebOAuthProvider({ redirectUrl: 'https://x/cb', state: 'abc' });
    provider.saveCodeVerifier('verifier-value');
    provider.saveTokens({ access_token: 'at', token_type: 'Bearer' });

    expect(provider.mutations.codeVerifier).toBe('verifier-value');
    expect(provider.tokens()?.access_token).toBe('at');
  });

  it('generates an unguessable state for each flow', () => {
    const states = new Set(Array.from({ length: 50 }, () => newState()));
    expect(states.size).toBe(50);
    expect([...states][0]!.length).toBeGreaterThanOrEqual(24);
  });

  it('treats an abandoned authorization as expired', () => {
    const base = {
      state: 's',
      serverUrl: 'https://x/mcp',
      displayName: 'X',
      ownerId: 'faculty-1',
      codeVerifier: null,
      clientInformation: null,
      createdAt: '2026-10-11T00:00:00.000Z',
    };

    expect(isExpired({ ...base, expiresAt: '2026-10-11T00:10:00.000Z' }, new Date('2026-10-11T00:05:00.000Z'))).toBe(false);
    expect(isExpired({ ...base, expiresAt: '2026-10-11T00:10:00.000Z' }, new Date('2026-10-11T00:11:00.000Z'))).toBe(true);
  });
});
