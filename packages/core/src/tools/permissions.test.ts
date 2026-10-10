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
  it('exposes exactly the tools the brief specifies', () => {
    expect(new Set(TOOL_NAMES)).toEqual(
      new Set([
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
      ]),
    );
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

  it('treats placing a parent call as the one consequential action', () => {
    const consequential = TOOL_NAMES.filter((n) => TOOLS[n]!.consequential);
    expect(consequential).toEqual(['schedule_parent_call']);
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
    // list_at_risk_students is the deliberate exception: "who needs attention
    // today?" takes no arguments and is its primary use.
    const takesNoArgs = new Set(['list_at_risk_students']);
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
