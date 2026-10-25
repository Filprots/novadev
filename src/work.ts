// `novadev work` — the LOCK of a batch in work: who is working it, since when, where they are, and —
// when the human pauses — exactly where things stopped, so the next session resumes from there
// instead of rediscovering it.
//
//   novadev work start <batch> [--agent <actor>] [--session <id>] [--take]
//                                       take the batch's lock (or resume it: a paused one, or one
//                                       whose holder is gone); answers with the last waypoint
//   novadev work waypoint <batch> <payload.json>
//                                       { todo?, phase?, note } — where the work is now; the
//                                       heartbeat `novadev status` reads
//   novadev work pause <batch> <payload.json>
//                                       { todo?, phase?, stopped, next, done?, resume?, open? } —
//                                       the command half of /novadev-pause: the exhaustive stop
//   novadev work stop <batch> [--take]  release the lock when the round is over
//
// The lock is `todos/<batch>/working.md`: flat frontmatter novadev reads (the state, the holder,
// the timestamps, the todo and phase of the last waypoint) and a markdown body a person reads —
// the trail of waypoints, NEWEST FIRST, so the top section is where the work resumes. It is
// tracked like every file of `.novadev/`: a pause is development history, and a session on
// another machine (or after a crash) finds it where it was left.
//
// While the lock exists the batch is IN WORK: `novadev sync` never marks it complete, the archive
// never takes it, and `novadev file-todo` never files into it. A lock is a gate, like
// `ai_needstest.md`: the round on that batch is not over until the agent releases it.
//
// Payloads are JSON FILES because a note is prose, and quoting that through a shell is how it
// gets mangled (a backtick would run a command). Answers are JSON on stdout; errors are
// `{ "error": … }` with a non-zero exit, so the agent driving the commands reads the outcome.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { dirtyPaths, headSummary } from './git.ts';
import { humanActor } from './knowledge-log.ts';
import {
  BATCH_COMPLETE_FILE,
  BATCH_RE,
  LOOP_PHASES,
  ROOT_DIR_NAME,
  WORK_LOCK_FILE,
  fenceRanges,
  fencedLines,
  isPlainObject,
  listDirs,
  novadevDir,
  readFrontmatter,
  requireProjectRoot,
  todoState,
  type TodoState,
} from './lib.ts';
import { ACTOR_FORMAT, actorKind, isTimestamp, nowTimestamp } from './okf.ts';

export const LOCK_STATES = ['working', 'paused'] as const;
export type LockState = (typeof LOCK_STATES)[number];

/**
 * A `working` lock with no waypoint for this long, whose process novadev cannot see, is presumed
 * abandoned: `novadev work start` takes it over without `--take`, and `novadev status` says so. A
 * session that is really still running only has to write a waypoint to be live again.
 */
export const STALE_AFTER_MINUTES = 120;
/** A waypoint or a pause section longer than this belongs in the todo's own record. */
const MAX_TEXT_CHARS = 20000;
/** How many uncommitted paths a pause lists before saying "and N more". */
const MAX_TREE_PATHS = 30;
/** The actor recorded when nobody said who is working. */
const UNKNOWN_AGENT = 'agent/unknown';

/** One entry of the trail: a waypoint, or the pause record (a waypoint too — the last one). */
export type LockEntry = { kind: 'waypoint' | 'pause'; number: number; heading: string; body: string };

export type WorkLock = {
  batch: string;
  /** Absolute path of working.md. */
  path: string;
  state: LockState;
  agent: string;
  host: string;
  pid: number | null;
  session: string | null;
  /** When the lock was first taken (ISO 8601 with offset). */
  started: string;
  /** The heartbeat: when the lock was last written — a waypoint, a pause, a resume. */
  updated: string;
  /** When it was last resumed from a pause or taken over, if ever. */
  resumed: string | null;
  /** The todo and loop phase of the newest entry. */
  todo: string | null;
  phase: number | null;
  /** Newest first. */
  entries: LockEntry[];
};

export type LockRead =
  | { state: 'ok'; batch: string; path: string; lock: WorkLock }
  | { state: 'invalid'; batch: string; path: string; error: string };

export function lockPath(nd: string, batch: string): string {
  return join(nd, 'todos', batch, WORK_LOCK_FILE);
}

/** Every lock in `todos/`, readable or not, by batch name. */
export function listWorkLocks(nd: string): LockRead[] {
  const out: LockRead[] = [];
  for (const batch of listDirs(join(nd, 'todos'))) {
    const path = lockPath(nd, batch);
    if (existsSync(path)) out.push(readLock(batch, path));
  }
  return out;
}

/** The lock of one batch, or null when the batch carries none. */
export function readWorkLock(nd: string, batch: string): LockRead | null {
  const path = lockPath(nd, batch);
  return existsSync(path) ? readLock(batch, path) : null;
}

function readLock(batch: string, path: string): LockRead {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    return { state: 'invalid', batch, path, error: error instanceof Error ? error.message : String(error) };
  }
  const invalid = (error: string): LockRead => ({ state: 'invalid', batch, path, error });
  if (/^(<<<<<<<|=======|>>>>>>>) /m.test(text)) return invalid('it holds a merge conflict');
  const fm = text.startsWith('---') ? readFrontmatter(path) : null;
  if (fm === null) return invalid('no frontmatter header');
  const state = (fm.state ?? '').trim();
  if (!(LOCK_STATES as readonly string[]).includes(state)) {
    return invalid(`"state" must be ${LOCK_STATES.join(' or ')}, not "${state}"`);
  }
  for (const key of ['started', 'updated'] as const) {
    if (!isTimestamp(fm[key])) return invalid(`"${key}" must be an ISO 8601 datetime with an offset`);
  }
  const resumed = (fm.resumed ?? '').trim();
  if (resumed !== '' && !isTimestamp(resumed)) return invalid('"resumed" must be an ISO 8601 datetime with an offset');
  const pid = fm.pid === undefined || fm.pid.trim() === '' ? null : Number(fm.pid);
  if (pid !== null && !(Number.isInteger(pid) && pid > 0)) return invalid('"pid" must be a whole number');
  const phase = fm.phase === undefined || fm.phase.trim() === '' ? null : Number(fm.phase);
  if (phase !== null && !isPhase(phase)) return invalid(`"phase" must be a loop phase, 0 to ${LOOP_PHASES.length - 1}`);
  const end = text.indexOf('\n---', 3);
  const body = text.slice(end + 4);
  return {
    state: 'ok',
    batch,
    path,
    lock: {
      batch,
      path,
      state: state as LockState,
      agent: (fm.agent ?? '').trim() || UNKNOWN_AGENT,
      host: (fm.host ?? '').trim(),
      pid,
      session: (fm.session ?? '').trim() || null,
      started: fm.started!.trim(),
      updated: fm.updated!.trim(),
      resumed: resumed || null,
      todo: (fm.todo ?? '').trim() || null,
      phase,
      entries: parseEntries(body),
    },
  };
}

function isPhase(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < LOOP_PHASES.length;
}

// ---------------------------------------------------------------------------
// The trail
// ---------------------------------------------------------------------------

/** The heading of an entry: the kind, its number, when (to the minute), then where. */
const ENTRY_RE = /^## (?:Waypoint (\d+)|PAUSED — waypoint (\d+)) — \d{4}-\d{2}-\d{2} \d{2}:\d{2}(?: · .*)?$/;

/** The entries of a lock's body, newest first as the file keeps them. */
export function parseEntries(body: string): LockEntry[] {
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  const fenced = fencedLines(lines);
  const entries: LockEntry[] = [];
  let current: LockEntry | null = null;
  let buffer: string[] = [];
  const flush = () => {
    if (current !== null) {
      current.body = buffer.join('\n').trim();
      entries.push(current);
    }
    buffer = [];
  };
  lines.forEach((line, i) => {
    const m = fenced[i] ? null : ENTRY_RE.exec(line);
    if (m) {
      flush();
      current = { kind: m[1] !== undefined ? 'waypoint' : 'pause', number: Number(m[1] ?? m[2]), heading: line, body: '' };
      return;
    }
    if (current !== null) buffer.push(line);
  });
  flush();
  return entries;
}

function entryHeading(kind: LockEntry['kind'], number: number, at: string, todo: string | null, phase: number | null): string {
  const when = at.slice(0, 16).replace('T', ' ');
  const where = [todo, phase === null ? null : phaseLabel(phase)].filter((part): part is string => part !== null);
  const label = kind === 'pause' ? `PAUSED — waypoint ${number}` : `Waypoint ${number}`;
  return `## ${label} — ${when}${where.length > 0 ? ` · ${where.join(' · ')}` : ''}`;
}

/** `phase 3 WORK`. */
export function phaseLabel(phase: number): string {
  return `phase ${phase} ${LOOP_PHASES[phase] ?? ''}`.trim();
}

/**
 * A note as the trail keeps it: trimmed, a line that would read as an entry heading (or the file's
 * title) escaped, and a code fence that never closes closed — so no note can swallow the entries
 * below it, and the top section stays the one to resume from.
 */
export function sanitizeNote(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').trim().split('\n');
  const fenced = fencedLines(lines);
  const escaped = lines.map((line, i) => (!fenced[i] && /^ {0,3}#{1,2}(\s|$)/.test(line) ? `\\${line.trimStart()}` : line));
  const open = fenceRanges(lines).find((fence) => fence.close === null);
  if (open !== undefined) {
    const fence = /^ {0,3}(`{3,}|~{3,})/.exec(lines[open.open]!)![1]!;
    escaped.push(fence);
  }
  return escaped.join('\n');
}

const LOCK_COMMENT =
  '<!-- The batch\'s LOCK, managed by `novadev work`: an agent is working this batch, or paused in it.\n' +
  '     Newest entry first — the top section is where the work resumes. Never edit it by hand:\n' +
  '     `novadev work waypoint` and `/novadev-pause` write it, `novadev work stop` removes it. -->';

export function renderLock(lock: WorkLock): string {
  const header: string[] = [`state: ${lock.state}`, `agent: ${lock.agent}`, `host: ${lock.host}`];
  if (lock.pid !== null) header.push(`pid: ${lock.pid}`);
  if (lock.session !== null) header.push(`session: ${lock.session}`);
  header.push(`started: ${lock.started}`, `updated: ${lock.updated}`);
  if (lock.resumed !== null) header.push(`resumed: ${lock.resumed}`);
  if (lock.todo !== null) header.push(`todo: ${lock.todo}`);
  if (lock.phase !== null) header.push(`phase: ${lock.phase}`);
  const entries = lock.entries.map((entry) => `${entry.heading}\n\n${entry.body}`);
  return `${[`---\n${header.join('\n')}\n---`, `# Working — ${lock.batch}`, LOCK_COMMENT, ...entries].join('\n\n')}\n`;
}

function writeLock(lock: WorkLock): void {
  writeFileSync(lock.path, renderLock(lock));
}

// ---------------------------------------------------------------------------
// Who holds it, and whether they are still there
// ---------------------------------------------------------------------------

/** This process's caller: the session and the long-lived process the lock may be attributed to. */
export type Holder = { host: string; pid: number | null; session: string | null };

/**
 * The harness a `novadev work` command runs under: its process is the grandparent of this one (the
 * shell between them is gone the moment the command returns), or the one Claude Code names in
 * `CLAUDE_PID`; its session is `CLAUDE_CODE_SESSION_ID`, when Claude Code set it. Another harness
 * passes `--session`. Nothing here is required: a lock without a pid is judged by its heartbeat.
 */
export function currentHolder(env: NodeJS.ProcessEnv = process.env): Holder {
  const fromEnv = Number(env.CLAUDE_PID);
  const pid = Number.isInteger(fromEnv) && fromEnv > 0 ? fromEnv : grandparentPid();
  const session = (env.CLAUDE_CODE_SESSION_ID ?? '').trim() || null;
  return { host: hostname(), pid, session };
}

function grandparentPid(): number | null {
  if (process.platform === 'win32') return null;
  try {
    const run = spawnSync('ps', ['-o', 'ppid=', '-p', String(process.ppid)], { encoding: 'utf8', timeout: 5000, windowsHide: true });
    const pid = Number((run.stdout ?? '').trim());
    return run.status === 0 && Number.isInteger(pid) && pid > 1 ? pid : null;
  } catch {
    return null;
  }
}

/** True when a process with this id exists on this machine (one novadev may not signal counts too). */
export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export type Liveness = {
  /** Is someone still working this batch? */
  live: boolean;
  reason: 'paused' | 'process-alive' | 'process-gone' | 'fresh' | 'stale';
  /** Minutes since the last heartbeat. */
  ageMinutes: number;
};

/**
 * Whether the lock's holder is still at work. A paused lock has no holder. On the holder's own
 * machine the process decides, when the lock names one; elsewhere, the heartbeat: a `working` lock
 * with no waypoint for STALE_AFTER_MINUTES is presumed abandoned.
 */
export function lockLiveness(lock: WorkLock, now: Date = new Date(), holder: Holder = currentHolder()): Liveness {
  const ageMinutes = Math.max(0, Math.floor((now.getTime() - Date.parse(lock.updated)) / 60000));
  if (lock.state === 'paused') return { live: false, reason: 'paused', ageMinutes };
  if (lock.pid !== null && lock.host === holder.host) {
    return processAlive(lock.pid)
      ? { live: true, reason: 'process-alive', ageMinutes }
      : { live: false, reason: 'process-gone', ageMinutes };
  }
  return ageMinutes < STALE_AFTER_MINUTES ? { live: true, reason: 'fresh', ageMinutes } : { live: false, reason: 'stale', ageMinutes };
}

/** True when the lock was taken by the session asking: the same session id, or the same process on the same machine. */
export function sameSession(lock: WorkLock, holder: Holder): boolean {
  if (lock.host !== holder.host) return false;
  if (lock.session !== null && holder.session !== null) return lock.session === holder.session;
  return lock.pid !== null && lock.pid === holder.pid;
}

/** "just now", "12 min ago", "3 h 05 min ago", "2 day(s) ago". */
export function ageText(minutes: number): string {
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 48 * 60) return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min ago`;
  return `${Math.floor(minutes / (24 * 60))} day(s) ago`;
}

/** `2026-10-24 18:40`, from a timestamp. */
export function whenText(at: string): string {
  return at.slice(0, 16).replace('T', ' ');
}

/** `claude-code/claude-opus-5-5 on fil-desktop`, with the process when the lock names one. */
export function holderText(lock: WorkLock, liveness?: Liveness): string {
  const process =
    lock.pid === null
      ? ''
      : liveness?.reason === 'process-alive'
        ? ` (process ${lock.pid}, alive)`
        : liveness?.reason === 'process-gone'
          ? ` (process ${lock.pid}, gone)`
          : ` (process ${lock.pid})`;
  return `${lock.agent} on ${lock.host || '?'}${process}`;
}

/** The first line a reader needs from the newest entry: a waypoint's note, or where a pause stopped. */
export function latestLine(lock: WorkLock): string | null {
  const entry = lock.entries[0];
  if (entry === undefined) return null;
  let lines = entry.body.split('\n');
  if (entry.kind === 'pause') {
    const at = lines.findIndex((line) => /^### Stopped at\s*$/.test(line));
    if (at !== -1) lines = lines.slice(at + 1);
  }
  const line = lines.map((l) => l.trim()).find((l) => l !== '' && !l.startsWith('#') && !l.startsWith('**By:**'));
  if (line === undefined) return null;
  const flat = line.replace(/\s+/g, ' ');
  return flat.length > 120 ? `${flat.slice(0, 117)}…` : flat;
}

/** Where the lock's newest entry is: `02-dark-mode · phase 3 WORK`, or null when it says nothing. */
export function whereText(lock: WorkLock): string | null {
  const parts = [lock.todo, lock.phase === null ? null : phaseLabel(lock.phase)].filter((p): p is string => p !== null);
  return parts.length > 0 ? parts.join(' · ') : null;
}

// ---------------------------------------------------------------------------
// What the other commands say about locks
// ---------------------------------------------------------------------------

export type WorkAudit = {
  /** Unreadable locks — `novadev sync --check` fails on these. */
  problems: string[];
  /** The agent's: an abandoned lock to resume or release. */
  actions: string[];
  /** The human's: a paused batch waits for them to say when. */
  waiting: string[];
  /** Oddities worth a line in `novadev doctor`. */
  notes: string[];
  /** One line per readable lock, for `novadev sync` and `novadev status`. */
  lines: string[];
};

export function auditWork(nd: string, now: Date = new Date(), holder: Holder = currentHolder()): WorkAudit {
  const out: WorkAudit = { problems: [], actions: [], waiting: [], notes: [], lines: [] };
  for (const read of listWorkLocks(nd)) {
    const rel = `todos/${read.batch}/${WORK_LOCK_FILE}`;
    if (read.state === 'invalid') {
      out.problems.push(`${rel}: ${read.error} — fix it, or delete it and \`novadev work start ${read.batch}\` again`);
      continue;
    }
    const lock = read.lock;
    const liveness = lockLiveness(lock, now, holder);
    const batchDir = join(nd, 'todos', read.batch);
    const todos = listDirs(batchDir);
    const where = whereText(lock);
    const line = latestLine(lock);
    const tail = `${where ? ` — at ${where}` : ''}${line ? `: "${line}"` : ''}`;
    const allRecorded = todos.length > 0 && todos.every((todo) => isTerminal(todoState(join(batchDir, todo))));

    if (lock.state === 'paused') {
      out.lines.push(`‖ ${read.batch} — PAUSED ${whenText(lock.updated)} by ${lock.agent}${tail}`);
      out.waiting.push(
        `${read.batch} is PAUSED (${whenText(lock.updated)}${where ? `, at ${where}` : ''}) — \`/novadev-work\` resumes it from ${rel}`,
      );
    } else if (liveness.live) {
      const hint = allRecorded ? ` — every todo is recorded: \`novadev work stop ${read.batch}\` closes the round` : '';
      out.lines.push(`● ${read.batch} — WORKING: ${holderText(lock, liveness)}, last waypoint ${ageText(liveness.ageMinutes)}${tail}${hint}`);
    } else {
      const why = liveness.reason === 'process-gone' ? 'its process is gone' : `no waypoint for ${ageText(liveness.ageMinutes).replace(/ ago$/, '')}`;
      out.lines.push(`✗ ${read.batch} — ABANDONED: ${holderText(lock, liveness)} — ${why}${tail}`);
      out.actions.push(
        `${read.batch} is locked by ${lock.agent} on ${lock.host || '?'}, but ${why} (last waypoint ${whenText(lock.updated)}${where ? `, at ${where}` : ''}) — resume it (\`novadev work start ${read.batch}\` reads its last waypoint) or release it (\`novadev work stop ${read.batch}\`)`,
      );
    }
    if (lock.todo !== null && !todos.includes(lock.todo)) {
      out.notes.push(`${rel}: its last waypoint names todo "${lock.todo}", which is not in the batch`);
    }
    if (existsSync(join(batchDir, BATCH_COMPLETE_FILE))) {
      out.notes.push(`${rel}: the batch also carries ${BATCH_COMPLETE_FILE} — \`novadev sync\` reopens it while the lock exists`);
    }
  }
  return out;
}

function isTerminal(state: TodoState): boolean {
  return state === 'confirmed' || state === 'completed' || state === 'failed';
}

// ---------------------------------------------------------------------------
// The command
// ---------------------------------------------------------------------------

const USAGE =
  'usage: novadev work start <batch> [--agent <actor>] [--session <id>] [--take]\n' +
  '       novadev work waypoint <batch> <payload.json>\n' +
  '       novadev work pause <batch> <payload.json>\n' +
  '       novadev work stop <batch> [--take]';

export function work(args: string[]): void {
  const [command, ...rest] = args;
  const root = requireProjectRoot();
  const nd = novadevDir(root);
  try {
    if (command === 'start') {
      const opts = parseOptions(rest, ['--agent', '--session'], ['--take']);
      console.log(JSON.stringify(startWork(root, nd, requireBatch(nd, opts.positional[0]), opts), null, 2));
      return;
    }
    if (command === 'waypoint' || command === 'pause') {
      const opts = parseOptions(rest, [], []);
      const batch = requireBatch(nd, opts.positional[0]);
      if (opts.positional[1] === undefined) throw new Error(USAGE);
      const payload = readPayload(opts.positional[1]);
      const result = command === 'waypoint' ? addWaypoint(nd, batch, payload) : pauseWork(root, nd, batch, payload);
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    if (command === 'stop') {
      const opts = parseOptions(rest, [], ['--take']);
      console.log(JSON.stringify(stopWork(nd, requireBatch(nd, opts.positional[0]), opts.take), null, 2));
      return;
    }
    console.error(USAGE);
    process.exit(2);
  } catch (error) {
    console.log(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2));
    process.exit(1);
  }
}

type Options = { positional: string[]; agent?: string; session?: string; take: boolean };

function parseOptions(args: string[], valued: string[], flags: string[]): Options {
  const out: Options = { positional: [], take: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (valued.includes(arg)) {
      const value = args[i + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a value.\n${USAGE}`);
      if (arg === '--agent') out.agent = value;
      if (arg === '--session') out.session = value;
      i++;
    } else if (flags.includes(arg)) {
      if (arg === '--take') out.take = true;
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown option "${arg}".\n${USAGE}`);
    } else {
      out.positional.push(arg);
    }
  }
  return out;
}

/** A batch of `todos/`, named like one; the open batches are listed when it is not. */
function requireBatch(nd: string, name: string | undefined): string {
  if (name === undefined || name === '') throw new Error(USAGE);
  const batch = name.replace(/^(\.novadev\/)?todos\//, '').replace(/\/+$/, '');
  if (!BATCH_RE.test(batch)) throw new Error(`"${batch}" is not a batch name (YYYY-MM-DD_N).`);
  if (!existsSync(join(nd, 'todos', batch))) {
    const open = listDirs(join(nd, 'todos'));
    throw new Error(`No batch todos/${batch}.${open.length > 0 ? ` Open batches: ${open.join(', ')}.` : ' There are no open batches.'}`);
  }
  return batch;
}

function readPayload(argument: string): Record<string, unknown> {
  const path = isAbsolute(argument) ? argument : resolve(process.cwd(), argument);
  if (!existsSync(path)) throw new Error(`No payload file at ${path}.`);
  const payload = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  if (!isPlainObject(payload)) throw new Error('The payload must be a JSON object.');
  return payload;
}

/** The actor to record: `human` means the person git knows; anything else must be an OKF actor. */
function resolveAgent(root: string, raw: string | undefined): string {
  if (raw === undefined || raw.trim() === '') return UNKNOWN_AGENT;
  if (raw === 'human') {
    const human = humanActor(root);
    if (human === null) throw new Error('"--agent human" needs git\'s user.name — set it, or write human:<id>.');
    return human;
  }
  if (actorKind(raw) === null) throw new Error(`"--agent" must be an actor — ${ACTOR_FORMAT}.`);
  return raw;
}

/** The todo a payload names, checked against the batch: a typo here would misdirect the next session. */
function resolveTodo(nd: string, batch: string, raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string') throw new Error("'todo' must be the todo's folder name.");
  const todo = raw.trim().replace(/\/+$/, '').replace(new RegExp(`^${batch}/`), '');
  const todos = listDirs(join(nd, 'todos', batch));
  if (!todos.includes(todo)) {
    throw new Error(`Todo "${todo}" is not in batch ${batch}${todos.length > 0 ? ` (its todos: ${todos.join(', ')})` : ' (it has no todo folders)'}.`);
  }
  return todo;
}

function resolvePhase(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const phase = typeof raw === 'string' ? Number(raw.trim()) : raw;
  if (!isPhase(phase)) throw new Error(`'phase' must be a loop phase, 0 to ${LOOP_PHASES.length - 1} (${LOOP_PHASES.map((name, i) => `${i} ${name}`).join(', ')}).`);
  return phase;
}

function requireText(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`The payload needs '${key}'.`);
  return checkLength(key, value);
}

function optionalText(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new Error(`'${key}' must be text.`);
  return value.trim() === '' ? null : checkLength(key, value);
}

function checkLength(key: string, value: string): string {
  if (value.length > MAX_TEXT_CHARS) {
    throw new Error(`'${key}' is over ${MAX_TEXT_CHARS} characters — put the detail in the todo's ai_progress.md and refer to it.`);
  }
  return value;
}

/** `next` is a list of steps, or text that already is one. */
function nextSteps(raw: unknown): string {
  if (typeof raw === 'string') {
    if (raw.trim() === '') throw new Error("The payload needs 'next': the steps to take when the work resumes.");
    return checkLength('next', raw);
  }
  if (!Array.isArray(raw) || raw.length === 0 || !raw.every((step) => typeof step === 'string' && step.trim() !== '')) {
    throw new Error("The payload needs 'next': a list of the steps to take when the work resumes.");
  }
  return checkLength('next', raw.map((step, i) => `${i + 1}. ${(step as string).trim().replace(/\n/g, '\n   ')}`).join('\n'));
}

/** The lock of a batch that must be in work, readable; a paused one only when `allowPaused`. */
function requireLock(nd: string, batch: string, allowPaused = false): WorkLock {
  const read = readWorkLock(nd, batch);
  if (read === null) throw new Error(`Batch ${batch} is not in work — \`novadev work start ${batch}\` first.`);
  if (read.state === 'invalid') throw new Error(`todos/${batch}/${WORK_LOCK_FILE} cannot be read: ${read.error} — fix it, or delete it and start again.`);
  if (read.lock.state === 'paused' && !allowPaused) {
    throw new Error(`Batch ${batch} is paused — \`novadev work start ${batch}\` resumes it first.`);
  }
  return read.lock;
}

/** The lock's todos and their states, for an answer. */
function todoStates(nd: string, batch: string): { todo: string; state: TodoState }[] {
  const batchDir = join(nd, 'todos', batch);
  return listDirs(batchDir).map((todo) => ({ todo, state: todoState(join(batchDir, todo)) }));
}

function latestEntry(lock: WorkLock): { kind: LockEntry['kind']; waypoint: number; heading: string; text: string } | null {
  const entry = lock.entries[0];
  return entry === undefined ? null : { kind: entry.kind, waypoint: entry.number, heading: entry.heading, text: entry.body };
}

function relPath(path: string): string {
  const at = path.indexOf(`/${ROOT_DIR_NAME}/`);
  return at === -1 ? path : path.slice(at + 1);
}

// --- start ---------------------------------------------------------------

export function startWork(root: string, nd: string, batch: string, opts: { agent?: string; session?: string; take: boolean }, now: Date = new Date()): unknown {
  const batchDir = join(nd, 'todos', batch);
  if (existsSync(join(batchDir, BATCH_COMPLETE_FILE))) {
    throw new Error(`Batch ${batch} is finished (${BATCH_COMPLETE_FILE}) — a new request gets a new batch (\`novadev new\`, or \`novadev file-todo\`).`);
  }
  const agent = resolveAgent(root, opts.agent);
  const holder = currentHolder();
  if (opts.session !== undefined && opts.session.trim() !== '') holder.session = opts.session.trim();
  const at = nowTimestamp(now);
  const existing = readWorkLock(nd, batch);

  if (existing === null) {
    const lock: WorkLock = {
      batch,
      path: lockPath(nd, batch),
      state: 'working',
      agent,
      host: holder.host,
      pid: holder.pid,
      session: holder.session,
      started: at,
      updated: at,
      resumed: null,
      todo: null,
      phase: null,
      entries: [],
    };
    writeLock(lock);
    return answer(nd, lock, { taken: true, resumed: false, from: null });
  }
  if (existing.state === 'invalid') {
    throw new Error(`todos/${batch}/${WORK_LOCK_FILE} cannot be read: ${existing.error} — fix it, or delete it and start again.`);
  }

  const lock = existing.lock;
  const liveness = lockLiveness(lock, now, holder);
  const same = lock.state === 'working' && sameSession(lock, holder);
  let from: 'paused' | 'same-session' | 'process-gone' | 'stale' | 'taken';
  if (lock.state === 'paused') from = 'paused';
  else if (same) from = 'same-session';
  else if (!liveness.live) from = liveness.reason === 'process-gone' ? 'process-gone' : 'stale';
  else if (opts.take) from = 'taken';
  else {
    throw new Error(
      `Batch ${batch} is in work: ${holderText(lock, liveness)}, last waypoint ${ageText(liveness.ageMinutes)}` +
        `${whereText(lock) ? `, at ${whereText(lock)}` : ''}. If that session is gone, pass --take to take the lock over.`,
    );
  }
  const previous = { state: lock.state, agent: lock.agent, host: lock.host, pid: lock.pid, session: lock.session, updated: lock.updated };
  lock.state = 'working';
  lock.agent = agent;
  lock.host = holder.host;
  lock.pid = holder.pid;
  lock.session = holder.session;
  lock.updated = at;
  if (from !== 'same-session') lock.resumed = at;
  writeLock(lock);
  return answer(nd, lock, { taken: true, resumed: from !== 'same-session', from, previous });
}

function answer(nd: string, lock: WorkLock, extra: Record<string, unknown>): unknown {
  return {
    batch: lock.batch,
    path: relPath(lock.path),
    state: lock.state,
    ...extra,
    agent: lock.agent,
    started: lock.started,
    todo: lock.todo,
    phase: lock.phase,
    latest: latestEntry(lock),
    todos: todoStates(nd, lock.batch),
  };
}

// --- waypoint ------------------------------------------------------------

export function addWaypoint(nd: string, batch: string, payload: Record<string, unknown>, now: Date = new Date()): unknown {
  const lock = requireLock(nd, batch);
  const todo = resolveTodo(nd, batch, payload['todo']) ?? lock.todo;
  const phase = resolvePhase(payload['phase']) ?? lock.phase;
  const note = sanitizeNote(requireText(payload, 'note'));
  const at = nowTimestamp(now);
  const number = nextNumber(lock);
  lock.entries.unshift({ kind: 'waypoint', number, heading: entryHeading('waypoint', number, at, todo, phase), body: note });
  lock.todo = todo;
  lock.phase = phase;
  lock.updated = at;
  writeLock(lock);
  return { batch, path: relPath(lock.path), state: lock.state, waypoint: number, todo, phase, updated: at };
}

function nextNumber(lock: WorkLock): number {
  return Math.max(0, ...lock.entries.map((entry) => entry.number)) + 1;
}

// --- pause ---------------------------------------------------------------

export function pauseWork(root: string, nd: string, batch: string, payload: Record<string, unknown>, now: Date = new Date()): unknown {
  const lock = requireLock(nd, batch, true);
  const todo = resolveTodo(nd, batch, payload['todo']) ?? lock.todo;
  const phase = resolvePhase(payload['phase']) ?? lock.phase;
  const stopped = sanitizeNote(requireText(payload, 'stopped'));
  const next = sanitizeNote(nextSteps(payload['next']));
  const done = optionalText(payload, 'done');
  const resume = optionalText(payload, 'resume');
  const open = optionalText(payload, 'open');
  const at = nowTimestamp(now);
  const tree = treeState(root);
  const todos = todoStates(nd, batch);

  const head = [`**By:** ${lock.agent} on ${lock.host || '?'}`];
  if (tree !== null) {
    const where = [tree.branch ? `branch \`${tree.branch}\`` : null, tree.head ? `HEAD \`${tree.head}\`` : null].filter(Boolean).join(', ');
    if (tree.paths === null) head.push(`**Tree at the pause:** ${where || 'a git repository'} — uncommitted changes unknown`);
    else if (tree.paths.length === 0) head.push(`**Tree at the pause:** ${where || 'a git repository'} — clean, nothing uncommitted`);
    else {
      const shown = tree.paths.slice(0, MAX_TREE_PATHS).map((line) => `- \`${line.slice(0, 2).trim() || '?'}\` ${line.slice(3)}`);
      if (tree.paths.length > MAX_TREE_PATHS) shown.push(`- … and ${tree.paths.length - MAX_TREE_PATHS} more`);
      head.push(`**Tree at the pause:** ${where || 'a git repository'} — ${tree.paths.length} uncommitted path(s):\n${shown.join('\n')}`);
    }
  }
  const sections = [
    head.join('\n\n'),
    `### Stopped at\n\n${stopped}`,
    `### Next\n\n${next}`,
    done === null ? null : `### Done\n\n${sanitizeNote(done)}`,
    resume === null ? null : `### To resume\n\n${sanitizeNote(resume)}`,
    open === null ? null : `### Open\n\n${sanitizeNote(open)}`,
    `### Todos at the pause\n\n${todos.length > 0 ? todos.map((t) => `- ${STATE_MARK[t.state]} ${t.todo} — ${t.state}`).join('\n') : '(no todo folders)'}`,
  ].filter((section): section is string => section !== null);

  const number = nextNumber(lock);
  lock.entries.unshift({ kind: 'pause', number, heading: entryHeading('pause', number, at, todo, phase), body: sections.join('\n\n') });
  lock.state = 'paused';
  lock.todo = todo;
  lock.phase = phase;
  lock.updated = at;
  writeLock(lock);
  return {
    batch,
    path: relPath(lock.path),
    state: 'paused',
    waypoint: number,
    todo,
    phase,
    pausedAt: at,
    ...(tree === null ? {} : { tree: { branch: tree.branch, head: tree.head, uncommitted: tree.paths === null ? null : tree.paths.length } }),
    todos,
  };
}

const STATE_MARK: Record<TodoState, string> = {
  confirmed: '✓✓',
  completed: '✓',
  needstest: '⧗',
  failed: '✗',
  progress: '…',
  open: '·',
};

type TreeState = { branch: string | null; head: string | null; paths: string[] | null };

/** The working tree as git sees it now — null outside a repository. */
function treeState(root: string): TreeState | null {
  const summary = headSummary(root);
  if (summary === null) return null;
  return { branch: summary.branch, head: summary.head, paths: dirtyPaths(root) };
}

// --- stop ----------------------------------------------------------------

export function stopWork(nd: string, batch: string, take: boolean, now: Date = new Date()): unknown {
  const read = readWorkLock(nd, batch);
  if (read === null) throw new Error(`Batch ${batch} is not in work — there is no lock to release.`);
  if (read.state === 'invalid') {
    // An unreadable lock is still a lock: releasing it is what the person asked for.
    rmSync(read.path, { force: true });
    return { batch, state: 'released', path: relPath(read.path), unreadable: read.error, todos: todoStates(nd, batch) };
  }
  const lock = read.lock;
  const holder = currentHolder();
  const liveness = lockLiveness(lock, now, holder);
  if (lock.state === 'working' && liveness.live && !sameSession(lock, holder) && !take) {
    throw new Error(
      `Batch ${batch} is in work: ${holderText(lock, liveness)}, last waypoint ${ageText(liveness.ageMinutes)}. If that session is gone, pass --take to release the lock anyway.`,
    );
  }
  rmSync(lock.path, { force: true });
  const todos = todoStates(nd, batch);
  const unfinished = todos.filter((t) => !isTerminal(t.state)).map((t) => t.todo);
  return {
    batch,
    state: 'released',
    path: relPath(lock.path),
    wasPaused: lock.state === 'paused',
    waypoints: lock.entries.length,
    ...(unfinished.length > 0 ? { unfinished, note: 'these todos are not recorded as finished — a pause keeps the resume point; a stop does not' } : {}),
    todos,
  };
}
