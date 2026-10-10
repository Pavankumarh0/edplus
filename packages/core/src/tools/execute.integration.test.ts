import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '../schemas/index';
import { DEFAULT_RISK_RULES } from '../schemas/index';
import { computeSnapshot } from '../risk/engine';
import { makeRecordId, type AcademicRecord } from '../schemas/index';
import { getDb, resetDbCache, type Firestore } from '../repositories/firestore';
import { ensureRiskRules, listAudit } from '../repositories/config';
import { saveSnapshot } from '../repositories/academics';
import { upsertStudents } from '../repositories/students';
import { executeTool } from './execute';

/**
 * Runs against the Firestore emulator (see vitest.rules.config.mts).
 *
 * The unit tests cover which actor may call which tool; these cover what
 * actually lands in Firestore — in particular that a refused call still writes
 * an audit row, which is the only way that guarantee is worth anything.
 */

const USN = '1OX21IS045';
const faculty: Actor = { kind: 'faculty', id: 'faculty-uid' };
const voiceAgent: Actor = { kind: 'agent', id: 'agent:voice', agentName: 'voice' };
const reportAgent: Actor = { kind: 'agent', id: 'agent:report', agentName: 'report' };

let db: Firestore;

function rec(type: AcademicRecord['type'], value: number, maxValue: number): AcademicRecord {
  const date = '2026-03-01';
  return {
    recordId: makeRecordId({ usn: USN, type, subject: 'DBMS', date }),
    usn: USN, type, subject: 'DBMS', value, maxValue, date, sourceUploadId: 'u1',
  };
}

beforeAll(() => {
  process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
  process.env.FIREBASE_PROJECT_ID ??= 'eduplus-tools-test';
  resetDbCache();
  db = getDb();
});

afterAll(() => {
  resetDbCache();
});

beforeEach(async () => {
  for (const collection of ['students', 'audit', 'interventions', 'calls']) {
    await db.recursiveDelete(db.collection(collection));
  }
  await ensureRiskRules(db);
  await upsertStudents(db, [
    {
      usn: USN,
      name: 'Ananya Reddy',
      semester: 5,
      section: 'A',
      department: 'Information Science',
      parent: { name: 'Venkat Reddy', phone: '+919900112233', preferredLanguage: 'te-IN' },
    },
  ]);
  const snapshot = computeSnapshot({
    usn: USN,
    records: [rec('attendance', 17, 45), rec('assessment', 7, 50), rec('submission', 1, 6)],
    rules: DEFAULT_RISK_RULES,
    now: new Date('2026-03-02T09:00:00.000Z'),
  });
  await saveSnapshot(db, snapshot);
});

describe('executeTool — happy path', () => {
  it('returns the student with their current snapshot', async () => {
    const result = await executeTool(
      'get_student',
      { usn: USN },
      { db, actor: faculty },
    );
    expect(result.ok).toBe(true);
    const data = result.data as { student: { name: string }; snapshot: { level: string } };
    expect(data.student.name).toBe('Ananya Reddy');
    expect(data.snapshot.level).toBe('critical');
  });

  it('explains the score with thresholds attached', async () => {
    const result = await executeTool('get_risk_breakdown', { usn: USN }, { db, actor: faculty });
    expect(result.ok).toBe(true);
    const data = result.data as {
      score: number;
      indicators: { key: string; threshold?: number; reason: string }[];
    };
    expect(data.score).toBeGreaterThan(70);
    const attendance = data.indicators.find((i) => i.key === 'attendance')!;
    expect(attendance.threshold).toBe(DEFAULT_RISK_RULES.indicators.attendance!.threshold);
    expect(attendance.reason).toContain('%');
  });

  it('normalises a lowercase USN rather than reporting not-found', async () => {
    const result = await executeTool(
      'get_student',
      { usn: '1ox21is045' },
      { db, actor: faculty },
    );
    expect(result.ok).toBe(true);
  });
});

describe('executeTool — audit', () => {
  it('records a successful call with redacted arguments', async () => {
    await executeTool('get_student', { usn: USN }, { db, actor: reportAgent });
    const audit = await listAudit(db, 10);
    expect(audit).toHaveLength(1);
    expect(audit[0]!.tool).toBe('get_student');
    expect(audit[0]!.status).toBe('ok');
    expect(audit[0]!.actor.agentName).toBe('report');
    expect(audit[0]!.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('records a REFUSED call — the evidence the allowlist is real', async () => {
    const result = await executeTool(
      'get_risk_breakdown',
      { usn: USN },
      { db, actor: voiceAgent },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not permitted/);

    const audit = await listAudit(db, 10);
    expect(audit).toHaveLength(1);
    expect(audit[0]!.status).toBe('permission_denied');
    expect(audit[0]!.tool).toBe('get_risk_breakdown');
    expect(audit[0]!.actor.agentName).toBe('voice');
  });

  it('records a validation failure separately from a permission failure', async () => {
    const result = await executeTool('get_student', { usn: '' }, { db, actor: faculty });
    expect(result.ok).toBe(false);
    const audit = await listAudit(db, 10);
    expect(audit[0]!.status).toBe('validation_error');
  });

  it('records a handler error', async () => {
    const result = await executeTool(
      'get_student',
      { usn: 'NOSUCHSTUDENT' },
      { db, actor: faculty },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/No student with USN/);
    const audit = await listAudit(db, 10);
    expect(audit[0]!.status).toBe('error');
  });

  it('redacts a parent phone number out of the audit arguments', async () => {
    await executeTool(
      'schedule_parent_call',
      {
        usn: USN,
        purpose: 'ptm',
        approvedMessage: 'There is a parent-teacher meeting on 20 March at 10am.',
      },
      { db, actor: faculty },
    );
    const audit = await listAudit(db, 10);
    const row = audit.find((a) => a.tool === 'schedule_parent_call')!;
    // The phone never reaches the audit log in full, even indirectly.
    expect(JSON.stringify(row.args)).not.toContain('9900112233');
  });

  it('refuses an unknown tool and still audits it', async () => {
    const result = await executeTool('drop_database', {}, { db, actor: faculty });
    expect(result.ok).toBe(false);
    const audit = await listAudit(db, 10);
    expect(audit[0]!.tool).toBe('drop_database');
    expect(audit[0]!.status).toBe('error');
  });
});

describe('executeTool — the approval boundary', () => {
  it('stops an agent scheduling a parent call', async () => {
    for (const actor of [voiceAgent, reportAgent]) {
      const result = await executeTool(
        'schedule_parent_call',
        { usn: USN, purpose: 'ptm', approvedMessage: 'A sufficiently long approved message.' },
        { db, actor },
      );
      expect(result.ok, actor.agentName).toBe(false);
      expect(result.error).toMatch(/not permitted/);
    }
    // Nothing was created.
    const calls = await db.collection('calls').get();
    expect(calls.empty).toBe(true);
  });

  it('lets faculty schedule one, stamped with who approved it', async () => {
    const result = await executeTool(
      'schedule_parent_call',
      {
        usn: USN,
        purpose: 'ptm',
        approvedMessage: 'There is a parent-teacher meeting on 20 March at 10am.',
      },
      { db, actor: faculty },
    );
    expect(result.ok).toBe(true);
    const calls = await db.collection('calls').get();
    expect(calls.size).toBe(1);
    const call = calls.docs[0]!.data();
    expect(call.approvedBy).toBe('faculty-uid');
    expect(call.status).toBe('queued');
    // Language defaults to the parent's recorded preference.
    expect(call.language).toBe('te-IN');
  });

  it('refuses to call a student with no parent number on record', async () => {
    await upsertStudents(db, [{ usn: '1OX21IS999', name: 'No Contact' }]);
    const result = await executeTool(
      'schedule_parent_call',
      { usn: '1OX21IS999', purpose: 'absence', approvedMessage: 'Your ward was absent today.' },
      { db, actor: faculty },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/No parent phone number/);
  });

  it('lets an agent only propose an intervention', async () => {
    const result = await executeTool(
      'propose_intervention',
      {
        usn: USN,
        type: 'mentor_meeting',
        reason: 'Attendance 38% and assessment average 14% — both far below threshold.',
      },
      { db, actor: reportAgent },
    );
    expect(result.ok).toBe(true);
    const data = result.data as { interventionId: string; status: string };
    expect(data.status).toBe('proposed');

    const stored = await db.collection('interventions').doc(data.interventionId).get();
    expect(stored.data()!.status).toBe('proposed');
    // The baseline is frozen at proposal time.
    expect(stored.data()!.baselineScore).toBeGreaterThan(70);
    expect(stored.data()!.proposedBy).toBe('report');
  });

  it('refuses an illegal intervention transition', async () => {
    const created = await executeTool(
      'propose_intervention',
      {
        usn: USN,
        type: 'extra_class',
        reason: 'Assessment average 14% across all three subjects this term.',
      },
      { db, actor: faculty },
    );
    const { interventionId } = created.data as { interventionId: string };

    // proposed → completed skips approval entirely.
    const bad = await executeTool(
      'update_intervention',
      { interventionId, status: 'completed' },
      { db, actor: faculty },
    );
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/Cannot move from "proposed" to "completed"/);

    // The legal path works.
    const good = await executeTool(
      'update_intervention',
      { interventionId, status: 'approved' },
      { db, actor: faculty },
    );
    expect(good.ok).toBe(true);
  });
});

describe('executeTool — report integrity', () => {
  it('refuses a report written against a stale snapshot', async () => {
    const result = await executeTool(
      'save_report',
      {
        usn: USN,
        snapshotId: 'some-older-snapshot',
        body: {
          summary: 'Attendance is 38% and the assessment average is 14%.',
          strengths: [],
          concerns: [],
          actions: ['Attend every class this week.'],
          recommendedInterventions: [],
          dataCaveats: [],
        },
        rendered: '# Report',
        model: 'claude-sonnet-5-5',
      },
      { db, actor: reportAgent },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not the current snapshot/);
  });

  it('accepts a report against the current snapshot', async () => {
    const student = await executeTool('get_student', { usn: USN }, { db, actor: reportAgent });
    const { snapshot } = student.data as { snapshot: { snapshotId: string } };

    const result = await executeTool(
      'save_report',
      {
        usn: USN,
        snapshotId: snapshot.snapshotId,
        body: {
          summary: 'Attendance is 38% against a 90% threshold, and the assessment average is 14%.',
          strengths: [],
          concerns: [
            {
              indicator: 'Attendance',
              detail: 'You attended 17 of 45 classes.',
              whyItMatters: '75% attendance is required to sit the exam.',
            },
          ],
          actions: ['Attend all six DBMS classes next week.'],
          recommendedInterventions: [{ type: 'mentor_meeting', reason: 'Agree a catch-up plan.' }],
          dataCaveats: [],
        },
        rendered: '# Report\n\nAttendance is 38%.',
        model: 'claude-sonnet-5-5',
      },
      { db, actor: reportAgent },
    );
    expect(result.ok).toBe(true);
  });

  it('rejects a report body missing required sections', async () => {
    const result = await executeTool(
      'save_report',
      { usn: USN, snapshotId: 'x', body: { summary: 'Too little.' }, rendered: 'x', model: 'm' },
      { db, actor: reportAgent },
    );
    expect(result.ok).toBe(false);
    const audit = await listAudit(db, 5);
    expect(audit[0]!.status).toBe('validation_error');
  });
});

describe('executeTool — voice agent limits', () => {
  it('cannot read call context for an unapproved call', async () => {
    await db.collection('calls').doc('c-unapproved').set({
      callId: 'c-unapproved', usn: USN, purpose: 'ptm', language: 'te-IN', status: 'queued',
      provider: 'simulated', providerCallId: null,
      approvedMessage: 'A message that was never approved by anyone.',
      approvedBy: null, transcript: [], summary: null, parentResponse: null,
      parentResponseNote: null, recordingUrl: null, failureReason: null,
      interventionId: null, createdAt: new Date().toISOString(), startedAt: null, endedAt: null,
    });

    const result = await executeTool(
      'get_call_context',
      { callId: 'c-unapproved' },
      { db, actor: voiceAgent },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/has not been approved/);
  });

  it('gets only the minimum context, with no score and no marks', async () => {
    const scheduled = await executeTool(
      'schedule_parent_call',
      {
        usn: USN,
        purpose: 'ptm',
        approvedMessage: 'There is a parent-teacher meeting on 20 March at 10am. Can you attend?',
      },
      { db, actor: faculty },
    );
    const { callId } = scheduled.data as { callId: string };

    const result = await executeTool('get_call_context', { callId }, { db, actor: voiceAgent });
    expect(result.ok).toBe(true);

    const context = result.data as Record<string, unknown>;
    expect(context.studentFirstName).toBe('Ananya');
    expect(context.parentName).toBe('Venkat Reddy');
    expect(context.language).toBe('te-IN');
    expect(context.riskBand).toBe('needs_attention');

    // The numeric score, the level and any marks must be absent entirely.
    const serialised = JSON.stringify(context);
    expect(serialised).not.toMatch(/"score"/);
    expect(serialised).not.toMatch(/critical/);
    expect(serialised).not.toContain('9900112233');
  });

  it('logs a call outcome', async () => {
    const scheduled = await executeTool(
      'schedule_parent_call',
      { usn: USN, purpose: 'ptm', approvedMessage: 'Meeting on 20 March at 10am. Can you attend?' },
      { db, actor: faculty },
    );
    const { callId } = scheduled.data as { callId: string };

    const result = await executeTool(
      'log_call_outcome',
      {
        callId,
        parentResponse: 'confirmed_attending',
        summary: 'Parent confirmed they will attend the meeting on 20 March.',
      },
      { db, actor: voiceAgent },
    );
    expect(result.ok).toBe(true);

    const call = await db.collection('calls').doc(callId).get();
    expect(call.data()!.parentResponse).toBe('confirmed_attending');
    expect(call.data()!.status).toBe('completed');
  });
});
