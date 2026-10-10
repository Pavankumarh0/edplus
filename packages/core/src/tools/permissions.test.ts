import { describe, expect, it } from 'vitest';
import type { Actor } from '../schemas/index';
import { TOOLS, TOOL_NAMES } from './definitions';
import {
  AGENT_TOOLS,
  assertAllowlistsValid,
  canCall,
  definitionsForAgent,
  toolsForActor,
} from './permissions';
import { AGENT_NAMES } from './types';

const faculty: Actor = { kind: 'faculty', id: 'faculty-uid' };
const student: Actor = { kind: 'student', id: 'student-uid' };
const system: Actor = { kind: 'system', id: 'cron' };
const agent = (name: string): Actor => ({ kind: 'agent', id: `agent:${name}`, agentName: name });

describe('the tool registry', () => {
  it('exposes every tool the brief specifies', () => {
    for (const name of [
      'get_student',
      'get_student_history',
      'list_at_risk_students',
      'get_risk_breakdown',
      'save_report',
      'propose_intervention',
      'update_intervention',
      'create_student_tasks',
      'get_call_context',
      'log_call_outcome',
      'schedule_parent_call',
    ]) {
      expect(TOOL_NAMES, name).toContain(name);
    }
  });

  it('exposes the student-scoped tools Planly needs', () => {
    for (const name of [
      'get_my_progress',
      'save_study_plan',
      'create_plan_tasks',
      'create_activity',
      'list_my_activities',
    ]) {
      expect(TOOL_NAMES, name).toContain(name);
    }
  });

  it('gives every tool a model-facing description', () => {
    for (const name of TOOL_NAMES) {
      const tool = TOOLS[name]!;
      expect(tool.description.length, `${name} description`).toBeGreaterThan(60);
      expect(tool.title.length, `${name} title`).toBeGreaterThan(0);
      // The name a model sees must match the key it is registered under.
      expect(tool.name).toBe(name);
    }
  });

  it('marks read-only tools consistently', () => {
    const readOnly = TOOL_NAMES.filter((n) => TOOLS[n]!.readOnly);
    expect(readOnly).toEqual(
      expect.arrayContaining([
        'get_student',
        'get_student_history',
        'list_at_risk_students',
        'get_risk_breakdown',
        'get_call_context',
      ]),
    );
    // Nothing read-only may also be consequential.
    for (const name of readOnly) {
      expect(TOOLS[name]!.consequential, name).toBe(false);
    }
  });

  it('marks exactly the actions that reach outside the system as consequential', () => {
    // Dialling a real phone, booking real time on a real calendar, and taking
    // that booking back again. Everything else stays inside Firestore, so an
    // agent doing it wrongly is recoverable. Adding a name here means a human
    // must press the button; adding one by accident is what this guards.
    const consequential = TOOL_NAMES.filter((n) => TOOLS[n]!.consequential).sort();
    expect(consequential).toEqual([
      'add_connector',
      'approve_student_connector',
      'cancel_meeting',
      'remove_connector',
      'revoke_student_connector',
      'schedule_meeting',
      'schedule_parent_call',
      'set_connector_tool',
    ]);
  });
});

describe('agent allowlists', () => {
  it('are internally valid', () => {
    expect(() => assertAllowlistsValid()).not.toThrow();
  });

  it('never grant a consequential tool to an agent', () => {
    // The guarantee the whole approval model rests on.
    for (const name of AGENT_NAMES) {
      for (const toolName of AGENT_TOOLS[name]) {
        expect(TOOLS[toolName]!.consequential, `${name} → ${toolName}`).toBe(false);
      }
    }
  });

  it('keeps the voice agent to just two tools', () => {
    expect([...AGENT_TOOLS.voice]).toEqual(['get_call_context', 'log_call_outcome']);
  });

  it('stops the voice agent reading marks, history or reports', () => {
    // A parent on a live call cannot talk it into disclosing anything,
    // because the capability is absent rather than discouraged.
    for (const forbidden of [
      'get_student',
      'get_student_history',
      'get_risk_breakdown',
      'save_report',
      'list_at_risk_students',
      'schedule_parent_call',
    ]) {
      expect(canCall(agent('voice'), forbidden), forbidden).toBe(false);
    }
  });

  it('lets the report agent read and write a report but not list the cohort', () => {
    expect(canCall(agent('report'), 'get_student')).toBe(true);
    expect(canCall(agent('report'), 'get_risk_breakdown')).toBe(true);
    expect(canCall(agent('report'), 'save_report')).toBe(true);
    expect(canCall(agent('report'), 'propose_intervention')).toBe(true);
    // It writes one report at a time; it has no business enumerating students.
    expect(canCall(agent('report'), 'list_at_risk_students')).toBe(false);
    expect(canCall(agent('report'), 'log_call_outcome')).toBe(false);
  });

  it('lets the copilot triage and draft, but never dial', () => {
    expect(canCall(agent('copilot'), 'list_at_risk_students')).toBe(true);
    expect(canCall(agent('copilot'), 'propose_intervention')).toBe(true);
    expect(canCall(agent('copilot'), 'create_student_tasks')).toBe(true);
    expect(canCall(agent('copilot'), 'schedule_parent_call')).toBe(false);
  });

  it('refuses an unknown agent everything', () => {
    expect(toolsForActor(agent('rogue'))).toEqual([]);
    expect(canCall(agent('rogue'), 'get_student')).toBe(false);
  });

  it('refuses an agent with no name at all', () => {
    expect(canCall({ kind: 'agent', id: 'x' }, 'get_student')).toBe(false);
  });

  it('returns the matching definitions for prompt building', () => {
    const defs = definitionsForAgent('voice');
    expect(defs.map((d) => d.name)).toEqual(['get_call_context', 'log_call_outcome']);
  });
});

describe('human and system actors', () => {
  it('lets faculty call everything, including the consequential tool', () => {
    for (const name of TOOL_NAMES) {
      expect(canCall(faculty, name), name).toBe(true);
    }
  });

  it('lets background jobs do everything except what needs a human', () => {
    expect(canCall(system, 'get_student')).toBe(true);
    expect(canCall(system, 'save_report')).toBe(true);
    expect(canCall(system, 'schedule_parent_call')).toBe(false);
  });

  it('gives students no tools at all', () => {
    // The student app reads its own data through Firestore rules, not tools.
    expect(toolsForActor(student)).toEqual([]);
    for (const name of TOOL_NAMES) {
      expect(canCall(student, name), name).toBe(false);
    }
  });

  it('rejects a tool that does not exist, for every actor', () => {
    for (const actor of [faculty, student, system, agent('copilot')]) {
      expect(canCall(actor, 'drop_database')).toBe(false);
    }
  });
});

describe('input schemas', () => {
  it('reject an empty payload on every tool that needs a subject', () => {
    // list_at_risk_students and list_meetings are the deliberate exceptions:
    // "who needs attention today?" and "what is on my calendar?" take no
    // arguments and are each tool's primary use.
    // The student-scoped tools take no arguments by design: the student comes
    // from the actor, not from the call.
    const takesNoArgs = new Set([
      'list_at_risk_students',
      'list_connectors',
      'list_meetings',
      'get_my_progress',
      'list_my_activities',
      'list_my_meetings',
    ]);
    for (const name of TOOL_NAMES) {
      if (takesNoArgs.has(name)) continue;
      expect(TOOLS[name]!.inputSchema.safeParse({}).success, name).toBe(false);
    }
  });

  it('let list_at_risk_students be called with no arguments', () => {
    expect(TOOLS.list_at_risk_students!.inputSchema.safeParse({}).success).toBe(true);
  });

  it('normalise the USN so casing and spacing cannot split a student', () => {
    const parsed = TOOLS.get_student!.inputSchema.safeParse({ usn: ' 1ox21is045 ' });
    expect(parsed.success).toBe(true);
    expect((parsed as { data: { usn: string } }).data.usn).toBe('1OX21IS045');
  });

  it('refuse a one-word intervention reason', () => {
    const tool = TOOLS.propose_intervention!;
    expect(
      tool.inputSchema.safeParse({ usn: '1OX21IS045', type: 'mentor_meeting', reason: 'bad' })
        .success,
    ).toBe(false);
    expect(
      tool.inputSchema.safeParse({
        usn: '1OX21IS045',
        type: 'mentor_meeting',
        reason: 'Attendance 38% — below the 90% threshold, and assessment average 14%.',
      }).success,
    ).toBe(true);
  });

  it('refuse an unknown intervention type', () => {
    expect(
      TOOLS.propose_intervention!.inputSchema.safeParse({
        usn: '1OX21IS045',
        type: 'expel_student',
        reason: 'A sufficiently long reason to pass the length check.',
      }).success,
    ).toBe(false);
  });

  it('refuse an illegal parent response', () => {
    expect(
      TOOLS.log_call_outcome!.inputSchema.safeParse({
        callId: 'c1',
        parentResponse: 'promised_to_fix_everything',
        summary: 'Spoke to the parent.',
      }).success,
    ).toBe(false);
  });

  it('cap the number of tasks an agent can create at once', () => {
    const tasks = Array.from({ length: 7 }, (_, i) => ({ title: `Task number ${i}` }));
    expect(
      TOOLS.create_student_tasks!.inputSchema.safeParse({ usn: '1OX21IS045', tasks }).success,
    ).toBe(false);
  });
});

describe('Planly is confined to one student', () => {
  const STUDENT_SCOPED = [
    'get_my_progress',
    'save_study_plan',
    'create_plan_tasks',
    'create_activity',
    'list_my_activities',
    'list_my_meetings',
  ];

  it('never accepts a usn argument', () => {
    // This is the whole guarantee. If a usn could be passed, a prompt could
    // ask for another student's record; because it cannot, the request is
    // inexpressible rather than merely refused.
    for (const name of STUDENT_SCOPED) {
      const parsed = TOOLS[name]!.inputSchema.safeParse({ usn: '1OX21IS001' });
      const data = parsed.success ? (parsed.data as Record<string, unknown>) : {};
      expect(data.usn, name).toBeUndefined();
    }
  });

  it('is exactly the planly allowlist', () => {
    expect([...AGENT_TOOLS.planly].sort()).toEqual([...STUDENT_SCOPED].sort());
  });

  it('cannot reach any faculty tool', () => {
    for (const forbidden of [
      'get_student',
      'get_student_history',
      'list_at_risk_students',
      'get_risk_breakdown',
      'save_report',
      'propose_intervention',
      'update_intervention',
      'create_student_tasks',
      'schedule_parent_call',
      'propose_meeting',
      'list_meetings',
      'schedule_meeting',
      'cancel_meeting',
      'list_connectors',
      'test_connector',
      'add_connector',
      'set_connector_tool',
      'remove_connector',
      'approve_student_connector',
      'revoke_student_connector',
      'get_call_context',
      'log_call_outcome',
    ]) {
      expect(canCall(agent('planly'), forbidden), forbidden).toBe(false);
    }
  });

  it('is not granted to the other agents', () => {
    for (const name of ['report', 'copilot', 'voice'] as const) {
      for (const tool of STUDENT_SCOPED) {
        expect(canCall(agent(name), tool), `${name} -> ${tool}`).toBe(false);
      }
    }
  });

  it('writes a plan but never a report or an intervention', () => {
    expect(canCall(agent('planly'), 'save_study_plan')).toBe(true);
    expect(canCall(agent('planly'), 'save_report')).toBe(false);
    expect(canCall(agent('planly'), 'propose_intervention')).toBe(false);
  });
});
