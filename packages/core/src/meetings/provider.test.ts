import { describe, expect, it } from 'vitest';
import { activeProvider, createMeetingLink, googleConfig } from './provider';
import { isJoinable, isUpcoming, type Meeting } from '../schemas/meeting';

const GOOGLE_ENV = {
  GOOGLE_CLIENT_ID: 'client.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'secret',
  GOOGLE_REFRESH_TOKEN: 'refresh',
} as NodeJS.ProcessEnv;

function meeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    meetingId: 'mt_1OX21IS045_abc123',
    usn: '1OX21IS045',
    title: 'Catch-up',
    reason: 'Attendance 37.8% against a 90% threshold.',
    startsAt: '2026-10-12T10:00:00+05:30',
    endsAt: '2026-10-12T10:30:00+05:30',
    status: 'scheduled',
    provider: 'jitsi',
    joinUrl: 'https://meet.jit.si/EduPlus-abc-123',
    calendarEventId: null,
    interventionId: null,
    proposedBy: 'copilot',
    scheduledBy: 'faculty-1',
    createdAt: '2026-10-10T06:00:00.000Z',
    failureReason: null,
    ...overrides,
  };
}

describe('choosing a provider', () => {
  it('reads Google credentials only when all three are present', () => {
    expect(googleConfig({} as NodeJS.ProcessEnv)).toBeNull();
    expect(
      googleConfig({ GOOGLE_CLIENT_ID: 'a', GOOGLE_CLIENT_SECRET: 'b' } as NodeJS.ProcessEnv),
    ).toBeNull();
    expect(googleConfig(GOOGLE_ENV)).not.toBeNull();
  });

  it('defaults the calendar to the account’s primary one', () => {
    expect(googleConfig(GOOGLE_ENV)!.calendarId).toBe('primary');
    expect(
      googleConfig({ ...GOOGLE_ENV, GOOGLE_CALENDAR_ID: 'mentor@college.edu' })!.calendarId,
    ).toBe('mentor@college.edu');
  });

  it('falls back to Jitsi when Google is not configured', () => {
    expect(activeProvider({} as NodeJS.ProcessEnv)).toBe('jitsi');
    expect(activeProvider(GOOGLE_ENV)).toBe('google_meet');
  });
});

describe('the Jitsi fallback', () => {
  const request = {
    meetingId: 'mt_1OX21IS045_abc123',
    title: 'Catch-up',
    description: 'A short catch-up.',
    startsAt: '2026-10-12T10:00:00+05:30',
    endsAt: '2026-10-12T10:30:00+05:30',
  };

  it('produces a joinable https link with no credentials at all', async () => {
    const link = await createMeetingLink(request, {} as NodeJS.ProcessEnv);
    expect(link.provider).toBe('jitsi');
    expect(link.joinUrl).toMatch(/^https:\/\/meet\.jit\.si\/EduPlus-/);
    expect(link.calendarEventId).toBeNull();
  });

  it('keeps the USN out of the public URL', async () => {
    // The room name sits in a URL that anyone with the link can see, and a USN
    // identifies a real student at a real college.
    const link = await createMeetingLink(request, {} as NodeJS.ProcessEnv);
    expect(link.joinUrl).not.toContain('1OX21IS045');
  });

  it('is stable, so re-reading a meeting gives the same room', async () => {
    const a = await createMeetingLink(request, {} as NodeJS.ProcessEnv);
    const b = await createMeetingLink(request, {} as NodeJS.ProcessEnv);
    expect(a.joinUrl).toBe(b.joinUrl);
  });

  it('gives two meetings two different rooms', async () => {
    const a = await createMeetingLink(request, {} as NodeJS.ProcessEnv);
    const b = await createMeetingLink(
      { ...request, meetingId: 'mt_1OX21IS045_def456' },
      {} as NodeJS.ProcessEnv,
    );
    expect(a.joinUrl).not.toBe(b.joinUrl);
  });
});

describe('the join window', () => {
  const start = new Date('2026-10-12T10:00:00+05:30');

  it('opens ten minutes early', () => {
    // A student who taps at 09:58 and finds a dead button assumes the meeting
    // is off, so the link goes live before the start time.
    expect(isJoinable(meeting(), new Date(start.getTime() - 11 * 60_000))).toBe(false);
    expect(isJoinable(meeting(), new Date(start.getTime() - 9 * 60_000))).toBe(true);
  });

  it('closes at the end, so a finished meeting is not still joinable', () => {
    expect(isJoinable(meeting(), new Date(start.getTime() + 29 * 60_000))).toBe(true);
    expect(isJoinable(meeting(), new Date(start.getTime() + 31 * 60_000))).toBe(false);
  });

  it('is never joinable without a link, or once cancelled', () => {
    expect(isJoinable(meeting({ joinUrl: null }), start)).toBe(false);
    expect(isJoinable(meeting({ status: 'cancelled' }), start)).toBe(false);
    expect(isJoinable(meeting({ status: 'proposed', joinUrl: null }), start)).toBe(false);
  });

  it('counts a meeting as upcoming only while it is scheduled and unfinished', () => {
    expect(isUpcoming(meeting(), new Date(start.getTime() - 60 * 60_000))).toBe(true);
    expect(isUpcoming(meeting(), new Date(start.getTime() + 60 * 60_000))).toBe(false);
    expect(isUpcoming(meeting({ status: 'cancelled' }), start)).toBe(false);
    expect(isUpcoming(meeting({ status: 'proposed' }), start)).toBe(false);
  });
});
