/**
 * Kills anything still listening on the Firebase emulator ports.
 *
 * On Windows, `firebase emulators:exec` sends SIGINT to the emulator but the
 * Java child process frequently survives, holding port 8080. The next run then
 * fails with "Could not start Firestore Emulator, port taken", which looks like
 * a config problem and is not. This clears it.
 *
 * Only touches processes listening on these specific loopback ports, and only
 * java/node processes — it will not kill an unrelated program that happens to
 * be on 8080.
 */
import { execFileSync } from 'node:child_process';
import { platform } from 'node:os';

const PORTS = [8080, 9099, 4000, 9150, 4400, 4500];
const KILLABLE = /^(java|node|java\.exe|node\.exe)$/i;

function run(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
}

function pidsOnWindows() {
  const found = new Map(); // pid -> ports
  const out = run('netstat', ['-ano']);
  for (const line of out.split(/\r?\n/)) {
    const match = /^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/.exec(line);
    if (!match) continue;
    const port = Number(match[1]);
    const pid = Number(match[2]);
    if (!PORTS.includes(port)) continue;
    if (!found.has(pid)) found.set(pid, new Set());
    found.get(pid).add(port);
  }
  return found;
}

function pidsOnPosix() {
  const found = new Map();
  for (const port of PORTS) {
    const out = run('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN']);
    for (const pid of out.split(/\s+/).filter(Boolean).map(Number)) {
      if (!found.has(pid)) found.set(pid, new Set());
      found.get(pid).add(port);
    }
  }
  return found;
}

function nameOf(pid) {
  if (platform() === 'win32') {
    const out = run('tasklist', ['/FI', `PID eq ${pid}`, '/NH', '/FO', 'CSV']);
    const match = /^"([^"]+)"/.exec(out.trim());
    return match ? match[1] : '';
  }
  return run('ps', ['-p', String(pid), '-o', 'comm=']).trim().split('/').pop() ?? '';
}

function kill(pid) {
  if (platform() === 'win32') run('taskkill', ['/PID', String(pid), '/F', '/T']);
  else run('kill', ['-9', String(pid)]);
}

const found = platform() === 'win32' ? pidsOnWindows() : pidsOnPosix();

if (found.size === 0) {
  console.log('Emulator ports are free.');
} else {
  for (const [pid, ports] of found) {
    const name = nameOf(pid);
    const where = [...ports].sort((a, b) => a - b).join(', ');
    if (!KILLABLE.test(name)) {
      console.warn(`  skipped  pid ${pid} (${name || 'unknown'}) on ${where} — not a java/node process`);
      continue;
    }
    kill(pid);
    console.log(`  killed   pid ${pid} (${name}) on ${where}`);
  }
}
