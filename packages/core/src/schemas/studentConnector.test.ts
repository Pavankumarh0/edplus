import { describe, expect, it } from 'vitest';
import {
  ApprovedStudentConnectorSchema,
  STUDENT_CONNECTOR_CATEGORIES,
  StudentConnectionSchema,
  parseStudentToolName,
  studentToolName,
} from './studentConnector';
import { parseRemoteToolName, remoteToolName } from './connector';

describe('student connector categories', () => {
  it('are only notes and calendar', () => {
    // The brief is "notes and calendar, nothing else". Adding a category is a
    // decision, so it should break a test rather than slip in.
    expect([...STUDENT_CONNECTOR_CATEGORIES]).toEqual(['notes', 'calendar']);
  });

  it('refuses any other category outright', () => {
    const base = {
      id: 'x',
      displayName: 'X',
      description: '',
      serverUrl: 'https://x.example.com/mcp',
      dataNote: '',
      approvedBy: 'faculty-1',
      approvedAt: '2026-10-11T00:00:00.000Z',
    };

    expect(ApprovedStudentConnectorSchema.safeParse({ ...base, category: 'notes' }).success).toBe(
      true,
    );
    for (const category of ['email', 'files', 'payments', 'admin', '']) {
      expect(
        ApprovedStudentConnectorSchema.safeParse({ ...base, category }).success,
        category,
      ).toBe(false);
    }
  });
});

describe('a student connection', () => {
  it('has nowhere to put a server URL', () => {
    // This is the control, not a nicety. A connection names an approved entry;
    // the URL lives only on that entry, so revoking it revokes every student's
    // access at once and no stale copy can keep a de-approved server alive.
    const parsed = StudentConnectionSchema.parse({
      id: 'study-notes',
      usn: '1OX21IS045',
      enabledTools: [],
      discoveredTools: [],
      connectedAt: '2026-10-11T00:00:00.000Z',
    });

    expect(Object.keys(parsed)).not.toContain('serverUrl');
    expect(JSON.stringify(parsed)).not.toMatch(/https?:\/\//);
  });

  it('starts with every tool switched off', () => {
    const parsed = StudentConnectionSchema.parse({
      id: 'study-notes',
      usn: '1OX21IS045',
      discoveredTools: [
        { name: 'list_notes', description: 'd', inputSchema: {} },
        { name: 'add_note', description: 'd', inputSchema: {} },
      ],
      connectedAt: '2026-10-11T00:00:00.000Z',
    });

    expect(parsed.enabledTools).toEqual([]);
  });
});

describe('tool namespacing', () => {
  it('keeps a student connector from shadowing one of Planly’s own tools', () => {
    const name = studentToolName('study-notes', 'get_my_progress');
    expect(name).not.toBe('get_my_progress');
    expect(parseStudentToolName(name)).toEqual({
      connectionId: 'study-notes',
      toolName: 'get_my_progress',
    });
  });

  it('keeps institutional and student namespaces apart', () => {
    // A student tool must never resolve through the faculty path, and vice
    // versa — they have different permission checks behind them.
    const student = studentToolName('notes', 'list');
    const institutional = remoteToolName('weather', 'get');

    expect(parseRemoteToolName(student)).toBeNull();
    expect(parseStudentToolName(institutional)).toBeNull();
  });

  it('leaves an ordinary native tool name alone', () => {
    expect(parseStudentToolName('get_my_progress')).toBeNull();
    expect(parseRemoteToolName('get_my_progress')).toBeNull();
  });

  it('round-trips a tool name containing underscores', () => {
    const name = studentToolName('my-notes', 'create_note_with_tags');
    expect(parseStudentToolName(name)).toEqual({
      connectionId: 'my-notes',
      toolName: 'create_note_with_tags',
    });
  });
});
