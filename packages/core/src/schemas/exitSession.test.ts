import { describe, expect, it } from 'vitest';
import {
  ROTATION_SECONDS,
  currentToken,
  describeSessionState,
  exitQrPayload,
  isSessionLive,
  isTokenValid,
  newSessionSecret,
  parseExitQrPayload,
  stripSecret,
  type ExitSession,
} from './exitSession';

const SECRET = newSessionSecret();
const T0 = new Date('2026-10-11T10:00:00.000Z');
const plus = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

function session(overrides: Partial<ExitSession> = {}): ExitSession {
  return {
    sessionId: 'ex_1',
    secret: SECRET,
    facultyId: 'faculty-1',
    semester: 5,
    section: 'A',
    label: 'DBMS lab',
    createdAt: T0.toISOString(),
    expiresAt: plus(600).toISOString(),
    endedAt: null,
    status: 'open',
    ...overrides,
  };
}

describe('the rotating token', () => {
  it('changes as the window turns over', () => {
    // The whole point: a photograph of the projector stops working. A static
    // code shown for ten minutes is a code the year group has by minute two.
    const now = currentToken(SECRET, T0);
    const later = currentToken(SECRET, plus(ROTATION_SECONDS * 3));
    expect(later).not.toBe(now);
  });

  it('accepts a scan that lands just after the code changed', () => {
    // A student pressing the button as it rotates would otherwise fail for a
    // reason they could neither understand nor fix.
    const old = currentToken(SECRET, T0);
    expect(isTokenValid(SECRET, old, plus(ROTATION_SECONDS))).toBe(true);
  });

  it('refuses one from two windows ago', () => {
    const old = currentToken(SECRET, T0);
    expect(isTokenValid(SECRET, old, plus(ROTATION_SECONDS * 3))).toBe(false);
  });

  it('refuses a token minted under a different session secret', () => {
    const other = currentToken(newSessionSecret(), T0);
    expect(isTokenValid(SECRET, other, T0)).toBe(false);
  });

  it('refuses junk without throwing', () => {
    for (const junk of ['', 'aaaaaaaaaa', 'x', 'a'.repeat(200)]) {
      expect(isTokenValid(SECRET, junk, T0), junk.slice(0, 12)).toBe(false);
    }
  });
});

describe('the QR payload', () => {
  it('round-trips', () => {
    const payload = exitQrPayload('ex_1', currentToken(SECRET, T0));
    expect(parseExitQrPayload(payload)).toEqual({
      sessionId: 'ex_1',
      token: currentToken(SECRET, T0),
    });
  });

  it('refuses anything that is not ours', () => {
    // A student scanning an assignment QR, or any other code in the room.
    for (const other of [
      'https://example.com/a/K7M2QP',
      'eduplus-exit:only-one-part',
      'random text',
      '',
    ]) {
      expect(parseExitQrPayload(other), other).toBeNull();
    }
  });
});

describe('session lifetime', () => {
  it('is live until it expires', () => {
    expect(isSessionLive(session(), plus(300))).toBe(true);
    expect(isSessionLive(session(), plus(601))).toBe(false);
  });

  it('stops the moment a mentor ends it', () => {
    const ended = session({ status: 'ended', endedAt: plus(60).toISOString() });
    expect(isSessionLive(ended, plus(61))).toBe(false);
    expect(describeSessionState(ended, plus(61))).toMatch(/ended/i);
  });

  it('explains an expiry in words a student can act on', () => {
    expect(describeSessionState(session(), plus(601))).toMatch(/expired/i);
  });
});

describe('what reaches a client', () => {
  it('never includes the secret', () => {
    // Anyone holding it could mint a valid code from anywhere, forever.
    const published = stripSecret(session());
    expect('secret' in published).toBe(false);
    expect(JSON.stringify(published)).not.toContain(SECRET);
  });
});
