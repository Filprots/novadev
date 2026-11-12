// `novadev work` — the LOCK of work in progress: who is working a todo, since when, where they are,
// and — when the human pauses — exactly where things stopped, so the next session resumes from
// there instead of rediscovering it.
//
//   novadev work start <batch>/<todo> [--agent <actor>] [--session <id>] [--take]
//                                       take the todo's lock (or resume it: a paused one, or one
//                                       whose holder is gone); answers with the last waypoint. The
//                                       todo is named as `novadev todo` names one: its folder,
//                                       `<batch>/<nn>`, or a word only one open todo has
//   novadev work start <batch> [--todo <nn|slug>]…
//                                       with --todo: the same todo locks, as 0.17.0 spelled them;
//                                       without: ONE developer takes the WHOLE batch, as one round
//   novadev work waypoint <ref> <payload.json>
//                                       { todo?, phase?, note } — where the work is now; the
//                                       heartbeat `novadev status` reads
//   novadev work pause <ref> <payload.json>
//                                       { todo?, phase?, stopped, next, done?, resume?, open? } —
//                                       the command half of /novadev-pause: the exhaustive stop
//   novadev work stop <ref> [--take]    release the lock when the work on it is over
//   novadev work claim <ref> <path>… [--allow-overlap]
//                                       add paths the lock owns (start takes --claim too)
//
// THE UNIT OF WORK IS THE TODO. A todo's lock is `todos/<batch>/<todo>/working.md`: flat frontmatter
// novadev reads (the state, the holder, the timestamps, the phase of the last waypoint) and a
// markdown body a person reads — the trail of waypoints, NEWEST FIRST, so the top section is where
// the work resumes. It is tracked like every file of `.novadev/`: a pause is development history,
// and a session on another machine (or after a crash) finds it where it was left. The file lives
// WITH THE TODO, so two developers on two todos of one batch never write the same path, on any
// branch — their branches merge without meeting. A batch only groups todos: it is IN WORK while
// any todo of it is locked.
//
// The whole batch: `work start <batch>` with no todo named is one developer taking all of it. That
// lock is ONE file at the batch's root, `todos/<batch>/working.md` — one round, one trail, one
// pause record: a solo round moves from todo to todo, and its waypoints tell one story that N
// per-todo files would cut into pieces. It is also exactly the file every novadev up to 0.17.0
// wrote, so a lock taken by an older version IS such a lock, and nothing needs migrating. It holds
// every todo of the batch: it and a todo's lock (in any worktree) never coexist.
//
// 0.17.0 locked PART of a batch with one batch-root lock that carried a `covers:` line. Those locks
// are still read, resumed, paused, claimed for and stopped as they were; novadev makes no new ones
// (`--todo` now takes a lock per todo). A todo such a lock covers is resumed through it.
//
// <ref> on waypoint, pause, stop and claim: a todo means the lock that holds it in this worktree —
// its own, or the batch-root lock that covers it; a batch means the lock(s) this worktree carries
// in that batch (the batch's own, or its todos'), so a session that started one todo may go on
// naming the batch. With several locks there, a waypoint and a claim need the todo; a pause writes
// its record into every lock still working; a stop releases them all.
//
// Every command also mirrors the lock into the registry in the common git folder (registry.ts), so
// a worktree on another branch sees that the todo (or the batch) is in work, where, and which
// paths it claims: `work start` refuses a todo in work in another worktree, a batch any todo of
// which is, and a lock whose claims overlap the claims of one. The lock's `claims:` line holds the
// same paths.
//
// Claims: a todo's lock claims the `touches:` of the features ITS files name, plus `--claim`; a
// lock on the whole batch, those of every todo. Inside a worktree `novadev worktree create` made,
// a lock claims that worktree's paths plus `--claim`, never its features' folders (the worktree's
// claims were checked when they were given), and the paths `--claim` / `work claim` add there are
// added to the worktree's claims too, so `novadev worktree gate` accepts the files under them. The
// todos started in such a worktree are recorded as the worktree's (its merge request names them).
//
// A claim is checked against the other worktrees once, when it is added (`--claim`, `work claim`,
// a feature's folder taken for the first time); resuming a lock does not re-judge the claims it
// already holds, so `work claim` and `work start` agree.
//
// While a lock exists its batch is IN WORK: `novadev sync` never marks it complete, the archive
// never takes it, and `novadev file-todo` never files into it. A lock is a gate, like
// `ai_needstest.md`: the work on that todo is not over until the agent releases it.
//
// Payloads are JSON FILES because a note is prose, and quoting that through a shell is how it
// gets mangled (a backtick would run a command). Answers are JSON on stdout; errors are
// `{ "error": … }` with a non-zero exit, so the agent driving the commands reads the outcome.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { dirtyPaths, headSummary } from './git.ts';
import { humanActor } from './knowledge-log.ts';
import { claimPolicy, judgeOverlaps, refusalHint } from './claim-policy.ts';
import {
  type ElsewhereLock,
  type RegistryWorktree,
  addWorktreeClaims,
  addWorktreeTodos,
  batchClaims,
  claimHolders,
  claimOverlaps,
  coversOverlap,
  lockRef,
  locksElsewhere,
  normalizeClaim,
  overlapText,
  pruneGone,
  removeRegistryEntry,
  removeRegistryLock,
  worktreeAt,
  writeRegistryLock,
} from './registry.ts';
import { resolveTodo as resolveOpenTodo } from './todo.ts';
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
import { refuseWaitingTodos } from './todo-links.ts';
import { todoPriority } from './todo-meta.ts';
import { wipHolders, wipSettings, wipSlot } from './wip.ts';

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
  /**
   * What it locks: `todo` — one todo, the file in that todo's folder; `batch` — the file at the
   * batch's root: the whole batch, or (a lock 0.17.0 wrote) the todos its `covers:` line names.
   */
  unit: 'batch' | 'todo';
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
  /** The todo and loop phase of the newest entry (a todo's lock: always its own todo). */
  todo: string | null;
  phase: number | null;
  /** The paths the lock owns while it is in work, project-relative (registry.ts, "Claims"). */
  claims: string[];
  /** The todos it holds: the one todo of a todo's lock; for a batch's, null — all of them — or the 0.17.0 list. */
  covers: string[] | null;
  /** Newest first. */
  entries: LockEntry[];
};

/** One lock file as read: `todo` is the todo whose folder holds it, null for the batch-root one. */
export type LockRead =
  | { state: 'ok'; batch: string; todo: string | null; path: string; lock: WorkLock }
  | { state: 'invalid'; batch: string; todo: string | null; path: string; error: string };

/** The lock file of a todo, or (no todo) the one at the batch's root. */
export function lockPath(nd: string, batch: string, todo: string | null = null): string {
  return todo === null ? join(nd, 'todos', batch, WORK_LOCK_FILE) : join(nd, 'todos', batch, todo, WORK_LOCK_FILE);
}

/** `todos/<batch>/<todo>/working.md`, as messages name a lock file. */
function lockRel(batch: string, todo: string | null): string {
  return todo === null ? `todos/${batch}/${WORK_LOCK_FILE}` : `todos/${batch}/${todo}/${WORK_LOCK_FILE}`;
}

/** `<batch>/<todo>`, or the batch: how a command names what a lock file is on. */
function readRef(read: { batch: string; todo: string | null }): string {
  return read.todo === null ? read.batch : `${read.batch}/${read.todo}`;
}

/** `Todo 2026-11-12_2/02-dark-mode`, or `Batch 2026-11-12_2`: the subject of a message about a lock. */
function subject(lock: { batch: string; unit: 'batch' | 'todo'; covers: readonly string[] | null }): string {
  return lock.unit === 'todo' ? `Todo ${lockRef(lock)}` : `Batch ${lock.batch}`;
}

/** The locks this worktree carries in one batch, readable or not: the batch-root one first, then its todos'. */
export function batchWorkLocks(nd: string, batch: string): LockRead[] {
  const out: LockRead[] = [];
  const root = lockPath(nd, batch);
  if (existsSync(root)) out.push(readLock(batch, null, root));
  for (const todo of listDirs(join(nd, 'todos', batch))) {
    const path = lockPath(nd, batch, todo);
    if (existsSync(path)) out.push(readLock(batch, todo, path));
  }
  return out;
}

/** Every lock in `todos/`, readable or not: per batch, the batch-root one, then its todos'. */
export function listWorkLocks(nd: string): LockRead[] {
  return listDirs(join(nd, 'todos')).flatMap((batch) => batchWorkLocks(nd, batch));
}

/** The lock of one todo — or, with no todo, the batch-root lock — or null when there is none. */
export function readWorkLock(nd: string, batch: string, todo: string | null = null): LockRead | null {
  const path = lockPath(nd, batch, todo);
  return existsSync(path) ? readLock(batch, todo, path) : null;
}

/**
 * The lock in this worktree that holds a todo: its own, else the batch-root lock when that covers
 * it (the whole batch, or a 0.17.0 `covers:` list naming it). A batch-root lock nobody can read is
 * returned too: it may hold the todo. Null when nothing here holds it.
 */
export function lockHolding(nd: string, batch: string, todo: string): LockRead | null {
  const own = readWorkLock(nd, batch, todo);
  if (own !== null) return own;
  const root = readWorkLock(nd, batch);
  if (root === null || root.state === 'invalid') return root;
  return root.lock.covers === null || root.lock.covers.includes(todo) ? root : null;
}

function readLock(batch: string, todo: string | null, path: string): LockRead {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    return { state: 'invalid', batch, todo, path, error: error instanceof Error ? error.message : String(error) };
  }
  const invalid = (error: string): LockRead => ({ state: 'invalid', batch, todo, path, error });
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
  // Where the file is says what it locks: in a todo's folder, that todo and nothing else.
  const covers = fm.covers === undefined || fm.covers.trim() === '' ? null : fm.covers.split(',').map((t) => t.trim()).filter(Boolean);
  return {
    state: 'ok',
    batch,
    todo,
    path,
    lock: {
      batch,
      unit: todo === null ? 'batch' : 'todo',
      path,
      state: state as LockState,
      agent: (fm.agent ?? '').trim() || UNKNOWN_AGENT,
      host: (fm.host ?? '').trim(),
      pid,
      session: (fm.session ?? '').trim() || null,
      started: fm.started!.trim(),
      updated: fm.updated!.trim(),
      resumed: resumed || null,
      todo: todo ?? ((fm.todo ?? '').trim() || null),
      phase,
      claims: (fm.claims ?? '').split(',').map((claim) => claim.trim()).filter(Boolean),
      covers: todo === null ? covers : [todo],
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
const TODO_LOCK_COMMENT =
  '<!-- This todo\'s LOCK, managed by `novadev work`: an agent is working this todo, or paused in it.\n' +
  '     Newest entry first — the top section is where the work resumes. Never edit it by hand:\n' +
  '     `novadev work waypoint` and `/novadev-pause` write it, `novadev work stop` removes it. -->';

/**
 * The lock as its file holds it. A batch-root lock is written exactly as 0.17.0 wrote it; a todo's
 * lock has the same header without `covers:` (its folder says which todo it is).
 */
export function renderLock(lock: WorkLock): string {
  const ofTodo = lock.unit === 'todo';
  const header: string[] = [`state: ${lock.state}`, `agent: ${lock.agent}`, `host: ${lock.host}`];
  if (lock.pid !== null) header.push(`pid: ${lock.pid}`);
  if (lock.session !== null) header.push(`session: ${lock.session}`);
  header.push(`started: ${lock.started}`, `updated: ${lock.updated}`);
  if (lock.resumed !== null) header.push(`resumed: ${lock.resumed}`);
  if (lock.todo !== null) header.push(`todo: ${lock.todo}`);
  if (lock.phase !== null) header.push(`phase: ${lock.phase}`);
  if ((lock.claims ?? []).length > 0) header.push(`claims: ${lock.claims.join(', ')}`);
  if (!ofTodo && (lock.covers ?? null) !== null) header.push(`covers: ${lock.covers!.join(', ')}`);
  const entries = lock.entries.map((entry) => `${entry.heading}\n\n${entry.body}`);
  const title = ofTodo ? `# Working — ${lockRef(lock)}` : `# Working — ${lock.batch}`;
  return `${[`---\n${header.join('\n')}\n---`, title, ofTodo ? TODO_LOCK_COMMENT : LOCK_COMMENT, ...entries].join('\n\n')}\n`;
}

function writeLock(lock: WorkLock): void {
  writeFileSync(lock.path, renderLock(lock));
  mirror(lock);
}

/** The project root of a lock: working.md sits at <root>/.novadev/todos/<batch>/, a todo's one folder deeper. */
function rootOf(lock: WorkLock): string {
  const batchDir = lock.unit === 'todo' ? dirname(dirname(lock.path)) : dirname(lock.path);
  return dirname(dirname(dirname(batchDir)));
}

/** Copy the lock into the registry every worktree reads (nothing outside git). */
function mirror(lock: WorkLock): void {
  const root = rootOf(lock);
  writeRegistryLock(root, {
    batch: lock.batch,
    unit: lock.unit ?? 'batch',
    worktree: root,
    branch: headSummary(root)?.branch ?? null,
    state: lock.state,
    agent: lock.agent,
    host: lock.host,
    pid: lock.pid,
    session: lock.session,
    started: lock.started,
    updated: lock.updated,
    todo: lock.todo,
    phase: lock.phase,
    claims: lock.claims,
    covers: lock.covers ?? null,
    note: latestLine(lock),
  });
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

/**
 * Where the lock's newest entry is: `02-dark-mode · phase 3 WORK` for a batch's lock, the phase
 * alone for a todo's (its name already says the todo), or null when it says nothing.
 */
export function whereText(lock: Pick<WorkLock, 'unit' | 'todo' | 'phase'>): string | null {
  const parts = [lock.unit === 'todo' ? null : lock.todo, lock.phase === null ? null : phaseLabel(lock.phase)].filter((p): p is string => p !== null);
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
  /** How many of the locks listed (lines and problems) are a todo's own; the others are a batch's. */
  todoLocks: number;
};

export function auditWork(nd: string, now: Date = new Date(), holder: Holder = currentHolder()): WorkAudit {
  const out: WorkAudit = { problems: [], actions: [], waiting: [], notes: [], lines: [], todoLocks: 0 };
  for (const read of listWorkLocks(nd)) {
    const rel = lockRel(read.batch, read.todo);
    const ref = readRef(read);
    if (read.todo !== null) out.todoLocks += 1;
    if (read.state === 'invalid') {
      out.problems.push(`${rel}: ${read.error} — fix it, or delete it and \`novadev work start ${ref}\` again`);
      continue;
    }
    const lock = read.lock;
    const liveness = lockLiveness(lock, now, holder);
    const batchDir = join(nd, 'todos', read.batch);
    const todos = listDirs(batchDir);
    const where = whereText(lock);
    const line = latestLine(lock);
    const tail = `${where ? ` — at ${where}` : ''}${line ? `: "${line}"` : ''}`;
    // A lock is judged on the todos it holds: its own, all of the batch, or the ones a 0.17.0 lock covers.
    const mine = lock.covers === null ? todos : todos.filter((todo) => lock.covers!.includes(todo));
    const allRecorded = mine.length > 0 && mine.every((todo) => isTerminal(todoState(join(batchDir, todo))));
    const part = lock.unit === 'todo' || lock.covers === null ? '' : ` (todos ${lock.covers.join(', ')})`;
    const name = `${ref}${part}`;

    if (lock.state === 'paused') {
      out.lines.push(`‖ ${name} — PAUSED ${whenText(lock.updated)} by ${lock.agent}${tail}`);
      out.waiting.push(
        `${ref} is PAUSED (${whenText(lock.updated)}${where ? `, at ${where}` : ''}) — \`/novadev-work\` resumes it from ${rel}`,
      );
    } else if (liveness.live) {
      const hint = !allRecorded
        ? ''
        : lock.unit === 'todo'
          ? ` — it is recorded: \`novadev work stop ${ref}\` releases it`
          : ` — every todo ${lock.covers === null ? '' : 'it covers '}is recorded: \`novadev work stop ${read.batch}\` closes the round`;
      out.lines.push(`● ${name} — WORKING: ${holderText(lock, liveness)}, last waypoint ${ageText(liveness.ageMinutes)}${tail}${hint}`);
    } else {
      const why = liveness.reason === 'process-gone' ? 'its process is gone' : `no waypoint for ${ageText(liveness.ageMinutes).replace(/ ago$/, '')}`;
      out.lines.push(`✗ ${name} — ABANDONED: ${holderText(lock, liveness)} — ${why}${tail}`);
      out.actions.push(
        `${ref} is locked by ${lock.agent} on ${lock.host || '?'}, but ${why} (last waypoint ${whenText(lock.updated)}${where ? `, at ${where}` : ''}) — resume it (\`novadev work start ${ref}\` reads its last waypoint) or release it (\`novadev work stop ${ref}\`)`,
      );
    }
    if (lock.unit === 'batch' && lock.todo !== null && !todos.includes(lock.todo)) {
      out.notes.push(`${rel}: its last waypoint names todo "${lock.todo}", which is not in the batch`);
    }
    for (const todo of lock.unit === 'batch' ? (lock.covers ?? []).filter((t) => !todos.includes(t)) : []) {
      out.notes.push(`${rel}: it covers todo "${todo}", which is not in the batch`);
    }
    if (read.todo !== null) {
      // A merge can bring a todo's lock into a checkout whose batch-root lock already holds that todo.
      const root = readWorkLock(nd, read.batch);
      if (root?.state === 'ok' && (root.lock.covers === null || root.lock.covers.includes(read.todo))) {
        out.notes.push(`${rel}: todo "${read.todo}" is also held by the batch's lock (${lockRel(read.batch, null)}) — one todo, one lock: release one of them (\`novadev work stop ${ref}\`, or \`novadev work stop ${read.batch}\`)`);
      }
    }
    if (existsSync(join(batchDir, BATCH_COMPLETE_FILE)) && batchWorkLocks(nd, read.batch)[0]?.path === read.path) {
      out.notes.push(`${rel}: the batch also carries ${BATCH_COMPLETE_FILE} — \`novadev sync\` reopens it while the lock exists`);
    }
  }
  // Work in the repository's OTHER worktrees (registry.ts): information only — the session there
  // owns it; its own sync lists what it has to do.
  for (const there of locksElsewhere(dirname(nd))) {
    if (there.gone) continue;
    if (there.unit === 'todo') out.todoLocks += 1;
    const liveness = lockLiveness(asWorkLock(there), now, holder);
    const state = there.state === 'paused' ? 'PAUSED' : liveness.live ? 'WORKING' : 'ABANDONED';
    const where = whereText(there) ?? '';
    const claims = there.claims.length > 0 ? `; claims ${there.claims.join(', ')}` : '';
    const part = there.unit === 'todo' || there.covers === null ? '' : ` (todos ${there.covers.join(', ')})`;
    out.lines.push(
      `◦ ${lockRef(there)}${part} — ${state} in another worktree: ${there.worktree}${there.branch ? ` (branch ${there.branch})` : ''} — ${there.agent}, last waypoint ${ageText(liveness.ageMinutes)}${where ? `, at ${where}` : ''}${there.note ? `: "${there.note}"` : ''}${claims}`,
    );
  }
  return out;
}

/** Who holds a todo, for `novadev status` and `novadev todo list`: one lock, here or in another worktree. */
export type TodoHolder = {
  /** The lock that holds it: `<batch>/<todo>` for the todo's own lock, the batch for a batch's. */
  lock: string;
  unit: 'batch' | 'todo';
  state: LockState;
  /** Is its session still there? A paused lock has none. */
  live: boolean;
  liveness: Liveness['reason'];
  agent: string;
  host: string;
  /** Where the lock is: null — this worktree; else the root of the other worktree. */
  worktree: string | null;
  branch: string | null;
  started: string;
  updated: string;
  /** The loop phase and the first line of the newest waypoint or pause, when that entry is about this todo. */
  phase: number | null;
  latest: string | null;
};

/**
 * Who holds each todo of the open batches, by `<batch>/<todo>`; a todo nobody holds is absent. A
 * lock on a batch holds every todo of it (or the ones a 0.17.0 lock covers). The registry's entry
 * of another worktree wins over a lock file here: it means the work lives there, and the file here
 * came with a merge, or was taken over.
 */
export function todoHolders(nd: string, now: Date = new Date(), holder: Holder = currentHolder()): Map<string, TodoHolder> {
  const out = new Map<string, TodoHolder>();
  const todosOf = (batch: string, covers: readonly string[] | null) => covers ?? listDirs(join(nd, 'todos', batch));
  const about = (lock: Pick<WorkLock, 'unit' | 'todo'>, todo: string) => lock.unit === 'todo' || lock.todo === null || lock.todo === todo;
  // A todo's own lock outranks a batch's lock that covers it: batches first, todos over them.
  const byUnit = <T extends { unit: 'batch' | 'todo' }>(locks: T[]) => [...locks.filter((l) => l.unit === 'batch'), ...locks.filter((l) => l.unit === 'todo')];
  const here = listWorkLocks(nd).flatMap((read) => (read.state === 'ok' ? [read.lock] : []));
  for (const lock of byUnit(here)) {
    const liveness = lockLiveness(lock, now, holder);
    for (const todo of todosOf(lock.batch, lock.covers)) {
      const mine = about(lock, todo);
      out.set(`${lock.batch}/${todo}`, {
        lock: lockRef(lock), unit: lock.unit, state: lock.state, live: liveness.live, liveness: liveness.reason, agent: lock.agent, host: lock.host,
        worktree: null, branch: null, started: lock.started, updated: lock.updated, phase: mine ? lock.phase : null, latest: mine ? latestLine(lock) : null,
      });
    }
  }
  for (const there of byUnit(locksElsewhere(dirname(nd)).filter((lock) => !lock.gone))) {
    const liveness = lockLiveness(asWorkLock(there), now, holder);
    for (const todo of todosOf(there.batch, there.covers)) {
      const mine = about(there, todo);
      out.set(`${there.batch}/${todo}`, {
        lock: lockRef(there), unit: there.unit, state: there.state, live: liveness.live, liveness: liveness.reason, agent: there.agent, host: there.host,
        worktree: there.worktree, branch: there.branch, started: there.started, updated: there.updated, phase: mine ? there.phase : null, latest: mine ? (there.note ?? null) : null,
      });
    }
  }
  return out;
}

/**
 * What a todo's line says about its holder, in `novadev status` and `novadev todo list`:
 * ` — in work: claude-code/x, phase 3 WORK`, ` — paused 2026-11-12 10:00 by … in /wt/a (branch a)`,
 * ` — abandoned: …`; nothing when nobody holds it.
 */
export function holderNote(h: TodoHolder | undefined): string {
  if (h === undefined) return '';
  const state = h.state === 'paused' ? `paused ${whenText(h.updated)} by` : h.live ? 'in work:' : 'abandoned:';
  const where = h.worktree === null ? '' : ` in ${h.worktree}${h.branch ? ` (branch ${h.branch})` : ''}`;
  const phase = h.phase === null ? '' : `, ${phaseLabel(h.phase)}`;
  return ` — ${state} ${h.agent}${where}${phase}${h.unit === 'batch' ? ` (the lock on ${h.lock})` : ''}`;
}

function isTerminal(state: TodoState): boolean {
  return state === 'confirmed' || state === 'completed' || state === 'failed';
}

// ---------------------------------------------------------------------------
// The command
// ---------------------------------------------------------------------------

const USAGE =
  'usage: novadev work start <batch>/<todo> [--agent <actor>] [--session <id>] [--take] [--claim <path>]… [--allow-overlap]\n' +
  '       novadev work start <batch> [--todo <nn|slug>]… [the same options]   (no --todo: the whole batch)\n' +
  '       novadev work waypoint <batch>[/<todo>] <payload.json>\n' +
  '       novadev work pause <batch>[/<todo>] <payload.json>\n' +
  '       novadev work stop <batch>[/<todo>] [--take]\n' +
  '       novadev work claim <batch>[/<todo>] <path>… [--allow-overlap]';

export function work(args: string[]): void {
  const [command, ...rest] = args;
  const root = requireProjectRoot();
  const nd = novadevDir(root);
  try {
    if (command === 'start') {
      const opts = parseOptions(rest, ['--agent', '--session', '--claim', '--todo'], ['--take', '--allow-overlap']);
      if (opts.positional.length > 1) throw new Error(`One batch at a time — to claim paths, use --claim <path>.\n${USAGE}`);
      const target = requireTarget(nd, opts.positional[0]);
      const todos = [...(target.todo === null ? [] : [target.todo]), ...opts.todos];
      console.log(JSON.stringify(startWork(root, nd, target.batch, { ...opts, todos }), null, 2));
      return;
    }
    if (command === 'claim') {
      const opts = parseOptions(rest, [], ['--allow-overlap']);
      const target = requireTarget(nd, opts.positional[0]);
      console.log(JSON.stringify(claimWork(nd, target, opts.positional.slice(1), opts.allowOverlap), null, 2));
      return;
    }
    if (command === 'waypoint' || command === 'pause') {
      const opts = parseOptions(rest, [], []);
      const target = requireTarget(nd, opts.positional[0]);
      if (opts.positional[1] === undefined) throw new Error(USAGE);
      const payload = readPayload(opts.positional[1]);
      const result = command === 'waypoint' ? addWaypoint(nd, target, payload) : pauseWork(root, nd, target, payload);
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    if (command === 'stop') {
      const opts = parseOptions(rest, [], ['--take']);
      console.log(JSON.stringify(stopWork(nd, requireTarget(nd, opts.positional[0]), opts.take), null, 2));
      return;
    }
    console.error(USAGE);
    process.exit(2);
  } catch (error) {
    console.log(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2));
    process.exit(1);
  }
}

type Options = { positional: string[]; agent?: string; session?: string; take: boolean; claims: string[]; todos: string[]; allowOverlap: boolean };

function parseOptions(args: string[], valued: string[], flags: string[]): Options {
  const out: Options = { positional: [], take: false, claims: [], todos: [], allowOverlap: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (valued.includes(arg)) {
      const value = args[i + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a value.\n${USAGE}`);
      if (arg === '--agent') out.agent = value;
      if (arg === '--session') out.session = value;
      if (arg === '--claim') out.claims.push(value);
      if (arg === '--todo') out.todos.push(value);
      i++;
    } else if (flags.includes(arg)) {
      if (arg === '--take') out.take = true;
      if (arg === '--allow-overlap') out.allowOverlap = true;
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown option "${arg}".\n${USAGE}`);
    } else {
      out.positional.push(arg);
    }
  }
  return out;
}

/** What a command is about: a todo of a batch, or (no todo) the batch. */
export type WorkTarget = { batch: string; todo: string | null };

/**
 * What a command's first argument names: a batch (`2026-11-12_2`, or its path), or a todo — its
 * folder under the batch (`2026-11-12_2/02-dark-mode`), `<batch>/<number or slug>` as `--todo`
 * takes them, or what `novadev todo` resolves: the start of the folder's name, or a word only one
 * open todo has.
 */
function requireTarget(nd: string, name: string | undefined): WorkTarget {
  if (name === undefined || name === '') throw new Error(USAGE);
  const text = name.replace(/^(\.novadev\/)?todos\//, '').replace(/\/+$/, '');
  if (BATCH_RE.test(text)) return { batch: requireBatch(nd, text), todo: null };
  const slash = text.indexOf('/');
  if (slash !== -1 && BATCH_RE.test(text.slice(0, slash))) {
    const batch = requireBatch(nd, text.slice(0, slash));
    try {
      return { batch, todo: resolveTodoRef(nd, batch, text.slice(slash + 1)) };
    } catch (error) {
      // Not a number, a slug or a folder: the start of a folder's name, as `novadev todo` takes it.
      try {
        const found = resolveOpenTodo(nd, text);
        if (found.batch === batch) return { batch, todo: found.todo };
      } catch {
        // the first answer names the batch's todos: it is the one to give
      }
      throw error;
    }
  }
  if (text.includes('/')) throw new Error(`"${text}" is not a batch name (YYYY-MM-DD_N), nor a todo of one (<batch>/<todo>).`);
  try {
    const found = resolveOpenTodo(nd, text);
    return { batch: found.batch, todo: found.todo };
  } catch (error) {
    const said = error instanceof Error ? error.message : String(error);
    if (said.startsWith('No open todo matches')) throw new Error(`"${text}" is not a batch name (YYYY-MM-DD_N), and no open todo matches it.`);
    throw error;
  }
}

/** A batch of `todos/`; the open batches are listed when it is not there. */
function requireBatch(nd: string, batch: string): string {
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

/** A todo named on `--todo`: its folder (`03-dark-mode`), its number (`03`, `3`) or its slug (`dark-mode`). */
function resolveTodoRef(nd: string, batch: string, raw: string): string {
  const todos = listDirs(join(nd, 'todos', batch));
  const ref = raw.trim().replace(/\/+$/, '').replace(new RegExp(`^${batch}/`), '');
  const number = /^\d+$/.test(ref) ? Number(ref) : null;
  const found = todos.filter((todo) => {
    const m = /^(\d+)-(.*)$/.exec(todo);
    return todo === ref || (m !== null && (m[2] === ref || (number !== null && Number(m[1]) === number)));
  });
  if (found.length === 1) return found[0]!;
  throw new Error(
    `${found.length === 0 ? `No todo "${ref}"` : `"${ref}" names more than one todo (${found.join(', ')})`} in batch ${batch}${todos.length > 0 ? ` — its todos: ${todos.join(', ')}` : ' — it has no todo folders'}.`,
  );
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

/**
 * The lock files of this worktree a command is about. A todo — the one the command names, else the
 * one its payload names — means the lock that holds it here (its own, or the batch-root lock that
 * covers it). The batch alone means every lock this worktree carries in it.
 */
function locksOf(nd: string, target: WorkTarget, payloadTodo: string | null = null): LockRead[] {
  const todo = target.todo ?? payloadTodo;
  if (todo !== null) {
    const read = lockHolding(nd, target.batch, todo);
    if (read !== null) return [read];
    if (target.todo !== null) return [];
  }
  return batchWorkLocks(nd, target.batch);
}

function notInWork(target: WorkTarget): Error {
  const ref = readRef(target);
  return new Error(`${target.todo === null ? 'Batch' : 'Todo'} ${ref} is not in work — \`novadev work start ${ref}\` first.`);
}

/** A lock that must be readable and this worktree's to write; a paused one only when `allowPaused`. */
function usable(nd: string, read: LockRead, allowPaused: boolean): WorkLock {
  const ref = readRef(read);
  if (read.state === 'invalid') throw new Error(`${lockRel(read.batch, read.todo)} cannot be read: ${read.error} — fix it, or delete it and start again.`);
  if (read.lock.state === 'paused' && !allowPaused) {
    throw new Error(`${subject(read.lock)} is paused — \`novadev work start ${ref}\` resumes it first.`);
  }
  // Taken over in another worktree (`work start --take` there): this lock is stale, and writing it
  // would point the registry back here — two sessions on one todo.
  const there = locksElsewhere(dirname(nd)).find((lock) => lock.batch === read.batch && !lock.gone && coversOverlap(lock.covers, read.lock.covers));
  if (there !== undefined) {
    throw new Error(
      `${subject(read.lock)} was taken over in another worktree: ${there.worktree}${there.branch ? ` (branch ${there.branch})` : ''}, by ${there.agent} — this lock is stale. Release it here with \`novadev work stop ${ref}\`.`,
    );
  }
  return read.lock;
}

/** The ONE lock a waypoint or a claim goes to; with several in the batch here, the todo must be named. */
function requireLock(nd: string, target: WorkTarget, payloadTodo: string | null, allowPaused: boolean, verb: string): WorkLock {
  const reads = locksOf(nd, target, payloadTodo);
  if (reads.length === 0) throw notInWork(target);
  if (reads.length > 1) {
    throw new Error(
      `Batch ${target.batch} has ${reads.length} locks in this worktree (${reads.map(readRef).join(', ')}) — say which: \`novadev work ${verb} ${target.batch}/<todo> …\`${verb === 'claim' ? '' : ', or "todo" in the payload'}.`,
    );
  }
  const lock = usable(nd, reads[0]!, allowPaused);
  aboutItsTodo(lock, payloadTodo);
  return lock;
}

/** A todo's lock is about its todo: an entry for another todo belongs in that todo's own lock. */
function aboutItsTodo(lock: WorkLock, payloadTodo: string | null): void {
  if (lock.unit === 'todo' && payloadTodo !== null && payloadTodo !== lock.covers![0]) {
    throw new Error(`The lock here is on todo ${lockRef(lock)}; todo ${lock.batch}/${payloadTodo} is not in work — \`novadev work start ${lock.batch}/${payloadTodo}\` first.`);
  }
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

type StartOptions = { agent?: string; session?: string; take: boolean; claims?: string[]; todos?: string[]; allowOverlap?: boolean };

/** What every lock one `work start` takes shares: who asks, when, and where. */
type StartContext = { root: string; nd: string; batch: string; agent: string; holder: Holder; at: string; now: Date; opts: StartOptions; wt: RegistryWorktree | null; /** No todo was named: the command spoke of the batch. */ byBatch: boolean };

/**
 * Take, or resume, the lock(s) one `work start` names. With todos (`<batch>/<todo>`, `--todo`): a
 * lock per todo — the todo's own, or the 0.17.0 batch-root lock that already covers it. Without:
 * the locks this worktree already carries in the batch are resumed, whatever they are on; when it
 * carries none, the whole batch is taken, as one batch-root lock. Every refusal comes before the
 * first write: either all the locks named are taken, or none.
 */
export function startWork(root: string, nd: string, batch: string, opts: StartOptions, now: Date = new Date()): unknown {
  const batchDir = join(nd, 'todos', batch);
  if (existsSync(join(batchDir, BATCH_COMPLETE_FILE))) {
    throw new Error(`Batch ${batch} is finished (${BATCH_COMPLETE_FILE}) — a new request gets a new batch (\`novadev new\`, or \`novadev file-todo\`).`);
  }
  const holder = currentHolder();
  if (opts.session !== undefined && opts.session.trim() !== '') holder.session = opts.session.trim();
  const named = (opts.todos ?? []).map((ref) => resolveTodoRef(nd, batch, ref)).filter((todo, i, all) => all.indexOf(todo) === i);
  const ctx: StartContext = { root, nd, batch, agent: resolveAgent(root, opts.agent), holder, at: nowTimestamp(now), now, opts, wt: worktreeAt(root), byBatch: named.length === 0 };

  const here = batchWorkLocks(nd, batch);
  const atRoot = here.find((read) => read.todo === null) ?? null;
  if (atRoot?.state === 'invalid') {
    throw new Error(`todos/${batch}/${WORK_LOCK_FILE} cannot be read: ${atRoot.error} — fix it, or delete it and start again.`);
  }
  let targets: StartTarget[] = [];
  if (named.length === 0) {
    targets = here.length > 0 ? here.map((read) => ({ todo: read.todo, read })) : [{ todo: null, read: null }];
  } else {
    for (const todo of named) {
      const own = here.find((read) => read.todo === todo);
      if (own !== undefined) targets.push({ todo, read: own });
      else if (atRoot !== null && atRoot.lock.covers === null) {
        throw new Error(`Batch ${batch} is locked here for all its todos — --todo cannot narrow that lock. Stop it first (\`novadev work stop ${batch}\`), then start the todos you want.`);
      } else if (atRoot !== null && atRoot.lock.covers.includes(todo)) {
        if (!targets.some((target) => target.todo === null)) targets.push({ todo: null, read: atRoot });
      } else targets.push({ todo, read: null });
    }
  }
  for (const target of targets) {
    if (target.read?.state === 'invalid') throw new Error(`${lockRel(batch, target.todo)} cannot be read: ${target.read.error} — fix it, or delete it and start again.`);
  }

  // "Do after" links (todo-links.ts): a todo that still waits for another is not started. Judged once
  // for everything this start takes, so two todos started together may depend on each other in order.
  const wholeBatch = targets.some((target) => target.todo === null && (target.read?.state === 'ok' ? target.read.lock.covers : null) === null);
  refuseWaitingTodos(nd, batch, wholeBatch ? null : targets.flatMap((target) => (target.todo !== null ? [target.todo] : target.read?.state === 'ok' ? (target.read.lock.covers ?? []) : [])));

  pruneGone(root);
  const plans = targets.map((target) => planStart(ctx, target));
  // The work-in-progress limit (wip.ts) — judged after every other refusal, before the first write.
  const express = wipCheck(ctx, targets);
  const pausedForUrgent = express === null ? [] : pauseForUrgent(ctx, express.urgent, targets);
  const taken = plans.map((plan) => plan());
  // In a worktree novadev made, the todos started there are the worktree's: its merge request
  // names them after the locks are gone.
  // (Its entry is read again: taking the locks may have added claims to it.)
  const wt = ctx.wt === null ? null : worktreeAt(root);
  if (wt !== null) {
    const todos = taken.flatMap(({ lock }) => (lock.covers ?? todoStates(nd, batch).filter((t) => !isTerminal(t.state)).map((t) => t.todo)).map((todo) => `${batch}/${todo}`));
    addWorktreeTodos(root, wt, todos);
  }
  const expressInfo =
    express === null
      ? {}
      : {
          expressLane: {
            urgent: express.urgent,
            note: 'an urgent todo is exempt from the work-in-progress limit; it skips no check — the gate, the review and the merge queue all still run',
            ...(pausedForUrgent.length > 0 ? { paused: pausedForUrgent } : {}),
            ...(express.elsewhere.length > 0 ? { stillInWorkElsewhere: express.elsewhere, elsewhereNote: 'pause these where they are (`novadev work pause …` in that worktree), so each has a resume point' } : {}),
          },
        };
  if (taken.length === 1) return { ...(taken[0]!.answer as Record<string, unknown>), ...expressInfo };
  return {
    batch,
    state: 'working',
    taken: true,
    ...expressInfo,
    covers: taken.flatMap(({ lock }) => lock.covers ?? []),
    locks: taken.map(({ answer }) => answer),
    todos: todoStates(nd, batch),
  };
}

/** The todos (`<batch>/<todo>`) a start takes that are not finished: a batch-root lock's are the batch's, or what it covers. */
function startRefs(ctx: StartContext, targets: readonly StartTarget[]): string[] {
  const { nd, batch } = ctx;
  const names = targets.flatMap((target) =>
    target.todo !== null ? [target.todo] : ((target.read?.state === 'ok' ? target.read.lock.covers : null) ?? listDirs(join(nd, 'todos', batch))),
  );
  return [...new Set(names)].filter((todo) => !isTerminal(todoState(join(nd, 'todos', batch, todo)))).map((todo) => `${batch}/${todo}`);
}

/**
 * The work-in-progress limit for this start. Throws when it would put the holder over the limit
 * with a todo that is not urgent. Answers null when no limit applies or nothing urgent is started
 * at the limit; else the urgent todos being started at the limit — the express lane — and the
 * holder's working todos in other worktrees, which this command cannot pause.
 */
function wipCheck(ctx: StartContext, targets: readonly StartTarget[]): { urgent: string[]; elsewhere: string[] } | null {
  const { root, nd, agent, now, holder } = ctx;
  const settings = wipSettings(root);
  // A lock without an actor cannot be counted: the limit is per holder.
  if (settings.limit === null || agent === UNKNOWN_AGENT) return null;
  const holders = todoHolders(nd, now, holder);
  const mine = wipHolders(nd, settings, holders).find((h) => h.agent === agent);
  const before = mine?.todos ?? [];
  const taking = startRefs(ctx, targets);
  const isUrgent = (ref: string) => todoPriority(join(nd, 'todos', ref)) === 'urgent';
  const added = taking.filter((ref) => !isUrgent(ref) && !before.includes(ref));
  if (added.length > 0 && before.length + added.length > settings.limit) {
    const held = before.map((ref) => {
      const h = holders.get(ref)!;
      return `  ${ref} — ${h.state === 'paused' ? 'paused' : h.live ? 'in work' : 'abandoned'}${h.worktree === null ? '' : ` in ${h.worktree}`}`;
    });
    throw new Error(
      `Work-in-progress limit: ${agent} holds ${before.length} of ${settings.limit} todo(s) ("wipLimit" in novadev.json), and this start would add ${added.length} (${added.join(', ')}).\n` +
        `${held.join('\n')}\n` +
        `Free a slot first: finish one and hand it to review (record it, then \`novadev work stop <ref>\`), or stop one you will not continue.` +
        `${settings.countsPaused ? ' A paused todo takes a slot here.' : ''} An urgent todo is exempt (\`novadev todo priority\` is a person's or the lead's decision).`,
    );
  }
  const urgent = taking.filter((ref) => isUrgent(ref) && holders.get(ref)?.agent !== agent);
  if (urgent.length === 0 || before.length < settings.limit) return null;
  const working = before.filter((ref) => holders.get(ref)!.state === 'working');
  return { urgent, elsewhere: working.filter((ref) => holders.get(ref)!.worktree !== null) };
}

/**
 * The express lane: before an urgent todo is started at the limit, every lock this holder is
 * WORKING on in this worktree is paused — the existing pause, with its record — so nothing is left
 * locked without a resume point. Answers what was paused.
 */
function pauseForUrgent(ctx: StartContext, urgent: readonly string[], targets: readonly StartTarget[]): { ref: string; waypoint: number | null }[] {
  const { root, nd, agent, now, batch } = ctx;
  const out: { ref: string; waypoint: number | null }[] = [];
  for (const read of listWorkLocks(nd)) {
    if (read.state !== 'ok' || read.lock.state !== 'working' || read.lock.agent !== agent) continue;
    // A lock this very start resumes is not paused for itself.
    if (read.batch === batch && targets.some((target) => target.todo === read.todo)) continue;
    const ref = readRef(read);
    const result = pauseWork(
      root,
      nd,
      { batch: read.batch, todo: read.todo },
      {
        stopped: `Paused for the urgent todo ${urgent.join(', ')} (the express lane): ${agent} was at the work-in-progress limit when it started. The work on ${ref} stopped where its last waypoint says.`,
        next: [`When the urgent todo is handed over, resume: \`novadev work start ${ref}\`.`, 'Read the waypoint below this record first: it is where the work was.'],
      },
      now,
    ) as { waypoint?: number };
    out.push({ ref, waypoint: result.waypoint ?? null });
  }
  return out;
}

/** One lock a start is about: a todo's (or, `todo` null, the batch-root one), and the file it has here already. */
type StartTarget = { todo: string | null; read: LockRead | null };

/**
 * Judge one lock of a start — throwing on every refusal — and answer with the write that takes it.
 * Nothing is written before the returned function runs.
 */
function planStart(ctx: StartContext, target: StartTarget): () => { lock: WorkLock; answer: unknown } {
  const { root, nd, batch, agent, holder, at, now, opts, wt, byBatch } = ctx;
  const kept = target.read?.state === 'ok' ? target.read.lock : null;
  const unit = target.todo === null ? 'batch' : 'todo';
  // The todos the lock holds: its own; or all of the batch (null), or what a resumed 0.17.0 lock covers.
  const covers: string[] | null = target.todo !== null ? [target.todo] : (kept?.covers ?? null);
  const what = subject({ batch, unit, covers });

  // In work in another worktree? That worktree's working.md is on its own branch, invisible here;
  // the registry says so. A live or paused one is refused (resume it where it is); an abandoned one
  // is taken over, like an abandoned lock here. A lock on OTHER todos of the batch is no obstacle.
  const conflicting = locksElsewhere(root).filter((lock) => lock.batch === batch && !lock.gone && coversOverlap(lock.covers, covers));
  let takenFrom: ElsewhereLock | null = null;
  for (const there of conflicting) {
    const liveness = lockLiveness(asWorkLock(there), now, holder);
    if ((liveness.live || there.state === 'paused') && !opts.take) {
      const where = `${there.worktree}${there.branch ? ` (branch ${there.branch})` : ''}`;
      const theirs = there.unit === 'todo' ? `Todo ${lockRef(there)}` : `Batch ${batch}${there.covers === null ? '' : ` (its todos ${there.covers.join(', ')})`}`;
      // Asked for the whole batch while one todo of it is someone's: the other todos are free.
      const others = byBatch && unit === 'batch' && covers === null && there.covers !== null ? ` The batch's other todos can be started by name: \`novadev work start ${batch}/<todo>\`.` : '';
      throw new Error(
        there.state === 'paused'
          ? `${theirs} is paused in another worktree: ${where}, by ${there.agent} — resume it there, where its pause record is; pass --take to move it here.${others}`
          : `${theirs} is in work in another worktree: ${where} — ${there.agent} on ${there.host || '?'}, last waypoint ${ageText(liveness.ageMinutes)}. If that session is gone, pass --take.${others}`,
      );
    }
    takenFrom ??= there;
  }

  // The paths this lock claims: given now, kept from the lock, and — outside a worktree novadev
  // made — the touches of the features of the todos it holds; inside one, the worktree's claims.
  const given = [...(opts.claims ?? []), ...(kept?.claims ?? [])];
  const claimed = wt === null ? batchClaims(root, nd, batch, given, covers) : worktreeBatchClaims(root, given, wt.claims);
  // Only the claims new to this lock are judged: the ones it holds (and the worktree's) were judged,
  // or allowed by the lead, when they were added.
  const already = new Set([...(kept?.claims ?? []), ...(wt?.claims ?? [])]);
  // The locks being taken over are no obstacle; another todo of the batch is (one owner per file).
  const holders = claimHolders(root, root).filter((h) => !(h.kind !== 'worktree' && conflicting.some((c) => c.file === h.file)));
  // Under "claims": "notice" an overlap is said, not refused — except under a protected path.
  const policy = claimPolicy(root);
  const { hard: overlaps, soft: shares } = judgeOverlaps(policy, claimOverlaps(root, claimed.claims.filter((claim) => !already.has(claim)), undefined, holders));
  if (overlaps.length > 0 && !opts.allowOverlap) {
    throw new Error(
      `${what} claims paths another worktree's batch owns — one owner per file:\n` +
        overlaps.map((o) => `  ${overlapText(o)}`).join('\n') +
        (policy.mode === 'notice'
          ? `\n${refusalHint(policy)}`
          : `\nNarrow the claims (fewer --claim paths, ${covers === null ? '--todo for only the todos you work on, ' : ''}or features that do not touch them), wait for that batch, or pass --allow-overlap when the lead decided they may share.`),
    );
  }
  // Once the lock is taken: an abandoned lock elsewhere is ours now, and the paths named here belong
  // to the worktree too (its gate accepts the files under them).
  const take = (lock: WorkLock) => {
    for (const there of conflicting) removeRegistryEntry(root, there);
    writeLock(lock);
    if (wt !== null) addWorktreeClaims(root, wt, (opts.claims ?? []).map((raw) => normalizeClaim(root, raw)).flatMap((c) => (c.ok ? [c.value] : [])));
  };
  const claimInfo = {
    claims: claimed.claims,
    claimsFrom: claimed.from,
    ...(covers !== null ? { covers } : {}),
    ...(claimed.claims.length === 0 ? { claimNote: `this ${unit} claims no path, so no overlap with other worktrees is checked — add some with --claim or \`novadev work claim\`` } : {}),
    ...(overlaps.length > 0 ? { overlaps: overlaps.map(overlapText) } : {}),
    ...(shares.length > 0 ? { shared: shares.map(overlapText), sharedNote: 'a notice, not a lock: someone else works in these paths too — the merge checks the combination' } : {}),
    ...(takenFrom !== null ? { takenFromWorktree: { worktree: takenFrom.worktree, branch: takenFrom.branch, agent: takenFrom.agent, state: takenFrom.state, updated: takenFrom.updated } } : {}),
  };

  if (kept === null) {
    const lock: WorkLock = {
      batch,
      unit,
      path: lockPath(nd, batch, target.todo),
      state: 'working',
      agent,
      host: holder.host,
      pid: holder.pid,
      session: holder.session,
      started: at,
      updated: at,
      resumed: null,
      todo: target.todo,
      phase: null,
      claims: claimed.claims,
      covers,
      entries: [],
    };
    return () => {
      take(lock);
      return { lock, answer: answer(nd, lock, { taken: true, resumed: false, from: null, ...claimInfo }) };
    };
  }

  const lock = kept;
  const liveness = lockLiveness(lock, now, holder);
  const same = lock.state === 'working' && sameSession(lock, holder);
  let from: 'paused' | 'same-session' | 'process-gone' | 'stale' | 'taken';
  if (lock.state === 'paused') from = 'paused';
  else if (same) from = 'same-session';
  else if (!liveness.live) from = liveness.reason === 'process-gone' ? 'process-gone' : 'stale';
  else if (opts.take) from = 'taken';
  else {
    throw new Error(
      `${what} is in work: ${holderText(lock, liveness)}, last waypoint ${ageText(liveness.ageMinutes)}` +
        `${whereText(lock) ? `, at ${whereText(lock)}` : ''}. If that session is gone, pass --take to take the lock over.` +
        (unit === 'todo' && byBatch ? ` The batch's other todos can be started by name: \`novadev work start ${batch}/<todo>\`.` : ''),
    );
  }
  const previous = { state: lock.state, agent: lock.agent, host: lock.host, pid: lock.pid, session: lock.session, updated: lock.updated };
  return () => {
    lock.state = 'working';
    lock.agent = agent;
    lock.host = holder.host;
    lock.pid = holder.pid;
    lock.session = holder.session;
    lock.updated = at;
    lock.claims = claimed.claims;
    lock.covers = covers;
    if (from !== 'same-session') lock.resumed = at;
    take(lock);
    return { lock, answer: answer(nd, lock, { taken: true, resumed: from !== 'same-session', from, previous, ...claimInfo }) };
  };
}

/** A lock's claims inside a worktree novadev made: the given ones (normalised) and the worktree's own. */
function worktreeBatchClaims(root: string, given: readonly string[], worktreeClaims: readonly string[]): ReturnType<typeof batchClaims> & { from: { worktree: string[] } } {
  const explicit: string[] = [];
  for (const raw of given) {
    const claim = normalizeClaim(root, raw);
    if (!claim.ok) throw new Error(claim.error);
    if (!explicit.includes(claim.value)) explicit.push(claim.value);
  }
  const all = [...explicit, ...worktreeClaims.filter((claim) => !explicit.includes(claim))];
  return { claims: all, from: { given: explicit, features: {}, worktree: [...worktreeClaims] } };
}

/**
 * The batch's lock in ANOTHER worktree when a live session holds it there (registry.ts), else null.
 * With `todo`, only a lock that holds that todo counts: its own, or a batch's that covers it.
 */
export function liveElsewhere(nd: string, batch: string, now: Date = new Date(), todo?: string): ElsewhereLock | null {
  for (const there of locksElsewhere(dirname(nd))) {
    if (there.batch !== batch || there.gone || there.state !== 'working') continue;
    if (todo !== undefined && there.covers !== null && !there.covers.includes(todo)) continue;
    if (lockLiveness(asWorkLock(there), now).live) return there;
  }
  return null;
}

/** A registry entry as a lock, for `lockLiveness`. */
function asWorkLock(entry: ElsewhereLock): WorkLock {
  return {
    batch: entry.batch, unit: entry.unit, path: '', state: entry.state, agent: entry.agent, host: entry.host, pid: entry.pid,
    session: entry.session, started: entry.started, updated: entry.updated, resumed: null, todo: entry.todo,
    phase: entry.phase, claims: entry.claims, covers: entry.covers, entries: [],
  };
}

// --- claim ---------------------------------------------------------------

/** Add paths to the claims of a lock in work (or paused): checked against the other worktrees first. */
export function claimWork(nd: string, target: WorkTarget, paths: readonly string[], allowOverlap: boolean): unknown {
  if (paths.length === 0) throw new Error(`Name the paths to claim.\n${USAGE}`);
  const lock = requireLock(nd, target, null, true, 'claim');
  const root = rootOf(lock);
  const added: string[] = [];
  for (const raw of paths) {
    const claim = normalizeClaim(root, raw);
    if (!claim.ok) throw new Error(claim.error);
    if (!lock.claims.includes(claim.value) && !added.includes(claim.value)) added.push(claim.value);
  }
  // requireLock refused a lock elsewhere that collides with this one; another todo of the batch is
  // a neighbour like any other.
  const policy = claimPolicy(root);
  const { hard: overlaps, soft: shares } = judgeOverlaps(policy, claimOverlaps(root, added));
  if (overlaps.length > 0 && !allowOverlap) {
    throw new Error(
      `Claiming them would overlap another worktree's batch — one owner per file:\n${overlaps.map((o) => `  ${overlapText(o)}`).join('\n')}\n` +
        (policy.mode === 'notice' ? refusalHint(policy) : 'Pass --allow-overlap when the lead decided they may share.'),
    );
  }
  lock.claims = [...lock.claims, ...added];
  writeLock(lock);
  // In a worktree novadev made, the paths are the worktree's too: its gate accepts them, even after
  // the lock is released.
  const wt = worktreeAt(root);
  if (wt !== null) addWorktreeClaims(root, wt, added);
  return { batch: lock.batch, ...refOf(lock), path: relPath(lock.path), state: lock.state, added, claims: lock.claims, ...(overlaps.length > 0 ? { overlaps: overlaps.map(overlapText) } : {}), ...(shares.length > 0 ? { shared: shares.map(overlapText) } : {}) };
}

/** `ref` for an answer about a todo's lock; a batch's lock is named by `batch` alone, as before. */
function refOf(lock: WorkLock): { ref?: string } {
  return lock.unit === 'todo' ? { ref: lockRef(lock) } : {};
}

function answer(nd: string, lock: WorkLock, extra: Record<string, unknown>): unknown {
  return {
    batch: lock.batch,
    ...refOf(lock),
    path: relPath(lock.path),
    state: lock.state,
    ...extra,
    agent: lock.agent,
    started: lock.started,
    todo: lock.todo,
    phase: lock.phase,
    claims: lock.claims,
    latest: latestEntry(lock),
    todos: todoStates(nd, lock.batch),
  };
}

// --- waypoint ------------------------------------------------------------

export function addWaypoint(nd: string, target: WorkTarget, payload: Record<string, unknown>, now: Date = new Date()): unknown {
  const named = resolveTodo(nd, target.batch, payload['todo']);
  const lock = requireLock(nd, target, named, false, 'waypoint');
  // Where the work is: the todo the payload names, else the one the command named, else as before.
  const todo = named ?? target.todo ?? lock.todo;
  const phase = resolvePhase(payload['phase']) ?? lock.phase;
  const note = sanitizeNote(requireText(payload, 'note'));
  const at = nowTimestamp(now);
  const number = nextNumber(lock);
  lock.entries.unshift({ kind: 'waypoint', number, heading: entryHeading('waypoint', number, at, todo, phase), body: note });
  lock.todo = todo;
  lock.phase = phase;
  lock.updated = at;
  writeLock(lock);
  return { batch: lock.batch, ...refOf(lock), path: relPath(lock.path), state: lock.state, waypoint: number, todo, phase, updated: at };
}

function nextNumber(lock: WorkLock): number {
  return Math.max(0, ...lock.entries.map((entry) => entry.number)) + 1;
}

// --- pause ---------------------------------------------------------------

/**
 * Write the pause record. One lock — the todo named, or the only lock here — gets it; when the
 * batch is named and this worktree holds several todos of it, every lock still working gets the
 * same record (all of them, when none is working), so none is left without a resume point.
 */
export function pauseWork(root: string, nd: string, target: WorkTarget, payload: Record<string, unknown>, now: Date = new Date()): unknown {
  const named = resolveTodo(nd, target.batch, payload['todo']);
  let reads = locksOf(nd, target, named);
  if (reads.length === 0) throw notInWork(target);
  if (reads.length > 1) {
    const working = reads.filter((read) => read.state === 'ok' && read.lock.state === 'working');
    if (working.length > 0) reads = working;
  }
  const locks = reads.map((read) => usable(nd, read, true));
  for (const lock of locks) aboutItsTodo(lock, named);
  const phase = resolvePhase(payload['phase']);
  const stopped = sanitizeNote(requireText(payload, 'stopped'));
  const next = sanitizeNote(nextSteps(payload['next']));
  const done = optionalText(payload, 'done');
  const resume = optionalText(payload, 'resume');
  const open = optionalText(payload, 'open');
  const at = nowTimestamp(now);
  const tree = treeState(root);
  const todos = todoStates(nd, target.batch);

  const paused = locks.map((lock) => {
    const todo = lock.unit === 'todo' ? lock.todo : (named ?? target.todo ?? lock.todo);
    const lockPhase = phase ?? lock.phase;
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
    // A todo's lock records its own todo; a batch's, every todo of the batch, as it always did.
    const listed = lock.unit === 'todo' ? todos.filter((t) => t.todo === lock.todo) : todos;
    const sections = [
      head.join('\n\n'),
      `### Stopped at\n\n${stopped}`,
      `### Next\n\n${next}`,
      done === null ? null : `### Done\n\n${sanitizeNote(done)}`,
      resume === null ? null : `### To resume\n\n${sanitizeNote(resume)}`,
      open === null ? null : `### Open\n\n${sanitizeNote(open)}`,
      `### ${lock.unit === 'todo' ? 'The todo' : 'Todos'} at the pause\n\n${listed.length > 0 ? listed.map((t) => `- ${STATE_MARK[t.state]} ${t.todo} — ${t.state}`).join('\n') : '(no todo folders)'}`,
    ].filter((section): section is string => section !== null);

    const number = nextNumber(lock);
    lock.entries.unshift({ kind: 'pause', number, heading: entryHeading('pause', number, at, todo, lockPhase), body: sections.join('\n\n') });
    lock.state = 'paused';
    lock.todo = todo;
    lock.phase = lockPhase;
    lock.updated = at;
    writeLock(lock);
    return {
      batch: lock.batch,
      ...refOf(lock),
      path: relPath(lock.path),
      state: 'paused',
      waypoint: number,
      todo,
      phase: lockPhase,
      pausedAt: at,
      ...(tree === null ? {} : { tree: { branch: tree.branch, head: tree.head, uncommitted: tree.paths === null ? null : tree.paths.length } }),
      todos,
    };
  });
  return paused.length === 1 ? paused[0] : { batch: target.batch, state: 'paused', pausedAt: at, paused, todos };
}

const STATE_MARK: Record<TodoState, string> = {
  confirmed: '✓✓',
  completed: '✓',
  needstest: '⧗',
  changes: '↺',
  review: '◇',
  unmerged: '⇢',
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

/**
 * Release the lock a todo names, or every lock this worktree carries in the batch. A todo held by a
 * batch-root lock that holds more than that todo cannot be taken out of it: that lock is stopped as
 * a whole. A live lock of another session refuses the whole stop, before anything is released.
 */
export function stopWork(nd: string, target: WorkTarget, take: boolean, now: Date = new Date()): unknown {
  const { batch } = target;
  let reads: LockRead[];
  if (target.todo !== null) {
    const read = lockHolding(nd, batch, target.todo);
    if (read === null) throw new Error(`Todo ${readRef(target)} is not in work — there is no lock to release.`);
    if (read.todo === null) {
      if (read.state === 'invalid') {
        throw new Error(`todos/${batch}/${WORK_LOCK_FILE}, the batch's lock, cannot be read: ${read.error} — \`novadev work stop ${batch}\` removes it.`);
      }
      const covers = read.lock.covers;
      if (covers === null || covers.length !== 1) {
        throw new Error(
          `Todo ${readRef(target)} is held by the lock on ${covers === null ? 'the whole batch' : `todos ${covers.join(', ')}`} (todos/${batch}/${WORK_LOCK_FILE}) — a todo is not taken out of it: \`novadev work stop ${batch}\` releases that lock.`,
        );
      }
    }
    reads = [read];
  } else {
    reads = batchWorkLocks(nd, batch);
    if (reads.length === 0) throw new Error(`Batch ${batch} is not in work — there is no lock to release.`);
  }
  const holder = currentHolder();
  for (const read of reads) {
    if (read.state === 'invalid') continue;
    const liveness = lockLiveness(read.lock, now, holder);
    if (read.lock.state === 'working' && liveness.live && !sameSession(read.lock, holder) && !take) {
      throw new Error(
        `${subject(read.lock)} is in work: ${holderText(read.lock, liveness)}, last waypoint ${ageText(liveness.ageMinutes)}. If that session is gone, pass --take to release the lock anyway.`,
      );
    }
  }
  const released = reads.map((read) => {
    rmSync(read.path, { force: true });
    // Only this worktree's entry: another worktree that took the work over keeps its own (--take
    // releases the lock HERE, never the one there).
    removeRegistryLock(dirname(nd), batch, read.todo);
    const todos = todoStates(nd, batch);
    const ref = read.todo === null ? {} : { ref: readRef(read) };
    if (read.state === 'invalid') {
      // An unreadable lock is still a lock: releasing it is what the person asked for.
      return { batch, ...ref, state: 'released', path: relPath(read.path), unreadable: read.error, todos };
    }
    const lock = read.lock;
    const unfinished = todos.filter((t) => !isTerminal(t.state) && (lock.covers === null || lock.covers.includes(t.todo))).map((t) => t.todo);
    return {
      batch,
      ...ref,
      state: 'released',
      path: relPath(lock.path),
      ...(lock.covers !== null ? { covers: lock.covers } : {}),
      wasPaused: lock.state === 'paused',
      waypoints: lock.entries.length,
      ...(unfinished.length > 0 ? { unfinished, note: 'these todos are not recorded as finished — a pause keeps the resume point; a stop does not' } : {}),
      todos,
    };
  });
  return released.length === 1 ? released[0] : { batch, state: 'released', released, todos: todoStates(nd, batch) };
}
