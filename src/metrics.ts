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
// `novadev sync` runs the command, compares the result with `.novadev/metrics/latest.json`, stores
// the new snapshot there (tracked, so the change is in the commit's diff), and lists what GREW
// under NEXT ACTIONS. A missing or failing command is a warning, never a sync failure.
//
// What can be judged from the files alone — doctor's view and the wiki budgets block — is
// metrics-audit.ts.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type DebtBudget,
  applyRaises,
  collectRaises,
  parseBudget,
  pendingRaises,
  writeBudget,
} from './debt-budget.ts';
import {
  type Parsed,
  byCodePoint,
  isCount,
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
      rawPage !== 'INDEX.md' &&
      rawPage !== 'README.md'
    ) {
      wikiPage = rawPage;
    } else {
      problems.push(
        'novadev.json: "metricsWikiPage" must be the file name of a wiki page (like "architecture.md", not INDEX.md), or false for no budgets block',
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
      if (seen.has(name)) return refuse(`two hubs are named "${name}" — every hub name must be unique`);
      seen.add(name);
      const measure = entry.measure;
      if (typeof measure !== 'number' || !Number.isFinite(measure) || measure < 0) {
        return refuse(`hub "${name}": "measure" must be a number, 0 or more`);
      }
      const over = entry.over ?? [];
      if (!Array.isArray(over) || over.some((axis) => typeof axis !== 'string' || axis.trim() === '')) {
        return refuse(`hub "${name}": "over" must be a list of names, like ["loc"]`);
      }
      const hub: Hub = {
        name,
        measure,
        over: [...new Set((over as string[]).map((axis) => axis.trim()))].sort(byCodePoint),
      };
      if (entry.path !== undefined && entry.path !== null) {
        if (typeof entry.path !== 'string' || entry.path.trim() === '') {
          return refuse(`hub "${name}": "path" must be a repo path (a string)`);
        }
        hub.path = entry.path.trim().replace(/^\.\//, '');
      }
      hubs.push(hub);
    }
  }
  hubs.sort((a, b) => byCodePoint(a.name, b.name));
  return { ok: true, value: { ...(debt ? { debt } : {}), hubs } };
}

export type CommandResult = { ok: true; value: Metrics } | { ok: false; error: string };

/** Run the configured command from the project root and read its JSON. Never throws. */
export function runMetricsCommand(root: string, command: string, timeoutSeconds: number): CommandResult {
  const run = spawnSync(command, {
    cwd: root,
    shell: true,
    encoding: 'utf8',
    timeout: Math.round(timeoutSeconds * 1000),
    maxBuffer: MAX_OUTPUT_BYTES,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const tail = lastLines(run.stderr ?? '', 3);
  if (run.error) {
    const code = (run.error as NodeJS.ErrnoException).code;
    if (code === 'ETIMEDOUT') {
      return refuse(
        `\`${command}\` did not finish within ${timeoutSeconds} s (raise "metricsTimeoutSeconds" if it needs longer)`,
      );
    }
    return refuse(`\`${command}\` could not run: ${run.error.message}`);
  }
  if (run.status !== 0) {
    const how = run.status === null ? `was stopped (${run.signal ?? 'signal'})` : `exited with ${run.status}`;
    return refuse(`\`${command}\` ${how}${tail ? ` — ${tail}` : ''}`);
  }
  const parsed = parseMetricsOutput(run.stdout ?? '');
  return parsed.ok ? parsed : refuse(`\`${command}\`: ${parsed.error}`);
}

// ---------------------------------------------------------------------------
// The stored snapshot
// ---------------------------------------------------------------------------

export function snapshotPath(nd: string): string {
  return join(nd, METRICS_DIR, METRICS_SNAPSHOT);
}

export type SnapshotRead =
  | { state: 'absent' }
  | { state: 'invalid'; error: string }
  | { state: 'ok'; snapshot: Snapshot };

export function readSnapshot(nd: string): SnapshotRead {
  const path = snapshotPath(nd);
  if (!existsSync(path)) return { state: 'absent' };
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

export function writeSnapshot(nd: string, snapshot: Snapshot): void {
  mkdirSync(join(nd, METRICS_DIR), { recursive: true });
  writeFileSync(snapshotPath(nd), renderSnapshot(snapshot));
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
  /** True when something got bigger or worse — these become NEXT ACTIONS. */
  grew: boolean;
  /** "known debt 230 → 238 (+8)", "hub Workbench 11,019 → 11,140 (+121)". */
  text: string;
  /** What the agent should do about it, appended to the NEXT ACTIONS line. */
  advice: string;
};

export function diffMetrics(prev: Metrics, next: Metrics): Delta[] {
  const out: Delta[] = [];
  const debtAdvice = 'it grew: explain why in this round\'s record, or reduce it';

  if (prev.debt && next.debt) {
    if (prev.debt.known !== next.debt.known) {
      out.push({
        grew: next.debt.known > prev.debt.known,
        text: `known debt ${change(prev.debt.known, next.debt.known)}`,
        advice: debtAdvice,
      });
    }
    if (prev.debt.new !== undefined && next.debt.new !== undefined && prev.debt.new !== next.debt.new) {
      out.push({
        grew: next.debt.new > prev.debt.new,
        text: `new debt ${change(prev.debt.new, next.debt.new)}`,
        advice: debtAdvice,
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
        advice: 'a hub grew: explain in the record why the change belongs there, or move it to a smaller unit',
      });
    } else if (b) {
      out.push({
        grew: true,
        text: `hub ${name} ${fmt(b.measure)} is new${b.over.length > 0 ? ` (over ${b.over.join(', ')})` : ''}`,
        advice: 'a new hub: explain in the record why, or split it',
      });
    } else if (a) {
      out.push({ grew: false, text: `hub ${name} is gone (was ${fmt(a.measure)})`, advice: '' });
    }
  }
  return out;
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

export type MetricsRun = {
  /** The first line of the metrics block, or null when metrics are off and nothing is stored. */
  headline: string | null;
  /** The lines under it: every change, the budget state, warnings. */
  lines: string[];
  /** NEXT ACTIONS: what grew, and a debt budget that is exceeded. */
  actions: string[];
  /** Known debt is over the budget (after any raise a record asks for) — fails `sync --check`. */
  overBudget: boolean;
};

/**
 * The metrics half of `novadev sync`: run the command, compare, store, apply budget raises.
 * With `check`, nothing is written — the comparison and the budget check still run.
 */
export function refreshMetrics(
  root: string,
  opts: { check: boolean; today?: string; onRun?: (command: string) => void },
): MetricsRun {
  const nd = novadevDir(root);
  const today = opts.today ?? todayStamp();
  const config = readMetricsConfig(nd);
  const stored = readSnapshot(nd);
  const storedSnapshot = stored.state === 'ok' ? stored.snapshot : null;
  const lines: string[] = [];
  const actions: string[] = [];
  let headline: string | null = null;

  // What the budget is checked against: fresh numbers when the command worked, else the stored ones.
  let measured: Metrics | null = storedSnapshot;
  let measuredFresh = false;

  if (config.command !== null) {
    opts.onRun?.(config.command);
    const result = runMetricsCommand(root, config.command, config.timeoutSeconds);
    if (!result.ok) {
      headline = `metrics: ⚠ the command failed — ${result.error}`;
      lines.push(
        storedSnapshot
          ? `the snapshot was not updated; the checks below use the stored one${storedSnapshot.updated ? ` (${storedSnapshot.updated})` : ''}`
          : stored.state === 'invalid'
            ? `the stored ${METRICS_SNAPSHOT} cannot be read either (${stored.error})`
            : 'there is no stored snapshot yet',
      );
    } else {
      measured = result.value;
      measuredFresh = true;
      const changed = storedSnapshot === null || !sameMetrics(storedSnapshot, result.value);
      const deltas = storedSnapshot ? diffMetrics(storedSnapshot, result.value) : [];
      if (!opts.check && changed) writeSnapshot(nd, { ...result.value, updated: today });
      const where = `.novadev/${METRICS_DIR}/${METRICS_SNAPSHOT}`;
      if (storedSnapshot === null) {
        headline = opts.check
          ? `metrics: no snapshot is stored yet — \`novadev sync\` stores the first one in ${where}`
          : `metrics: first snapshot stored — ${where}`;
        if (stored.state === 'invalid') lines.push(`the old ${METRICS_SNAPSHOT} could not be read (${stored.error})`);
      } else if (!changed) {
        headline = 'metrics: no change since the last snapshot';
      } else {
        headline = opts.check
          ? `metrics: changed since the stored snapshot — \`novadev sync\` stores the new one in ${where}`
          : `metrics: snapshot updated — ${where}`;
      }
      for (const delta of deltas) {
        lines.push(`${delta.grew ? '↑' : '↓'} ${delta.text}`);
        if (delta.grew) actions.push(`${delta.text} — ${delta.advice}`);
      }
    }
  } else if (storedSnapshot !== null || config.budget !== null) {
    headline =
      'metrics: ⚠ no "metrics" command is set in novadev.json — nothing refreshes the snapshot or measures the debt';
  }

  let overBudget = false;
  if (config.budget !== null) {
    let budget = config.budget;
    const pending = pendingRaises(budget, collectRaises(nd).raises);
    if (pending.length > 0) {
      const next = applyRaises(budget, pending, today);
      if (!opts.check) writeBudget(nd, next);
      for (const entry of next.raises.slice(budget.raises.length)) {
        if (entry.to <= entry.from) {
          lines.push(`debt budget: ${entry.by} asks for ${fmt(entry.to)}; it is already ${fmt(entry.from)}`);
        } else if (opts.check) {
          lines.push(
            `debt budget: ${entry.by} raises it ${fmt(entry.from)} → ${fmt(entry.to)} — \`novadev sync\` writes that to novadev.json`,
          );
        } else {
          lines.push(`debt budget raised ${fmt(entry.from)} → ${fmt(entry.to)} by ${entry.by}`);
        }
      }
      budget = next;
    }

    const debt = measured?.debt;
    const source = measuredFresh ? '' : ' (stored snapshot)';
    if (measured === null) {
      lines.push('debt budget: not checked — there are no metrics to check it against');
    } else if (!debt) {
      lines.push('debt budget: not checked — the metrics have no "debt" count');
    } else if (debt.known > budget.maxKnown) {
      overBudget = true;
      lines.push(`✗ known debt ${fmt(debt.known)} is over the budget ${fmt(budget.maxKnown)}${source}`);
      actions.push(
        `known debt ${fmt(debt.known)} is over the budget ${fmt(budget.maxKnown)} — reduce it, or raise the budget in this round's record: add a "## Debt" section with "**Raise:** ${budget.maxKnown} → ${debt.known}" and the reason`,
      );
    } else {
      lines.push(`debt budget: known debt ${fmt(debt.known)} of ${fmt(budget.maxKnown)} ✓${source}`);
    }
  }

  return { headline, lines, actions, overBudget };
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
