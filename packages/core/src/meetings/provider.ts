import type { MeetingProvider } from '../schemas/meeting';

/**
 * Creating the live link.
 *
 * Two implementations behind one call, chosen by what is configured:
 *
 *   google_meet — a real event on the mentor's Google Calendar with a Meet
 *                 conference attached, created through the Calendar API.
 *   jitsi       — a room on meet.jit.si, which needs no account on either
 *                 side and no credentials at all.
 *
 * The fallback is not decoration. Google Meet links cannot be minted without
 * OAuth against a real Google account, so a deployment without credentials
 * would otherwise have a "Schedule meeting" button that only ever errors. A
 * mentor and a student can join a Jitsi room from the same two dashboards,
 * which is the behaviour the feature promises; the provider is recorded on
 * the meeting and shown in both UIs, so nobody is misled about which it is.
 */

export interface MeetingRequest {
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  /** Used to build a stable, unguessable room name for the fallback. */
  meetingId: string;
  /** Invited on the Google Calendar event when known. */
  attendeeEmails?: string[];
}

export interface MeetingLink {
  provider: MeetingProvider;
  joinUrl: string;
  calendarEventId: string | null;
}

export class MeetingProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MeetingProviderError';
  }
}

interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  calendarId: string;
}

/** Reads Google credentials from the environment, or null when incomplete. */
export function googleConfig(env: NodeJS.ProcessEnv = process.env): GoogleConfig | null {
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  const refreshToken = env.GOOGLE_REFRESH_TOKEN?.trim();
  if (!clientId || !clientSecret || !refreshToken) return null;
  return {
    clientId,
    clientSecret,
    refreshToken,
    calendarId: env.GOOGLE_CALENDAR_ID?.trim() || 'primary',
  };
}

/** Which provider a call to `createMeetingLink` would actually use. */
export function activeProvider(env: NodeJS.ProcessEnv = process.env): MeetingProvider {
  return googleConfig(env) ? 'google_meet' : 'jitsi';
}

// ─────────────────────────────────────────────────────────────────────────────
// Google
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Exchanges the long-lived refresh token for an access token.
 *
 * A refresh token rather than a service account on purpose: Meet conferences
 * belong to a Google account, and a service account cannot create one without
 * Workspace domain-wide delegation, which a college running on consumer Gmail
 * does not have.
 */
async function accessToken(config: GoogleConfig): Promise<string> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  const json = (await response.json()) as { access_token?: string; error_description?: string; error?: string };
  if (!response.ok || !json.access_token) {
    throw new MeetingProviderError(
      `Google refused the refresh token (${response.status}): ` +
        `${json.error_description ?? json.error ?? 'no detail'}. ` +
        'Re-run the consent step to get a new GOOGLE_REFRESH_TOKEN.',
    );
  }
  return json.access_token;
}

async function createGoogleMeet(
  request: MeetingRequest,
  config: GoogleConfig,
): Promise<MeetingLink> {
  const token = await accessToken(config);

  const url =
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(config.calendarId)}/events` +
    // Without conferenceDataVersion=1 the API silently drops the Meet request
    // and returns an event with no link, which looks like success.
    '?conferenceDataVersion=1&sendUpdates=all';

  const response = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      summary: request.title,
      description: request.description,
      start: { dateTime: request.startsAt },
      end: { dateTime: request.endsAt },
      attendees: (request.attendeeEmails ?? []).map((email) => ({ email })),
      conferenceData: {
        createRequest: {
          // Must be unique per event, and stable for a retry of the same one.
          requestId: request.meetingId,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      },
    }),
  });

  const json = (await response.json()) as {
    id?: string;
    hangoutLink?: string;
    conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
    error?: { message?: string };
  };

  if (!response.ok) {
    throw new MeetingProviderError(
      `Google Calendar refused the event (${response.status}): ${json.error?.message ?? 'no detail'}`,
    );
  }

  const joinUrl =
    json.hangoutLink ??
    json.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video')?.uri;

  if (!joinUrl) {
    throw new MeetingProviderError(
      'Google created the event but attached no Meet link. The account may not be ' +
        'allowed to create conferences.',
    );
  }

  return { provider: 'google_meet', joinUrl, calendarEventId: json.id ?? null };
}

// ─────────────────────────────────────────────────────────────────────────────
// Jitsi
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A room name nobody can guess their way into.
 *
 * `meetingId` already contains the USN, which would put a student's number in
 * a public URL, so it is hashed rather than used directly.
 */
function roomName(meetingId: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < meetingId.length; i += 1) {
    hash ^= meetingId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `EduPlus-${hash.toString(36)}-${meetingId.slice(-6)}`;
}

function createJitsi(request: MeetingRequest): MeetingLink {
  return {
    provider: 'jitsi',
    joinUrl: `https://meet.jit.si/${roomName(request.meetingId)}`,
    calendarEventId: null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates the live link for a meeting.
 *
 * Falls back to Jitsi when Google is configured but refuses, rather than
 * leaving the mentor with no meeting at all — the caller is told which
 * provider was used and why, and records it on the meeting.
 */
export async function createMeetingLink(
  request: MeetingRequest,
  env: NodeJS.ProcessEnv = process.env,
): Promise<MeetingLink & { note: string | null }> {
  const config = googleConfig(env);
  if (!config) {
    return { ...createJitsi(request), note: null };
  }

  try {
    return { ...(await createGoogleMeet(request, config)), note: null };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ...createJitsi(request),
      note: `Google Meet was unavailable, so a Jitsi room was used instead. ${detail}`,
    };
  }
}

/** Removes the calendar event behind a cancelled meeting, if there was one. */
export async function deleteCalendarEvent(
  calendarEventId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const config = googleConfig(env);
  if (!config) return;

  const token = await accessToken(config);
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(config.calendarId)}` +
      `/events/${encodeURIComponent(calendarEventId)}?sendUpdates=all`,
    { method: 'DELETE', headers: { authorization: `Bearer ${token}` } },
  );

  // 410 means it is already gone, which is the state we wanted.
  if (!response.ok && response.status !== 404 && response.status !== 410) {
    throw new MeetingProviderError(
      `Google Calendar refused to delete the event (${response.status}).`,
    );
  }
}
