// The metrics hook: ONE command a project configures, the JSON it prints, the stored snapshot,
// and the step `novadev sync` runs first.
//
// novadev stays framework-agnostic here on purpose: it runs the command, reads JSON of a small
// agreed shape from its stdout, and knows nothing about what produced it.
//
//   novadev.json   "metrics": "<shell command>"            off when absent or null
//                  "debtBudget": { "maxKnown": 230 }       off when absent or null (debt-budget.ts)
//                  "metricsWikiPage": "architecture.md"    optional; false = no wiki block
//                  "metricsTimeoutSeconds": 300            optional
//
//   the command    { "debt": { "known": 230, "new": 0 },
//   prints         "hubs": [ { "name": "Workbench", "measure": 11019, "over": ["loc"], "path": "…" } ] }
//
// `novadev sync` runs the command and stores the result in `.novadev/metrics/latest.json` (tracked,
// so the change is in the commit's diff; a derived file, so `sync --check` fails while it is stale).
// It compares the numbers with the last commit's snapshot and lists what GREW under NEXT ACTIONS
// until a record of the round explains it. A missing or failing command is a warning, never a
// sync failure — but a debt budget that nothing can be checked against fails `sync --check`.
//
// What can be judged from the files alone — doctor's view and the wiki budgets block — is
// metrics-audit.ts.
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, statSync } from 'node:fs';
import { constants } from 'node:os';
import { join } from 'node:path';
import {
  type BrokenRaise,
  type DebtBudget,
  type RaiseOutcome,
  type RecordHistory,
  type RecordRaise,
  collectRaises,
  debtNotes,
  ledgerEntryFor,
  parseBudget,
  planRaises,
  recordHistory,
  writeBudget,
} from './debt-budget.ts';
import { fileAtHead } from './git.ts';
import {
  type Fix,
  type Parsed,
  ROOT_DIR_NAME,
  byCodePoint,
  isCount,
  isDirectory,
  isPlainObject,
  novadevDir,
  readManifest,
  refuse,
  todayStamp,
} from './lib.ts';

export const METRICS_DIR = 'metrics';
export const METRICS_SNAPSHOT = 'latest.json';
export const METRICS_TIMEOUT_DEFAULT = 300;
export const METRICS_WIKI_PAGE_DEFAULT = 'architecture.md';

const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
/** The longest delay a timer can hold; a bigger "metricsTimeoutSeconds" would fire at once. */
const MAX_TIMER_MS = 2_147_483_647;
/** After a timeout: how long the command's processes get to stop before they are killed. */
const KILL_GRACE_MS = 1_000;
/**
 * After the command exits: how long a process it left behind may keep its output open. After
 * that, novadev reads what the command printed and stops the processes it left behind.
 */
const DRAIN_MS = 2_000;
const WINDOWS = process.platform === 'win32';
/** Control characters: never part of a hub name, a budget name or a path. */
const CONTROL = /[\u0000-\u001f\u007f]/;

export type Debt = { known: number; new?: number };
export type Hub = { name: string; measure: number; over: string[]; path?: string };
/** What the command printed, normalized: unknown keys dropped, hubs sorted by name. */
export type Metrics = { debt?: Debt; hubs: Hub[] };
/** The stored snapshot: the metrics plus the date they last changed. */
export type Snapshot = Metrics & { updated: string };

export type MetricsConfig = {
  command: string | null;
  timeoutSeconds: number;
  /** The wiki page that carries the budgets block, or null when the block is turned off. */
  wikiPage: string | null;
  budget: DebtBudget | null;
  /** Settings novadev cannot use, phrased for PROBLEMS. The broken setting is treated as off. */
  problems: string[];
};

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export function readMetricsConfig(nd: string): MetricsConfig {
  const manifest = readManifest(nd) ?? {};
  const problems: string[] = [];

  let command: string | null = null;
  const rawCommand = manifest.metrics;
  if (typeof rawCommand === 'string') {
    command = rawCommand.trim() === '' ? null : rawCommand.trim();
  } else if (rawCommand !== undefined && rawCommand !== null) {
    problems.push('novadev.json: "metrics" must be a shell command (a string), or null to turn it off');
  }

  let timeoutSeconds = METRICS_TIMEOUT_DEFAULT;
  const rawTimeout = manifest.metricsTimeoutSeconds;
  if (rawTimeout !== undefined && rawTimeout !== null) {
    if (typeof rawTimeout === 'number' && Number.isFinite(rawTimeout) && rawTimeout > 0) {
      timeoutSeconds = rawTimeout;
    } else {
      problems.push('novadev.json: "metricsTimeoutSeconds" must be a number of seconds, above 0');
    }
  }

  let wikiPage: string | null = METRICS_WIKI_PAGE_DEFAULT;
  const rawPage = manifest.metricsWikiPage;
  if (rawPage === false) {
    wikiPage = null;
  } else if (rawPage !== undefined && rawPage !== null) {
    if (
      typeof rawPage === 'string' &&
      /^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/.test(rawPage) &&
      rawPage !== 'index.md' &&
      rawPage !== 'log.md' &&
      rawPage !== 'README.md'
    ) {
      wikiPage = rawPage;
    } else {
      problems.push(
        'novadev.json: "metricsWikiPage" must be the file name of a wiki page (like "architecture.md", not index.md), or false for no budgets block',
      );
    }
  }

  let budget: DebtBudget | null = null;
  const rawBudget = manifest.debtBudget;
  if (rawBudget !== undefined && rawBudget !== null) {
    const parsed = parseBudget(rawBudget);
    if (parsed.ok) budget = parsed.value;
    else problems.push(`novadev.json: ${parsed.error}`);
  }

  return { command, timeoutSeconds, wikiPage, budget, problems };
}

// ---------------------------------------------------------------------------
// The command's output
// ---------------------------------------------------------------------------

/** Parse what the command printed on stdout. It must be ONE JSON object and nothing else. */
export function parseMetricsOutput(stdout: string): Parsed<Metrics> {
  const text = stdout.trim();
  if (text === '') return refuse('it printed nothing on stdout');
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    const first = text.split('\n', 1)[0]!.slice(0, 60);
    return refuse(
      `its output is not JSON (it starts with "${first}") — print only the JSON on stdout, and send logs to stderr`,
    );
  }
  return normalizeMetrics(raw);
}

/** Validate the agreed shape and normalize it: unknown keys dropped, hubs sorted by name. */
export function normalizeMetrics(raw: unknown): Parsed<Metrics> {
  if (!isPlainObject(raw)) return refuse('the JSON must be an object with "debt" and/or "hubs"');
  if ((raw.debt === undefined || raw.debt === null) && (raw.hubs === undefined || raw.hubs === null)) {
    return refuse('the JSON has neither "debt" nor "hubs"');
  }

  let debt: Debt | undefined;
  if (raw.debt !== undefined && raw.debt !== null) {
    if (!isPlainObject(raw.debt)) return refuse('"debt" must be an object like { "known": 230, "new": 0 }');
    if (!isCount(raw.debt.known)) return refuse('"debt.known" must be a whole number, 0 or more');
    const fresh = raw.debt.new;
    if (fresh !== undefined && fresh !== null && !isCount(fresh)) {
      return refuse('"debt.new" must be a whole number, 0 or more');
    }
    debt = isCount(fresh) ? { known: raw.debt.known, new: fresh } : { known: raw.debt.known };
  }

  const hubs: Hub[] = [];
  if (raw.hubs !== undefined && raw.hubs !== null) {
    if (!Array.isArray(raw.hubs)) return refuse('"hubs" must be a list');
    const seen = new Set<string>();
    for (const [i, entry] of raw.hubs.entries()) {
      if (!isPlainObject(entry)) return refuse(`hubs[${i}] must be an object`);
      const name = typeof entry.name === 'string' ? entry.name.trim() : '';
      if (name === '') return refuse(`hubs[${i}] needs a "name"`);
      if (CONTROL.test(name)) return refuse(`hubs[${i}]: "name" must be one line of plain text`);
      if (seen.has(name)) return refuse(`two hubs are named "${name}" — every hub name must be unique`);
      seen.add(name);
      const measure = entry.measure;
      if (typeof measure !== 'number' || !Number.isFinite(measure) || measure < 0) {
        return refuse(`hub "${name}": "measure" must be a number, 0 or more`);
      }
      const over = entry.over ?? [];
      if (
        !Array.isArray(over) ||
        over.some((axis) => typeof axis !== 'string' || axis.trim() === '' || CONTROL.test(axis))
      ) {
        return refuse(`hub "${name}": "over" must be a list of names, like ["loc"]`);
      }
      const hub: Hub = {
        name,
        measure,
        over: [...new Set((over as string[]).map((axis) => axis.trim()))].sort(byCodePoint),
      };
      if (entry.path !== undefined && entry.path !== null) {
        const path = typeof entry.path === 'string' ? repoPath(entry.path) : null;
        if (path === null) {
          return refuse(
            `hub "${name}": "path" must be a path inside the project, relative to its root and without "..", like "src/wb/"`,
          );
        }
        hub.path = path;
      }
      hubs.push(hub);
    }
  }
  hubs.sort((a, b) => byCodePoint(a.name, b.name));
  return { ok: true, value: { ...(debt ? { debt } : {}), hubs } };
}

/**
 * A hub path as the snapshot stores it: forward slashes, no "." segments, no doubled slashes — so
 * the same script gives the same snapshot on Windows and on Linux, and other tools can match it
 * against the paths in records and features. A trailing slash (a folder) is kept. Null for a path
 * that is empty, absolute (it would differ from one machine to the next), leaves the project with
 * "..", or is not one line of text.
 */
export function repoPath(raw: string): string | null {
  if (CONTROL.test(raw)) return null;
  const path = raw.trim().replace(/\\/g, '/');
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) return null;
  const parts = path.split('/');
  if (parts.includes('..')) return null;
  const kept = parts.filter((part) => part !== '' && part !== '.');
  if (kept.length === 0) return null;
  return kept.join('/') + (path.endsWith('/') ? '/' : '');
}

export type CommandResult = { ok: true; value: Metrics } | { ok: false; error: string };

/** The command as it is printed: control characters made visible, so the output stays one line. */
export function displayCommand(command: string): string {
  return command.replace(/[\u0000-\u001f\u007f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

/**
 * Run the configured command from the project root and read its JSON. It never throws and never
 * leaves the command running: the command runs in a process group of its own, and on a timeout
 * the whole group is stopped — the command AND every process it started. The timeout is for the
 * command itself: once it exits, a process it left behind that still holds its output open gets
 * DRAIN_MS, then the output is read and that process is stopped too. When novadev itself is
 * stopped while the command runs (Ctrl+C), it stops that group too. A process the command moves
 * out of its group on purpose (a daemon) is the one thing this cannot reach — and on Windows,
 * where taskkill finds a process tree through its parents, neither is one whose parent has exited.
 */
export function runMetricsCommand(root: string, command: string, timeoutSeconds: number): Promise<CommandResult> {
  const shown = `\`${displayCommand(command)}\``;
  const ms = Math.min(Math.max(1, Math.round(timeoutSeconds * 1000)), MAX_TIMER_MS);
  return new Promise((done) => {
    // novadev is being stopped (Ctrl+C, a closed terminal): stop the command's group with it. The
    // group gets SIGTERM whatever novadev got — a shell's background jobs ignore SIGINT. The
    // handlers go in BEFORE the command starts: the command may run before spawn() returns here,
    // and a signal that came in between would stop novadev and leave the command running. A JS
    // signal handler runs only once spawn() has returned, so `child` is set by then.
    let child: ChildProcess | undefined;
    const passOn = (signal: NodeJS.Signals) => {
      if (child) killGroup(child, 'SIGTERM');
      process.exit(128 + (constants.signals[signal] ?? 1));
    };
    const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];
    for (const signal of signals) process.on(signal, passOn);
    try {
      child = spawn(command, {
        cwd: root,
        shell: true,
        detached: !WINDOWS,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (error) {
      for (const signal of signals) process.off(signal, passOn);
      done(refuse(`${shown} could not run: ${error instanceof Error ? error.message : String(error)}`));
      return;
    }
    const started = child;

    const out: Buffer[] = [];
    let outBytes = 0;
    let errTail = '';
    let stopped: 'timeout' | 'overflow' | null = null;
    let settled = false;
    let drain: ReturnType<typeof setTimeout> | undefined;

    // SIGTERM first; SIGKILL for whatever is still there after the grace period. The check runs
    // often, so novadev does not wait the whole grace period for processes that are already gone.
    const stopGroup = () => {
      killGroup(started, 'SIGTERM');
      const deadline = Date.now() + KILL_GRACE_MS;
      const check = setInterval(() => {
        if (!groupAlive(started)) {
          clearInterval(check);
        } else if (Date.now() >= deadline) {
          killGroup(started, 'SIGKILL');
          clearInterval(check);
        }
      }, 50);
    };
    const timer = setTimeout(() => {
      stopped = 'timeout';
      stopGroup();
    }, ms);

    const finish = (result: CommandResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(drain);
      for (const signal of signals) process.off(signal, passOn);
      done(result);
    };
    const settle = (code: number | null, signal: NodeJS.Signals | null) => {
      if (stopped === 'timeout') {
        finish(refuse(`${shown} did not finish within ${timeoutSeconds} s (raise "metricsTimeoutSeconds" if it needs longer)`));
      } else if (stopped === 'overflow') {
        finish(refuse(`${shown} printed more than ${MAX_OUTPUT_BYTES / 1024 / 1024} MB on stdout`));
      } else if (code !== 0) {
        const how = code === null ? `was stopped (${signal ?? 'signal'})` : `exited with ${code}`;
        const tail = lastLines(errTail, 3);
        finish(refuse(`${shown} ${how}${tail ? ` — ${tail}` : ''}`));
      } else {
        const parsed = parseMetricsOutput(Buffer.concat(out).toString('utf8'));
        finish(parsed.ok ? parsed : refuse(`${shown}: ${parsed.error}`));
      }
    };

    started.stdout!.on('data', (chunk: Buffer) => {
      outBytes += chunk.length;
      if (outBytes <= MAX_OUTPUT_BYTES) {
        out.push(chunk);
      } else if (stopped === null) {
        stopped = 'overflow';
        stopGroup();
      }
    });
    started.stderr!.on('data', (chunk: Buffer) => {
      errTail = (errTail + chunk.toString('utf8')).slice(-4096);
    });
    started.on('error', (error) => finish(refuse(`${shown} could not run: ${error.message}`)));
    started.on('exit', (code, signal) => {
      if (settled) return;
      // The command finished in time, so the timeout no longer applies: a timeout that fired now
      // would throw away good output. A process it left behind may still hold its output open:
      // give the pipes a moment to drain, then read what there is and stop what was left behind.
      clearTimeout(timer);
      drain = setTimeout(() => {
        started.stdout?.destroy();
        started.stderr?.destroy();
        stopGroup();
        settle(code, signal);
      }, DRAIN_MS);
    });
    started.on('close', (code, signal) => settle(code, signal));
  });
}

/** True while any process of the command's group is still running (always false on Windows). */
function groupAlive(child: ChildProcess): boolean {
  if (WINDOWS || child.pid === undefined) return false;
  try {
    process.kill(-child.pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Stop the command and every process in its group. Quiet when they are already gone. */
function killGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  try {
    if (WINDOWS) {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } else {
      process.kill(-child.pid, signal);
    }
  } catch {
    /* already gone */
  }
}

// ---------------------------------------------------------------------------
// The stored snapshot
// ---------------------------------------------------------------------------

export function snapshotPath(nd: string): string {
  return join(nd, METRICS_DIR, METRICS_SNAPSHOT);
}

/** True when `.novadev/metrics` is a file where novadev needs its folder. */
export function metricsFolderIsFile(nd: string): boolean {
  const path = join(nd, METRICS_DIR);
  return existsSync(path) && !isDirectory(path);
}

/**
 * The stored snapshot as the files hold it. `invalid`: a file that is not a snapshot (sync writes
 * it again once the command works). `blocked`: something that is not a file stands where the
 * snapshot belongs (a folder, a link to nowhere) — sync never writes over it.
 */
export type SnapshotRead =
  | { state: 'absent' }
  | { state: 'invalid'; error: string }
  | { state: 'blocked'; error: string }
  | { state: 'ok'; snapshot: Snapshot };

export function readSnapshot(nd: string): SnapshotRead {
  const path = snapshotPath(nd);
  try {
    lstatSync(path);
  } catch {
    return { state: 'absent' }; // nothing there, or .novadev/metrics is a file (metricsFolderIsFile)
  }
  let kind: string;
  try {
    const stat = statSync(path);
    kind = stat.isFile() ? 'file' : stat.isDirectory() ? 'a folder, not a file' : 'not a plain file';
  } catch {
    kind = 'a link that points nowhere';
  }
  if (kind !== 'file') return { state: 'blocked', error: kind };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return { state: 'invalid', error: 'not valid JSON' };
  }
  const parsed = normalizeMetrics(raw);
  if (!parsed.ok) return { state: 'invalid', error: parsed.error };
  const updated =
    isPlainObject(raw) && typeof raw.updated === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.updated)
      ? raw.updated
      : '';
  return { state: 'ok', snapshot: { updated, ...parsed.value } };
}

/** The stored snapshot, or null when there is none or it cannot be read. */
export function currentSnapshot(nd: string): Snapshot | null {
  const read = readSnapshot(nd);
  return read.state === 'ok' ? read.snapshot : null;
}

/** The snapshot as it was in the last commit, or null (no git, no commit yet, not committed). */
export function committedSnapshot(root: string): Metrics | null {
  const text = fileAtHead(root, `${ROOT_DIR_NAME}/${METRICS_DIR}/${METRICS_SNAPSHOT}`);
  if (text === null) return null;
  try {
    const parsed = normalizeMetrics(JSON.parse(text));
    return parsed.ok ? parsed.value : null;
  } catch {
    return null;
  }
}

/**
 * The file format: plain JSON, one hub per line, so a commit's diff shows exactly which hub moved.
 * Deterministic for the same metrics, which is what lets sync skip the write when nothing changed.
 */
export function renderSnapshot(snapshot: Snapshot): string {
  const lines = ['{', `  "updated": ${JSON.stringify(snapshot.updated)},`];
  if (snapshot.debt) lines.push(`  "debt": ${JSON.stringify(debtJson(snapshot.debt))},`);
  if (snapshot.hubs.length === 0) {
    lines.push('  "hubs": []');
  } else {
    lines.push('  "hubs": [');
    snapshot.hubs.forEach((hub, i) => {
      const comma = i < snapshot.hubs.length - 1 ? ',' : '';
      lines.push(`    ${JSON.stringify(hubJson(hub))}${comma}`);
    });
    lines.push('  ]');
  }
  lines.push('}');
  return lines.join('\n') + '\n';
}

/** Same numbers, same hubs, same paths — the date is not part of the comparison. */
export function sameMetrics(a: Metrics, b: Metrics): boolean {
  return renderSnapshot({ ...a, updated: '' }) === renderSnapshot({ ...b, updated: '' });
}

function debtJson(debt: Debt): Record<string, number> {
  return debt.new === undefined ? { known: debt.known } : { known: debt.known, new: debt.new };
}

function hubJson(hub: Hub): Record<string, unknown> {
  return { name: hub.name, measure: hub.measure, over: hub.over, ...(hub.path ? { path: hub.path } : {}) };
}

// ---------------------------------------------------------------------------
// Deltas
// ---------------------------------------------------------------------------

export type Delta = {
  /** True when something got bigger or worse — these become NEXT ACTIONS until explained. */
  grew: boolean;
  /** "known debt 230 → 238 (+8)", "hub Workbench 11,019 → 11,140 (+121)". */
  text: string;
  /** What the agent should do about it, appended to the NEXT ACTIONS line. */
  advice: string;
  /** The hub it is about; absent for the debt counts. A `## Debt` section explains it by name. */
  hub?: string;
};

const DEBT_ADVICE = 'it grew: say why in a "## Debt" section of this round\'s record, or reduce it';

export function diffMetrics(prev: Metrics, next: Metrics): Delta[] {
  const out: Delta[] = [];

  if (prev.debt && next.debt) {
    if (prev.debt.known !== next.debt.known) {
      out.push({
        grew: next.debt.known > prev.debt.known,
        text: `known debt ${change(prev.debt.known, next.debt.known)}`,
        advice: DEBT_ADVICE,
      });
    }
    if (prev.debt.new !== undefined && next.debt.new !== undefined && prev.debt.new !== next.debt.new) {
      out.push({
        grew: next.debt.new > prev.debt.new,
        text: `new debt ${change(prev.debt.new, next.debt.new)}`,
        advice: DEBT_ADVICE,
      });
    }
  }

  const before = new Map(prev.hubs.map((h) => [h.name, h]));
  const after = new Map(next.hubs.map((h) => [h.name, h]));
  const names = [...new Set([...before.keys(), ...after.keys()])].sort(byCodePoint);
  for (const name of names) {
    const a = before.get(name);
    const b = after.get(name);
    if (a && b) {
      const added = b.over.filter((axis) => !a.over.includes(axis));
      const removed = a.over.filter((axis) => !b.over.includes(axis));
      if (a.measure === b.measure && added.length === 0 && removed.length === 0) continue;
      const parts = [
        a.measure === b.measure ? `hub ${name} ${fmt(b.measure)}` : `hub ${name} ${change(a.measure, b.measure)}`,
      ];
      if (added.length > 0) parts.push(`now over ${added.join(', ')}`);
      if (removed.length > 0) parts.push(`no longer over ${removed.join(', ')}`);
      out.push({
        grew: b.measure > a.measure || added.length > 0,
        text: parts.join(', '),
        advice:
          'a hub grew: name it in a "## Debt" section of this round\'s record and say why the change belongs there, or move it to a smaller unit',
        hub: name,
      });
    } else if (b) {
      out.push({
        grew: true,
        text: `hub ${name} ${fmt(b.measure)} is new${b.over.length > 0 ? ` (over ${b.over.join(', ')})` : ''}`,
        advice: 'a new hub: name it in a "## Debt" section of this round\'s record and say why, or split it',
        hub: name,
      });
    } else if (a) {
      out.push({ grew: false, text: `hub ${name} is gone (was ${fmt(a.measure)})`, advice: '', hub: name });
    }
  }
  return out;
}

/** True when `text` names `name` as a word of its own (not inside a longer name), ignoring case. */
export function mentions(text: string, name: string): boolean {
  const hay = text.toLowerCase();
  const needle = name.toLowerCase();
  const word = /[\p{L}\p{N}_]/u;
  for (let at = hay.indexOf(needle); at !== -1; at = hay.indexOf(needle, at + 1)) {
    if (!word.test(hay[at - 1] ?? ' ') && !word.test(hay[at + needle.length] ?? ' ')) return true;
  }
  return false;
}

/** 11019 → "11,019"; 2.5 → "2.5". */
export function fmt(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/** "230 → 238 (+8)". */
export function change(from: number, to: number): string {
  const diff = to - from;
  return `${fmt(from)} → ${fmt(to)} (${diff >= 0 ? '+' : '-'}${fmt(Math.abs(diff))})`;
}

// ---------------------------------------------------------------------------
// The sync step
// ---------------------------------------------------------------------------

/**
 * What the wiki block and the audit are judged against: the snapshot as this sync stores it (or
 * would, with --check), and the budget novadev.json holds once this sync is done (or would).
 */
export type MetricsView = { snapshot: SnapshotRead; budget: DebtBudget | null };

export type MetricsRun = {
  /** The first line of the metrics block, or null when metrics are off and nothing is stored. */
  headline: string | null;
  /** The lines under it: every change, the budget state, warnings. */
  lines: string[];
  /**
   * NEXT ACTIONS: what grew without an explanation, a budget that is exceeded or cannot be
   * checked, a gain the budget does not keep yet, a broken snapshot.
   */
  actions: string[];
  /** Known debt is over the budget (after the raises records ask for) — fails `sync --check`. */
  overBudget: boolean;
  /** The snapshot, when it changes: derived content, written by sync beside the link files. */
  fixes: Fix[];
  /**
   * Further reasons `sync --check` fails: a snapshot nobody can read, a raise sync has not written
   * into novadev.json yet, a debt budget nothing can be checked against.
   */
  failures: string[];
  /** The state the wiki block and the audit must be judged against. */
  view: MetricsView;
};

/**
 * Where the numbers the budget is checked against come from: the command, this run; the stored
 * snapshot; or the last commit's snapshot, when none is stored (deleted on a merge conflict, say).
 */
type Basis = 'fresh' | 'stored' | 'committed';

/**
 * The metrics half of `novadev sync`: run the command, compare, apply budget raises. The new
 * snapshot comes back as a Fix for sync to write; the budget is written here. With `check`,
 * nothing is written — the comparison and the budget check still run.
 */
export async function refreshMetrics(
  root: string,
  opts: { check: boolean; today?: string; onRun?: (command: string) => void },
): Promise<MetricsRun> {
  const nd = novadevDir(root);
  const today = opts.today ?? todayStamp();
  const config = readMetricsConfig(nd);
  const stored = readSnapshot(nd);
  const storedSnapshot = stored.state === 'ok' ? stored.snapshot : null;
  const where = `${ROOT_DIR_NAME}/${METRICS_DIR}/${METRICS_SNAPSHOT}`;
  const lines: string[] = [];
  const actions: string[] = [];
  const fixes: Fix[] = [];
  const failures: string[] = [];
  let headline: string | null = null;
  let snapshot: SnapshotRead = stored;
  // The last commit: what this round is compared with, and what sync falls back on when no
  // snapshot is stored. One view of git for the whole run, for the records too.
  const committed = config.command !== null || config.budget !== null ? committedSnapshot(root) : null;
  const history = recordHistory(root);

  // The debt count sync must not lose: the stored snapshot's — or, with a debt budget, the last
  // commit's when the stored one is gone or has none. (Without a budget, deleting the snapshot is
  // how a project that stopped counting debt on purpose starts again.)
  const kept = storedSnapshot?.debt ? storedSnapshot : config.budget !== null && committed?.debt ? committed : null;
  // What the budget is checked against: fresh numbers when the command works; else that count;
  // else the stored snapshot, else the last commit's.
  const fallback = kept ?? storedSnapshot ?? committed;
  let measured: Metrics | null = fallback;
  let basis: Basis | null = fallback === null ? null : fallback === storedSnapshot ? 'stored' : 'committed';

  if (config.command !== null) {
    opts.onRun?.(config.command);
    const result = await runMetricsCommand(root, config.command, config.timeoutSeconds);
    // Output that stopped reporting the debt is incomplete, not "no debt": storing it would drop the
    // count from the snapshot, and the budget gate would pass without anyone noticing. The checks
    // then use the count kept above.
    const lostDebt = result.ok && result.value.debt === undefined && kept !== null;
    if (!result.ok || lostDebt) {
      headline = result.ok
        ? `metrics: ⚠ the command no longer prints "debt" — ${basis === 'stored' ? 'the stored snapshot' : "the last commit's snapshot"} has known debt ${fmt(kept!.debt!.known)}`
        : `metrics: ⚠ the command failed — ${result.error}`;
      lines.push(keptLine(stored, basis));
      if (lostDebt) {
        lines.push(
          'if the project stopped counting debt on purpose, remove "debtBudget" from novadev.json and delete the snapshot; `novadev sync` then stores a new one',
        );
      }
    } else {
      measured = result.value;
      basis = 'fresh';
      const blocked = metricsFolderIsFile(nd)
        ? `${ROOT_DIR_NAME}/${METRICS_DIR} is a file, not a folder`
        : stored.state === 'blocked'
          ? `${where} is ${stored.error}`
          : null;
      if (blocked !== null) {
        headline = `metrics: ⚠ the snapshot cannot be stored — ${blocked}`;
      } else {
        const changed = storedSnapshot === null || !sameMetrics(storedSnapshot, result.value);
        const next: Snapshot = changed || storedSnapshot === null ? { ...result.value, updated: today } : storedSnapshot;
        snapshot = { state: 'ok', snapshot: next };
        if (changed) {
          const state = stored.state === 'ok' ? 'out of date' : stored.state === 'absent' ? 'missing' : 'unreadable';
          fixes.push({ path: snapshotPath(nd), label: `${METRICS_DIR}/${METRICS_SNAPSHOT}: ${state}`, next: renderSnapshot(next) });
        }
        headline = freshHeadline(stored, changed, opts.check, where);
        const growth = growthSince(nd, committed, storedSnapshot, result.value, history);
        lines.push(...growth.lines);
        actions.push(...growth.actions);
      }
    }
  } else if (storedSnapshot !== null || config.budget !== null) {
    headline =
      'metrics: ⚠ no "metrics" command is set in novadev.json — nothing refreshes the snapshot or measures the debt';
  }

  // A snapshot nobody can read, which this sync cannot write again either (merge-conflict markers,
  // most likely). Not a sync failure — the command may simply not run here — but the gate fails.
  if (snapshot.state === 'invalid') {
    headline ??= `metrics: ⚠ ${where} cannot be read`;
    actions.push(
      `${METRICS_DIR}/${METRICS_SNAPSHOT} cannot be read (${snapshot.error}) — if it holds merge-conflict markers, keep one side; or delete it, and \`novadev sync\` writes it again once the metrics command works`,
    );
    failures.push(`${METRICS_DIR}/${METRICS_SNAPSHOT} cannot be read`);
  }

  let budget = config.budget;
  let overBudget = false;
  if (budget !== null) {
    const known = measured?.debt?.known ?? null;
    const found = collectRaises(nd, history);
    const plan = planRaises(budget, found.raises, known, today);
    for (const outcome of plan.outcomes) {
      const line = describeRaise(outcome, budget.maxKnown, !opts.check);
      if (line !== null) lines.push(line);
      // The budget is derived from the records, like the snapshot: `--check` judges it as sync
      // would write it, and fails while sync has not. A raise committed before sync writes it is
      // an earlier round's raise at once, so the commit's own check would pass and the next fail.
      if (opts.check && outcome.status === 'applied') {
        failures.push(
          `the raise in ${outcome.raise.ref} is not written to novadev.json yet — run \`novadev sync\`, then commit novadev.json with the record`,
        );
      }
    }
    if (plan.changed && !opts.check) writeBudget(nd, plan.budget);
    budget = plan.budget;

    const source = basis === 'stored' ? ' (stored snapshot)' : basis === 'committed' ? " (the last commit's snapshot)" : '';
    if (known === null) {
      // A budget nothing measures is a gate that is off without anyone saying so.
      const why =
        measured !== null
          ? 'the metrics have no "debt" count'
          : config.command === null
            ? 'no "metrics" command is set, and no snapshot is stored'
            : 'the metrics command gave no numbers, and no snapshot is stored';
      const fix =
        config.command === null
          ? 'set a "metrics" command that prints "debt"'
          : measured !== null
            ? 'make the metrics command print "debt"'
            : 'make the metrics command work';
      lines.push(`debt budget: not checked — ${why}`);
      actions.push(`the debt budget cannot be checked: ${why} — ${fix}, or set "debtBudget" to null in novadev.json`);
      failures.push('the debt budget cannot be checked');
    } else if (known > budget.maxKnown) {
      overBudget = true;
      lines.push(`✗ known debt ${fmt(known)} is over the budget ${fmt(budget.maxKnown)}${source}`);
      actions.push(overBudgetAction(budget, found.raises, found.broken, known));
    } else {
      lines.push(`debt budget: known debt ${fmt(known)} of ${fmt(budget.maxKnown)} ✓${source}`);
      // The budget only moves down by hand, so a gain is kept only when someone lowers it. Only
      // fresh numbers ask for that: a stored count can be older than the code.
      if (known < budget.maxKnown && basis === 'fresh') {
        actions.push(
          `known debt ${fmt(known)} is under the budget ${fmt(budget.maxKnown)} — lower "maxKnown" to ${known} in novadev.json, so the gain is kept`,
        );
      }
    }
  }

  // The view is what the files hold once this sync is done: the snapshot sync stores, and the
  // budget it writes. With --check nothing is written, and both are judged as sync would write
  // them — so a stale snapshot, and a wiki block that does not show a raise yet, fail the gate.
  return { headline, lines, actions, overBudget, fixes, failures, view: { snapshot, budget } };
}

function freshHeadline(stored: SnapshotRead, changed: boolean, check: boolean, where: string): string {
  if (stored.state === 'invalid') {
    return check
      ? `metrics: the stored snapshot cannot be read (${stored.error}) — \`novadev sync\` writes it again in ${where}`
      : `metrics: snapshot written again — ${where} could not be read (${stored.error})`;
  }
  if (stored.state === 'absent') {
    return check
      ? `metrics: no snapshot is stored yet — \`novadev sync\` stores the first one in ${where}`
      : `metrics: first snapshot stored — ${where}`;
  }
  if (!changed) return 'metrics: no change since the last snapshot';
  return check
    ? `metrics: changed since the stored snapshot — \`novadev sync\` stores the new one in ${where}`
    : `metrics: snapshot updated — ${where}`;
}

/** What the checks use when the command gave no numbers this run. */
function keptLine(stored: SnapshotRead, basis: Basis | null): string {
  if (basis === 'stored' && stored.state === 'ok') {
    const when = stored.snapshot.updated ? ` (${stored.snapshot.updated})` : '';
    return `the snapshot was not updated; the checks below use the stored one${when}`;
  }
  const why =
    stored.state === 'invalid' || stored.state === 'blocked'
      ? `the stored ${METRICS_SNAPSHOT} cannot be read either (${stored.error})`
      : stored.state === 'ok'
        ? 'the stored snapshot has no "debt" count'
        : 'no snapshot is stored';
  if (basis === 'committed') return `${why}; the checks below use the last commit's`;
  return stored.state === 'absent' ? 'there is no stored snapshot yet' : why;
}

/**
 * What changed in this round, and what grew with no explanation yet. The round is everything since
 * the last commit: compared with the committed snapshot, a hub that grew stays on the list on every
 * sync until a record names it in a `## Debt` section in words the last commit does not hold — or
 * the growth is undone. Without git (or before the first snapshot is committed), the comparison is
 * with the stored snapshot, and a change is listed once.
 */
function growthSince(
  nd: string,
  committed: Metrics | null,
  stored: Snapshot | null,
  fresh: Metrics,
  history: RecordHistory,
): { lines: string[]; actions: string[] } {
  const base = committed ?? stored;
  if (base === null) return { lines: [], actions: [] };
  const deltas = diffMetrics(base, fresh);
  if (deltas.length === 0) return { lines: [], actions: [] };

  const notes = committed ? debtNotes(nd, history) : debtNotes(nd);
  const lines = committed ? ['since the last commit:'] : [];
  const actions: string[] = [];
  for (const delta of deltas) {
    const by = delta.grew
      ? notes.find((note) => delta.hub === undefined || mentions(note.text, delta.hub))?.ref
      : undefined;
    lines.push(`${delta.grew ? '↑' : '↓'} ${delta.text}${by ? ` — explained in ${by}` : ''}`);
    if (delta.grew && by === undefined) actions.push(`${delta.text} — ${delta.advice}`);
  }
  return { lines, actions };
}

/**
 * One line about one raise a record asks for, or null when there is nothing to say (sync no longer
 * reads a raise the last commit holds). `written`: plain sync, which writes the budget; `--check`
 * does not.
 */
export function describeRaise(outcome: RaiseOutcome, budget: number, written: boolean): string | null {
  const { raise } = outcome;
  switch (outcome.status) {
    case 'applied': {
      const capped =
        outcome.applied < raise.to
          ? ` (it asks for ${fmt(raise.to)}, above the measured debt — a raise stops there)`
          : '';
      return written
        ? `debt budget raised ${fmt(raise.from)} → ${fmt(outcome.applied)} by ${raise.ref}${capped}`
        : `debt budget: ${raise.ref} raises it ${fmt(raise.from)} → ${fmt(outcome.applied)}${capped} — not written yet: \`novadev sync\` writes it to novadev.json`;
    }
    case 'stale':
      return `debt budget: ${raise.ref} raises it from ${fmt(raise.from)}, but the budget is ${fmt(budget)} — not applied; if it is still needed, make it "**Raise:** ${budget} → <the new budget>"`;
    case 'not-needed':
      return outcome.spent
        ? `debt budget: ${raise.ref} asks for ${fmt(raise.to)}, but known debt is within the budget — not needed, so not applied; without git, sync cannot tell one round from the next, so ${written ? 'this raise is used up now' : '`novadev sync` marks this raise used up'} and it does not count later`
        : `debt budget: ${raise.ref} asks for ${fmt(raise.to)}, but known debt is within the budget — not needed now; it still counts until it is committed`;
    case 'unmeasured':
      return `debt budget: ${raise.ref} asks for ${fmt(raise.to)} — not applied: there is no debt count to check it against`;
    case 'earlier':
      return null;
  }
}

/**
 * The NEXT ACTION for known debt over the budget. It never asks for something the records cannot
 * give: when a record of this round already has a raise line, it says to change that line, not to
 * add a second one (two raise lines are an error).
 */
function overBudgetAction(
  budget: DebtBudget,
  found: readonly RecordRaise[],
  broken: readonly BrokenRaise[],
  known: number,
): string {
  const over = `known debt ${fmt(known)} is over the budget ${fmt(budget.maxKnown)} — `;
  const wanted = `**Raise:** ${budget.maxKnown} → ${known}`;
  const current = found.filter((raise) => raise.round !== 'earlier');
  // The one raise a record cannot repeat: the exact one it already made, before someone lowered the
  // budget again (or, without git, the one sync used up while it was not needed). Asking for it once
  // more would send the agent in a circle, so say why instead.
  for (const raise of current) {
    if (raise.from !== budget.maxKnown || raise.to !== known) continue;
    const entry = ledgerEntryFor(budget, raise);
    if (!entry) continue;
    const why =
      entry.applied === entry.from
        ? `asked for ${fmt(raise.from)} → ${fmt(raise.to)} on ${entry.on}, while known debt was within the budget; without git, sync cannot tell one round from the next, so that raise was used up then`
        : `already raised it ${fmt(raise.from)} → ${fmt(raise.to)} on ${entry.on}, and the budget was lowered after that, so that raise does not count again`;
    return `${over}${raise.ref} ${why}: reduce the debt, or raise the budget in another record, with the reason`;
  }
  const unreadable = broken.find((raise) => raise.round !== 'earlier');
  if (unreadable) {
    return `${over}reduce it, or fix the raise line in ${unreadable.ref}/${unreadable.file} (see PROBLEMS) so it reads "${wanted}"`;
  }
  // A record of this round already raises the budget, but not far enough (or from another budget):
  // its line gets new numbers. The highest raise is the one the agent meant last.
  const mine = [...current].sort((a, b) => b.to - a.to || byCodePoint(b.ref, a.ref))[0];
  if (mine) {
    return `${over}reduce it, or change the raise line in ${mine.ref}/${mine.file} to "${wanted}" and say why — keep one raise line`;
  }
  // A raise of an earlier round that never applied is easy to mistake for this round's: say why it
  // does not count. One that applied in its own round needs no word — the budget already holds it.
  const earlier = found.find((raise) => raise.round === 'earlier' && !ledgerEntryFor(budget, raise));
  const note = earlier
    ? ` (the raise in ${earlier.ref} does not count: it was committed in an earlier round)`
    : '';
  return `${over}reduce it, or raise the budget in this round's record: add a "## Debt" section with "${wanted}" and the reason${note}`;
}

function lastLines(text: string, count: number): string {
  return text
    .trim()
    .split('\n')
    .slice(-count)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' / ')
    .slice(0, 300);
}
