import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));

const OWN_USN = '1OX21IS045';
const OTHER_USN = '1OX21IS001';

let testEnv: RulesTestEnvironment;

/** Faculty member. */
function faculty() {
  return testEnv.authenticatedContext('faculty-uid', { role: 'faculty' }).firestore();
}

/** The student whose USN is OWN_USN. */
function student() {
  return testEnv.authenticatedContext('student-uid', { role: 'student', usn: OWN_USN }).firestore();
}

/** A signed-in user whose token carries no role at all. */
function roleless() {
  return testEnv.authenticatedContext('nobody-uid', {}).firestore();
}

function anonymous() {
  return testEnv.unauthenticatedContext().firestore();
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'eduplus-rules-test',
    firestore: {
      rules: readFileSync(join(HERE, 'firestore.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  // Seed with rules bypassed — this is the server's view of the world.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const usn of [OWN_USN, OTHER_USN]) {
      await setDoc(doc(db, 'students', usn), {
        usn,
        name: usn === OWN_USN ? 'Ananya Reddy' : 'Aarav Sharma',
        semester: 5,
        section: 'A',
        department: 'Information Science',
        hasParentContact: true,
      });
      await setDoc(doc(db, 'students', usn, 'private', 'parent'), {
        name: 'Venkat Reddy',
        phone: '+919900112233',
        preferredLanguage: 'te-IN',
      });
      await setDoc(doc(db, 'students', usn, 'records', 'r1'), {
        usn, type: 'attendance', subject: 'DBMS', value: 17, maxValue: 45,
        date: '2026-03-01', sourceUploadId: 'u1',
      });
      await setDoc(doc(db, 'students', usn, 'snapshots', 's1'), {
        usn, score: 78.4, level: 'critical', rulesVersion: 1,
        createdAt: '2026-03-02T09:00:00.000Z',
      });
      await setDoc(doc(db, 'students', usn, 'reports', 'rep1'), {
        usn, snapshotId: 's1', rendered: '# Report', model: 'claude-sonnet-5-5',
        createdAt: '2026-03-02T09:05:00.000Z',
      });
      await setDoc(doc(db, 'students', usn, 'tasks', 't1'), {
        usn, title: 'Attend all 6 DBMS classes this week', done: false,
        doneAt: null, interventionId: 'iv1',
      });
      await setDoc(doc(db, 'students', usn, 'meetings', 'mt1'), {
        meetingId: 'mt1', usn, title: 'Attendance check-in',
        reason: 'Attendance 37.8% against a 90% threshold.',
        startsAt: '2026-03-10T04:30:00.000Z', endsAt: '2026-03-10T05:00:00.000Z',
        status: 'scheduled', provider: 'google_meet',
        joinUrl: 'https://meet.google.com/abc-defg-hij', calendarEventId: 'ev1',
        interventionId: null, proposedBy: 'copilot', scheduledBy: 'faculty-uid',
        createdAt: '2026-03-03T06:00:00.000Z', failureReason: null,
      });
      await setDoc(doc(db, 'students', usn, 'plans', 'p1'), {
        planId: 'p1', usn, snapshotId: 's1', goal: 'Get attendance above 75%',
        rationale: 'Attendance 37.8% against a 90% threshold.',
        focus: ['attendance'], weeks: 2, milestones: [], status: 'active',
        model: 'claude-sonnet-5-5', createdAt: '2026-03-03T06:00:00.000Z',
      });
      await setDoc(doc(db, 'students', usn, 'activities', 'a1'), {
        activityId: 'a1', usn, planId: 'p1', kind: 'quiz', subject: 'DBMS',
        title: 'Normalisation basics', reason: 'Weakest subject.',
        questions: [{ question: 'What is 1NF?', options: ['a', 'b'], answerIndex: 0, explanation: 'x' }],
        status: 'ready', score: null, outOf: null, attemptedAt: null,
        model: 'claude-sonnet-5-5', createdAt: '2026-03-03T06:00:00.000Z',
      });
    }
    await setDoc(doc(db, 'interventions', 'iv1'), {
      usn: OWN_USN, type: 'mentor_meeting', status: 'approved',
      reason: 'Attendance 38% — below the 75% threshold.',
      baselineSnapshotId: 's1', baselineScore: 78.4,
    });
    await setDoc(doc(db, 'calls', 'c1'), {
      usn: OWN_USN, purpose: 'ptm', status: 'completed',
      approvedMessage: 'There is a parent-teacher meeting on 20 March.',
    });
    await setDoc(doc(db, 'uploads', 'u1'), { fileName: 'march.csv', rowsOk: 90 });
    await setDoc(doc(db, 'config', 'riskRules'), { rulesVersion: 1 });
    await setDoc(doc(db, 'audit', 'a1'), { tool: 'get_student', status: 'ok' });
  });
});

describe('unauthenticated access', () => {
  it('is denied everywhere', async () => {
    const db = anonymous();
    await assertFails(getDoc(doc(db, 'students', OWN_USN)));
    await assertFails(getDoc(doc(db, 'config', 'riskRules')));
    await assertFails(getDoc(doc(db, 'interventions', 'iv1')));
    await assertFails(getDocs(collection(db, 'students', OWN_USN, 'snapshots')));
  });
});

describe('a signed-in user with no role claim', () => {
  it('cannot read student data', async () => {
    const db = roleless();
    await assertFails(getDoc(doc(db, 'students', OWN_USN)));
    await assertFails(getDoc(doc(db, 'students', OWN_USN, 'snapshots', 's1')));
  });

  it('can still read the risk rules, which are not sensitive', async () => {
    await assertSucceeds(getDoc(doc(roleless(), 'config', 'riskRules')));
  });
});

describe('faculty', () => {
  it('can read any student and their academic data', async () => {
    const db = faculty();
    await assertSucceeds(getDoc(doc(db, 'students', OWN_USN)));
    await assertSucceeds(getDoc(doc(db, 'students', OTHER_USN)));
    await assertSucceeds(getDocs(collection(db, 'students', OWN_USN, 'records')));
    await assertSucceeds(getDocs(collection(db, 'students', OWN_USN, 'snapshots')));
    await assertSucceeds(getDoc(doc(db, 'students', OWN_USN, 'reports', 'rep1')));
  });

  it('CAN read a parent contact', async () => {
    await assertSucceeds(getDoc(doc(faculty(), 'students', OWN_USN, 'private', 'parent')));
  });

  it('can read interventions, calls and uploads', async () => {
    const db = faculty();
    await assertSucceeds(getDoc(doc(db, 'interventions', 'iv1')));
    await assertSucceeds(getDoc(doc(db, 'calls', 'c1')));
    await assertSucceeds(getDoc(doc(db, 'uploads', 'u1')));
  });

  it('cannot write from the browser — every write goes through the Admin SDK', async () => {
    const db = faculty();
    await assertFails(setDoc(doc(db, 'students', 'NEW123'), { usn: 'NEW123', name: 'X' }));
    await assertFails(updateDoc(doc(db, 'students', OWN_USN), { name: 'Renamed' }));
    await assertFails(setDoc(doc(db, 'interventions', 'iv2'), { usn: OWN_USN }));
    await assertFails(updateDoc(doc(db, 'config', 'riskRules'), { rulesVersion: 99 }));
  });

  it('cannot forge a risk snapshot — a client-writable score would be worthless', async () => {
    await assertFails(
      setDoc(doc(faculty(), 'students', OWN_USN, 'snapshots', 'forged'), {
        usn: OWN_USN, score: 0, level: 'stable',
      }),
    );
  });

  it('cannot read the audit log', async () => {
    await assertFails(getDoc(doc(faculty(), 'audit', 'a1')));
  });
});

describe('a student reading their own data', () => {
  it('can read their own student document', async () => {
    await assertSucceeds(getDoc(doc(student(), 'students', OWN_USN)));
  });

  it('can read their own records, snapshots and reports', async () => {
    const db = student();
    await assertSucceeds(getDocs(collection(db, 'students', OWN_USN, 'records')));
    await assertSucceeds(getDocs(collection(db, 'students', OWN_USN, 'snapshots')));
    await assertSucceeds(getDoc(doc(db, 'students', OWN_USN, 'reports', 'rep1')));
    await assertSucceeds(getDocs(collection(db, 'students', OWN_USN, 'tasks')));
  });
});

describe('a student must not reach another student', () => {
  it('cannot read another student document', async () => {
    await assertFails(getDoc(doc(student(), 'students', OTHER_USN)));
  });

  it('cannot read another student’s records, snapshots, reports or tasks', async () => {
    const db = student();
    await assertFails(getDocs(collection(db, 'students', OTHER_USN, 'records')));
    await assertFails(getDocs(collection(db, 'students', OTHER_USN, 'snapshots')));
    await assertFails(getDoc(doc(db, 'students', OTHER_USN, 'reports', 'rep1')));
    await assertFails(getDocs(collection(db, 'students', OTHER_USN, 'tasks')));
  });

  it('cannot tick off another student’s task', async () => {
    await assertFails(
      updateDoc(doc(student(), 'students', OTHER_USN, 'tasks', 't1'), { done: true }),
    );
  });
});

describe('parent contact confidentiality', () => {
  it('a student cannot read their OWN parent contact', async () => {
    // The single most important rule in this file: a parent's phone number is
    // faculty/server data, even on the student's own record.
    await assertFails(getDoc(doc(student(), 'students', OWN_USN, 'private', 'parent')));
  });

  it('a student cannot list the private subcollection', async () => {
    await assertFails(getDocs(collection(student(), 'students', OWN_USN, 'private')));
  });

  it('a student cannot read another student’s parent contact', async () => {
    await assertFails(getDoc(doc(student(), 'students', OTHER_USN, 'private', 'parent')));
  });

  it('nobody can write a parent contact from a client', async () => {
    await assertFails(
      setDoc(doc(faculty(), 'students', OWN_USN, 'private', 'parent'), { phone: '+910000000000' }),
    );
  });
});

describe('a student ticking off their own task', () => {
  it('can set done and doneAt', async () => {
    await assertSucceeds(
      updateDoc(doc(student(), 'students', OWN_USN, 'tasks', 't1'), {
        done: true,
        doneAt: '2026-03-10T10:00:00.000Z',
      }),
    );
  });

  it('cannot rewrite the task itself', async () => {
    const db = student();
    const ref = doc(db, 'students', OWN_USN, 'tasks', 't1');
    await assertFails(updateDoc(ref, { title: 'Something easier' }));
    await assertFails(updateDoc(ref, { done: true, title: 'Sneaky' }));
    await assertFails(updateDoc(ref, { interventionId: 'iv-other' }));
    await assertFails(updateDoc(ref, { dueDate: '2030-01-01' }));
  });

  it('cannot set done to a non-boolean', async () => {
    await assertFails(
      updateDoc(doc(student(), 'students', OWN_USN, 'tasks', 't1'), { done: 'yes' }),
    );
  });

  it('can read its own meetings, including the join link', async () => {
    // The student is an invitee. A meeting they cannot see the link for is a
    // meeting they cannot attend, so this read is the feature working.
    const db = student();
    await assertSucceeds(getDoc(doc(db, 'students', OWN_USN, 'meetings', 'mt1')));
    await assertSucceeds(getDocs(collection(db, 'students', OWN_USN, 'meetings')));
  });

  it('cannot read another student’s meetings', async () => {
    const db = student();
    await assertFails(getDoc(doc(db, 'students', OTHER_USN, 'meetings', 'mt1')));
    await assertFails(getDocs(collection(db, 'students', OTHER_USN, 'meetings')));
  });

  it('cannot book, move or cancel a meeting', async () => {
    // Booking is consequential and server-only. A student who could write here
    // could put a meeting on a mentor's calendar.
    const db = student();
    await assertFails(
      setDoc(doc(db, 'students', OWN_USN, 'meetings', 'invented'), {
        meetingId: 'invented', usn: OWN_USN, title: 'Marks review', status: 'scheduled',
      }),
    );
    await assertFails(
      updateDoc(doc(db, 'students', OWN_USN, 'meetings', 'mt1'), { status: 'cancelled' }),
    );
    await assertFails(
      updateDoc(doc(db, 'students', OWN_USN, 'meetings', 'mt1'), {
        startsAt: '2026-03-11T04:30:00.000Z',
      }),
    );
    await assertFails(deleteDoc(doc(db, 'students', OWN_USN, 'meetings', 'mt1')));
  });

  it('cannot create or delete tasks', async () => {
    const db = student();
    await assertFails(
      setDoc(doc(db, 'students', OWN_USN, 'tasks', 'invented'), { title: 'Free marks', done: true }),
    );
    await assertFails(deleteDoc(doc(db, 'students', OWN_USN, 'tasks', 't1')));
  });
});

describe('a student must not reach faculty-only collections', () => {
  it('cannot read interventions — `reason` is written for a mentor, not a student', async () => {
    await assertFails(getDoc(doc(student(), 'interventions', 'iv1')));
    await assertFails(getDocs(collection(student(), 'interventions')));
  });

  it('cannot read parent call transcripts', async () => {
    await assertFails(getDoc(doc(student(), 'calls', 'c1')));
    await assertFails(getDocs(collection(student(), 'calls')));
  });

  it('cannot read uploads', async () => {
    await assertFails(getDoc(doc(student(), 'uploads', 'u1')));
  });

  it('cannot read the audit log', async () => {
    await assertFails(getDoc(doc(student(), 'audit', 'a1')));
  });

  it('can read the risk rules, so the app can show the 75% threshold', async () => {
    await assertSucceeds(getDoc(doc(student(), 'config', 'riskRules')));
  });
});

describe('default deny', () => {
  it('refuses a collection nobody wrote a rule for', async () => {
    // Adding a collection without adding a rule must fail closed.
    for (const db of [faculty(), student(), anonymous()]) {
      await assertFails(getDoc(doc(db, 'somethingNew', 'x')));
      await assertFails(setDoc(doc(db, 'somethingNew', 'x'), { a: 1 }));
    }
  });
});

describe('study plans', () => {
  it('a student can read their own plan', async () => {
    await assertSucceeds(getDoc(doc(student(), 'students', OWN_USN, 'plans', 'p1')));
  });

  it('faculty can read it too, to see whether it is being followed', async () => {
    await assertSucceeds(getDoc(doc(faculty(), 'students', OWN_USN, 'plans', 'p1')));
  });

  it('a student cannot read another student’s plan', async () => {
    await assertFails(getDoc(doc(student(), 'students', OTHER_USN, 'plans', 'p1')));
  });

  it('nobody can write a plan from a client', async () => {
    await assertFails(
      setDoc(doc(student(), 'students', OWN_USN, 'plans', 'p2'), { goal: 'Easier goal' }),
    );
    await assertFails(
      updateDoc(doc(faculty(), 'students', OWN_USN, 'plans', 'p1'), { goal: 'Changed' }),
    );
  });
});

describe('practice activities', () => {
  it('a student can read their own', async () => {
    await assertSucceeds(getDoc(doc(student(), 'students', OWN_USN, 'activities', 'a1')));
  });

  it('a student can record an attempt', async () => {
    await assertSucceeds(
      updateDoc(doc(student(), 'students', OWN_USN, 'activities', 'a1'), {
        status: 'completed',
        score: 3,
        outOf: 5,
        attemptedAt: '2026-03-10T10:00:00.000Z',
      }),
    );
  });

  it('a student cannot rewrite the questions or the answers', async () => {
    const ref = doc(student(), 'students', OWN_USN, 'activities', 'a1');
    await assertFails(updateDoc(ref, { questions: [] }));
    await assertFails(updateDoc(ref, { subject: 'Something easier' }));
    await assertFails(updateDoc(ref, { status: 'completed', score: 5, outOf: 5, title: 'Changed' }));
  });

  it('a student cannot claim a score higher than the total', async () => {
    await assertFails(
      updateDoc(doc(student(), 'students', OWN_USN, 'activities', 'a1'), {
        status: 'completed', score: 99, outOf: 5, attemptedAt: '2026-03-10T10:00:00.000Z',
      }),
    );
  });

  it('a student cannot invent an activity', async () => {
    await assertFails(
      setDoc(doc(student(), 'students', OWN_USN, 'activities', 'invented'), {
        kind: 'quiz', status: 'completed', score: 10, outOf: 10,
      }),
    );
  });

  it('a student cannot touch another student’s activity', async () => {
    await assertFails(
      updateDoc(doc(student(), 'students', OTHER_USN, 'activities', 'a1'), {
        status: 'completed', score: 1, outOf: 5, attemptedAt: '2026-03-10T10:00:00.000Z',
      }),
    );
  });
});
