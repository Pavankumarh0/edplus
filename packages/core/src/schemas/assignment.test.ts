import { describe, expect, it } from 'vitest';
import {
  AssignmentSchema,
  SubmissionSchema,
  classifySubmission,
  describeRemaining,
  isEligible,
  makeAssignmentCode,
  normaliseAssignmentCode,
  timeRemainingMs,
} from './assignment';

const DEADLINE = '2026-10-18T17:00:00+05:30';
const assignment = { deadline: DEADLINE };

describe('the deadline', () => {
  it('is decided by the given clock, not by anything a client sent', () => {
    // The caller passes the SERVER's clock. A phone with its date wound back
    // changes nothing, which is the only property here that matters.
    const justBefore = new Date('2026-10-18T16:59:59+05:30');
    const justAfter = new Date('2026-10-18T17:00:01+05:30');

    expect(classifySubmission(assignment, justBefore)).toBe('on_time');
    expect(classifySubmission(assignment, justAfter)).toBe('late');
  });

  it('counts the deadline instant itself as on time', () => {
    expect(classifySubmission(assignment, new Date(DEADLINE))).toBe('on_time');
  });

  it('compares instants, not wall clocks', () => {
    // 11:30 UTC is 17:00 IST. A naive string or local-time comparison gets
    // this wrong, and gets it wrong only for students in another timezone.
    expect(classifySubmission(assignment, new Date('2026-10-18T11:29:00Z'))).toBe('on_time');
    expect(classifySubmission(assignment, new Date('2026-10-18T11:31:00Z'))).toBe('late');
  });

  it('reports time left and overdue in words', () => {
    const base = new Date(DEADLINE).getTime();
    expect(describeRemaining(timeRemainingMs(assignment, new Date(base - 30 * 60_000)))).toBe(
      '30 minutes left',
    );
    expect(describeRemaining(timeRemainingMs(assignment, new Date(base - 5 * 3_600_000)))).toBe(
      '5 hours left',
    );
    expect(describeRemaining(timeRemainingMs(assignment, new Date(base + 20 * 60_000)))).toBe(
      'overdue by 20 minutes',
    );
  });
});

describe('eligibility', () => {
  const forFiveA = { semester: 5, section: 'A' };

  it('lets in a student of the right class', () => {
    expect(isEligible(forFiveA, { semester: 5, section: 'A' })).toBe(true);
  });

  it('keeps out another section and another semester', () => {
    // Finding the code is not the same as being allowed to open it. A code
    // shown on a projector is not a secret, so this is the real control.
    expect(isEligible(forFiveA, { semester: 5, section: 'B' })).toBe(false);
    expect(isEligible(forFiveA, { semester: 6, section: 'A' })).toBe(false);
  });

  it('ignores case and padding in the section', () => {
    expect(isEligible(forFiveA, { semester: 5, section: ' a ' })).toBe(true);
  });
});

describe('the code', () => {
  it('avoids characters that are misread off a screen', () => {
    // It gets typed by hand from a projector, so O/0 and I/1 are out.
    for (let i = 0; i < 200; i += 1) {
      expect(makeAssignmentCode()).not.toMatch(/[O0I1L]/);
    }
  });

  it('is six characters', () => {
    expect(makeAssignmentCode()).toHaveLength(6);
  });

  it('survives the full URL a QR actually carries', () => {
    // The QR encodes a URL so a phone's own camera app shows something
    // meaningful. Everything downstream must cope with that, not just the six
    // characters — a length cap sized for the code rejected every real scan.
    const scanned = 'https://unpredestined-ayana-haphazardly.ngrok-free.dev/a/K7M2QP';
    const last = scanned.split('/').filter(Boolean).pop()!;
    expect(normaliseAssignmentCode(last)).toBe('K7M2QP');
    expect(scanned.length).toBeGreaterThan(32);
  });

  it('forgives the usual misreadings when typed', () => {
    expect(normaliseAssignmentCode('k7m2qp')).toBe('K7M2QP');
    expect(normaliseAssignmentCode(' K7 M2 QP ')).toBe('K7M2QP');
    // Someone typing the letter O meant the letter O; there is no digit 0.
    expect(normaliseAssignmentCode('0BCDEF')).toBe('OBCDEF');
    expect(normaliseAssignmentCode('1BCDEF')).toBe('IBCDEF');
  });
});

describe('the submission record', () => {
  it('defaults to a first attempt with no history', () => {
    const parsed = SubmissionSchema.parse({
      assignmentId: 'as_1',
      usn: '1OX21IS045',
      content: 'done',
      submittedAt: '2026-10-18T10:00:00.000Z',
      status: 'on_time',
    });
    expect(parsed.version).toBe(1);
    expect(parsed.history).toEqual([]);
  });

  it('refuses empty work rather than recording a blank submission', () => {
    expect(
      SubmissionSchema.safeParse({
        assignmentId: 'as_1',
        usn: '1OX21IS045',
        content: '   ',
        submittedAt: '2026-10-18T10:00:00.000Z',
        status: 'on_time',
      }).success,
    ).toBe(false);
  });
});

describe('the assignment record', () => {
  it('accepts late work unless told otherwise', () => {
    // Late work is still work. Silently discarding it loses the evidence that
    // a struggling student did anything at all.
    const parsed = AssignmentSchema.parse({
      assignmentId: 'as_1',
      code: 'K7M2QP',
      title: 'Normalisation',
      subject: 'DBMS',
      instructions: 'Normalise to 3NF.',
      facultyId: 'f1',
      facultyName: 'Faculty',
      semester: 5,
      section: 'A',
      deadline: DEADLINE,
      status: 'open',
      createdAt: '2026-10-11T10:00:00.000Z',
    });
    expect(parsed.acceptLate).toBe(true);
  });
});
