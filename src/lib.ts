// Shared helpers for the novadev CLI. Zero dependencies — Bun + node:fs only.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export const ROOT_DIR_NAME = '.novadev';
export const NOVADEV_VERSION = '0.4.0';

/** Batch folder name contract: YYYY-MM-DD_N (N = same-day sequence number, 1-based). */
export const BATCH_RE = /^(\d{4})-(\d{2})-(\d{2})_(\d+)$/;

export const RECORD_COMPLETED = 'ai_completed.md';
export const RECORD_FAILED = 'ai_failed.md';
export const RECORD_PROGRESS = 'ai_progress.md';
/** Human-verification gate: work landed, but a person must still test it. */
export const RECORD_NEEDSTEST = 'ai_needstest.md';
/** The gate, closed: a person tested it and the results were reviewed. */
export const RECORD_CONFIRMED = 'ai_confirmed.md';

/** The strict wiki page set. INDEX.md is the load-first map; the rest are the mandated pages. */
export const WIKI_PAGES = [
  'INDEX.md',
  'overview.md',
  'stack.md',
  'architecture.md',
  'conventions.md',
  'workflows.md',
  'glossary.md',
] as const;

/** Canonical skill playbooks shipped into <root>/skills/. */
export const SKILLS = [
  {
    file: 'workflow.md',
    slug: 'novadev-workflow',
    description:
      'Execute novadev todo briefs and chat-initiated work: pre-context loading (wiki, memories, postponed), doing the work, filing chat requests as todos with transcribed briefs, writing ai_completed/ai_failed/ai_progress records, and auto-writing memories. The always-applied core rule of the novadev system.',
  },
  {
    file: 'wiki-init.md',
    slug: 'novadev-wiki-init',
    description:
      'Create the novadev project wiki from scratch with its strict page structure (INDEX, overview, stack, architecture, conventions, workflows, glossary). Mandatory before any todo work when the wiki is missing.',
  },
  {
    file: 'wiki-update.md',
    slug: 'novadev-wiki-update',
    description:
      'Refresh the novadev wiki after landed work changed reality: diff pages against the current project, edit only the affected pages, keep INDEX one-liners in sync.',
  },
  {
    file: 'wiki-compact.md',
    slug: 'novadev-wiki-compact',
    description:
      'Compact the novadev wiki: merge redundant content, delete stale detail, enforce page size budgets, keep the INDEX tight so pre-context stays cheap to load.',
  },
  {
    file: 'memories-review.md',
    slug: 'novadev-memories-review',
    description:
      'Actualize the novadev memories folder: verify each memory is still true against the current project, update or rewrite stale ones, delete junk and irrelevant ones, resync the INDEX.',
  },
  {
    file: 'debt-scan.md',
    slug: 'novadev-debt-scan',
    description:
      'Sweep the project for technical debt (code, records, postponed items) and author a new batch of novadev todo briefs out of the confirmed findings. Scan-and-file only — no fixing.',
  },
  {
    file: 'feature-init.md',
    slug: 'novadev-feature-init',
    description:
      'Create the novadev features registry from scratch: reverse-engineer the shipped feature set from the code, wiki, and archived records, and write one FEAT-NNNN file per feature plus the searchable INDEX. Mandatory before feature work when features/INDEX.md is missing.',
  },
  {
    file: 'feature-check.md',
    slug: 'novadev-feature-check',
    description:
      'Pre-flight a PROPOSED feature against the novadev features registry before building it: find duplicates, overlapping code surface, conflicting behavior, and superseded predecessors, then return a build/extend/supersede/drop verdict. Run before designing anything new.',
  },
  {
    file: 'feature-update.md',
    slug: 'novadev-feature-update',
    description:
      'Keep the novadev features registry true after work lands: flip feature status, append the progress log, author the record-to-feature links, and regenerate derived backlinks. Also runs a full registry audit on request.',
  },
  {
    file: 'test-plan.md',
    slug: 'novadev-test-plan',
    description:
      'Decide what a person still has to verify by hand after work lands, and file it as a novadev test task: a stepped test-plan.md with pass/fail expectations per scenario in totest/, plus the ai_needstest.md gate on the originating todo. Run when concluding work an agent could not fully verify.',
  },
  {
    file: 'review-tests.md',
    slug: 'novadev-review-tests',
    description:
      "Read the human's test results in a novadev totest task, judge each scenario against its expected outcome, and close the loop: write ai_confirmed.md on the original todo and file follow-up todos for whatever failed. Invoked explicitly by the human once they have finished testing.",
  },
  {
    file: 'links-audit.md',
    slug: 'novadev-links-audit',
    description:
      'Audit and repair the whole novadev link graph on demand: records to features, features to work and commits, memories, postponed items and the wiki — resolve every reference, regenerate derived backlinks, and investigate what tooling cannot fix mechanically.',
  },
] as const;

// ---------------------------------------------------------------------------
// Features registry
// ---------------------------------------------------------------------------

/** Feature file name contract: FEAT-NNNN-<slug>.md (the ID prefix must match frontmatter `id`). */
export const FEATURE_FILE_RE = /^(FEAT-\d{4})-[a-z0-9][a-z0-9-]*\.md$/;
export const FEATURE_ID_RE = /^FEAT-\d{4}$/;

export const FEATURE_STATUSES = ['planned', 'in-progress', 'shipped', 'deprecated'] as const;
export type FeatureStatus = (typeof FEATURE_STATUSES)[number];

export const FEATURE_REQUIRED_KEYS = ['id', 'title', 'status', 'area', 'created', 'updated'] as const;
/** Frontmatter keys whose values are FEAT-ID references to other features. */
export const FEATURE_REF_KEYS = ['depends-on', 'supersedes', 'superseded-by', 'conflicts-with'] as const;

export type Feature = {
  id: string;
  file: string;
  path: string;
  title: string;
  status: string;
  area: string;
  tags: string[];
  touches: string[];
  refs: Record<string, string[]>;
  fm: Record<string, string>;
  text: string;
};

export function featuresDir(nd: string): string {
  return join(nd, 'features');
}

export function listFeatures(nd: string): Feature[] {
  const dir = featuresDir(nd);
  const out: Feature[] = [];
  for (const file of listFiles(dir)) {
    if (!file.endsWith('.md') || file === 'INDEX.md' || file === 'README.md') continue;
    const path = join(dir, file);
    const fm = readFrontmatter(path) ?? {};
    const refs: Record<string, string[]> = {};
    for (const key of FEATURE_REF_KEYS) refs[key] = featureIdsIn(fm[key] ?? '');
    out.push({
      id: fm.id ?? file.match(FEATURE_FILE_RE)?.[1] ?? file.replace(/\.md$/, ''),
      file,
      path,
      title: fm.title ?? '',
      status: fm.status ?? '',
      area: fm.area ?? '',
      tags: csvList(fm.tags),
      touches: csvList(fm.touches),
      refs,
      fm,
      text: readFileSync(path, 'utf8'),
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/** Next free feature ID, one past the highest currently on disk. */
export function nextFeatureId(nd: string): string {
  let max = 0;
  for (const f of listFeatures(nd)) {
    const m = f.id.match(/^FEAT-(\d{4})$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `FEAT-${String(max + 1).padStart(4, '0')}`;
}

// ---------------------------------------------------------------------------
// totest — the human-verification queue
// ---------------------------------------------------------------------------

/**
 * One LIVING test task per feature — named after it, never date-stamped. New work on a
 * feature revises the existing plan in place (old scenarios that the change invalidated
 * are rewritten or dropped) rather than piling up a second folder: a plan describing
 * behaviour that no longer exists is worse than no plan, because the human walks it,
 * hits the old expectation, and reports a failure that is really just a stale scenario.
 */
export const TEST_TASK_RE = /^(FEAT-\d{4}-)?[a-z0-9][a-z0-9-]*$/;
/** The 0.4.0 round-per-folder naming, kept only to give a useful migration error. */
export const LEGACY_TEST_TASK_RE = /^\d{4}-\d{2}-\d{2}_/;
export const TEST_PLAN_FILE = 'test-plan.md';
export const TEST_RESULTS_DIR = 'test-results';
export const TEST_HISTORY_DIR = 'history';
export const TEST_STATUSES = ['awaiting-test', 'reviewed'] as const;
export const TEST_PLAN_REQUIRED_KEYS = ['id', 'created', 'updated', 'status', 'revision'] as const;

export type TestTask = {
  id: string;
  dir: string;
  planPath: string;
  status: string;
  /** Todos gated on the CURRENT round — several may share one task. */
  todoRefs: string[];
  featureIds: string[];
  revision: number;
  lastTested: string;
  scenarios: number;
  /** Files a human dropped in test-results/ — README.md is the seeded guide, not a result. */
  results: string[];
  hasResults: boolean;
  /** Past rounds kept under history/<stamp>/ — plan snapshot + that round's results. */
  rounds: string[];
  archived: boolean;
  fm: Record<string, string>;
};

export function totestDir(nd: string): string {
  return join(nd, 'totest');
}

export function listTestTasks(nd: string, includeArchived = false): TestTask[] {
  const out: TestTask[] = [];
  const collect = (dir: string, archived: boolean) => {
    for (const id of listDirs(dir)) {
      const taskDir = join(dir, id);
      const planPath = join(taskDir, TEST_PLAN_FILE);
      const fm = existsSync(planPath) ? (readFrontmatter(planPath) ?? {}) : {};
      const plan = existsSync(planPath) ? readFileSync(planPath, 'utf8') : '';
      const results = listFiles(join(taskDir, TEST_RESULTS_DIR)).filter((f) => f !== 'README.md');
      out.push({
        id,
        dir: taskDir,
        planPath,
        status: fm.status ?? '',
        todoRefs: csvList(fm.todos ?? fm.todo),
        featureIds: featureIdsIn(`${fm.feature ?? ''} ${id}`),
        revision: Number(fm.revision ?? '') || 0,
        lastTested: (fm['last-tested'] ?? '').trim(),
        scenarios: (plan.match(/^##\s+Scenario\b/gim) ?? []).length,
        results,
        hasResults: results.length > 0,
        rounds: listDirs(join(taskDir, TEST_HISTORY_DIR)),
        archived,
        fm,
      });
    }
  };
  collect(totestDir(nd), false);
  if (includeArchived) {
    for (const year of listDirs(join(nd, 'archive'))) {
      collect(join(nd, 'archive', year, 'totest'), true);
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------------------
// Link graph primitives
// ---------------------------------------------------------------------------

/**
 * Links are STABLE IDS, never relative paths: `novadev archive` moves a batch from
 * todos/ to archive/<year>/ and changes its depth, which would break every relative
 * link pointing in or out of it. IDs survive the move; the resolvers below find the
 * target wherever it currently lives.
 */
export type TodoRef = { batch: string; todo: string; ref: string; dir: string; archived: boolean };

/** Every todo folder in the project, in todos/ and archive/<year>/ alike. */
export function listAllTodos(nd: string): TodoRef[] {
  const out: TodoRef[] = [];
  const collect = (batchesDir: string, archived: boolean) => {
    for (const batch of listDirs(batchesDir)) {
      for (const todo of listDirs(join(batchesDir, batch))) {
        out.push({
          batch,
          todo,
          ref: `${batch}/${todo}`,
          dir: join(batchesDir, batch, todo),
          archived,
        });
      }
    }
  };
  collect(join(nd, 'todos'), false);
  for (const year of listDirs(join(nd, 'archive'))) collect(join(nd, 'archive', year), true);
  return out;
}

/** Pull `**Field:** value` out of a markdown document (the authored-link syntax). */
export function readField(text: string, name: string): string | null {
  const m = text.match(new RegExp(`^\\*\\*${name}:\\*\\*[ \\t]*(.*)$`, 'mi'));
  return m ? m[1].trim() : null;
}

/** FEAT-IDs mentioned anywhere in a string — tolerant of prose around them. */
export function featureIdsIn(value: string): string[] {
  return [...new Set((value.match(/FEAT-\d{4}/g) ?? []))];
}

/** Commit hashes mentioned in a string (7–40 hex chars). */
export function commitHashesIn(value: string): string[] {
  return [...new Set((value.match(/\b[0-9a-f]{7,40}\b/g) ?? []))];
}

/** Split a comma-separated frontmatter value; "none"/"-"/empty yield []. */
export function csvList(value: string | undefined | null): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s !== 'none' && s !== '-');
}

/** Do two repo paths cover common ground (equal, or one inside the other)? */
export function pathsOverlap(a: string, b: string): boolean {
  const norm = (p: string) => p.replace(/^\.\//, '').replace(/\/+$/, '');
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  return na === nb || na.startsWith(nb + '/') || nb.startsWith(na + '/');
}

// ---------------------------------------------------------------------------
// Derived (regenerable) content blocks
// ---------------------------------------------------------------------------

/**
 * Bidirectional links only stay true if ONE side is authored and the other is derived.
 * Authored: the record's `**Feature:**` line. Derived: the feature's Work/Commits blocks
 * and features/INDEX.md, all fenced by these markers and rewritten by `novadev links --fix`.
 */
export function blockBegin(name: string): string {
  return `<!-- novadev:${name}:begin -->`;
}
export function blockEnd(name: string): string {
  return `<!-- novadev:${name}:end -->`;
}

/** Current content between a block's markers, or null when the block is absent. */
export function readBlock(text: string, name: string): string | null {
  const b = text.indexOf(blockBegin(name));
  const e = text.indexOf(blockEnd(name));
  if (b === -1 || e === -1 || e < b) return null;
  return text.slice(b + blockBegin(name).length, e).trim();
}

/** Replace a block's content, keeping the markers. Returns null when the block is absent. */
export function writeBlock(text: string, name: string, body: string): string | null {
  const b = text.indexOf(blockBegin(name));
  const e = text.indexOf(blockEnd(name));
  if (b === -1 || e === -1 || e < b) return null;
  return text.slice(0, b + blockBegin(name).length) + '\n' + body.trim() + '\n' + text.slice(e);
}

/** Walk up from cwd to find the directory that CONTAINS <root>/ (the project root). */
export function findProjectRoot(from: string = process.cwd()): string | null {
  let dir = resolve(from);
  for (;;) {
    if (existsSync(join(dir, ROOT_DIR_NAME))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function requireProjectRoot(): string {
  const root = findProjectRoot();
  if (!root) {
    fail(
      `no ${ROOT_DIR_NAME}/ found in this directory or any parent. Run \`novadev deploy\` in the project root first.`,
    );
  }
  return root!;
}

export function novadevDir(projectRoot: string): string {
  return join(projectRoot, ROOT_DIR_NAME);
}

export function fail(message: string): never {
  console.error(`novadev: ${message}`);
  process.exit(1);
}

export function listDirs(path: string): string[] {
  if (!existsSync(path)) return [];
  return readdirSync(path)
    .filter((name) => statSync(join(path, name)).isDirectory())
    .sort();
}

export function listFiles(path: string): string[] {
  if (!existsSync(path)) return [];
  return readdirSync(path)
    .filter((name) => statSync(join(path, name)).isFile())
    .sort();
}

export type TodoState =
  | 'needstest'
  | 'confirmed'
  | 'completed'
  | 'failed'
  | 'progress'
  | 'open';

/**
 * `needstest` outranks everything: the gate coexists with the work record it gates,
 * and while it is open the todo is waiting on a person, not on an agent.
 */
export function todoState(todoDir: string): TodoState {
  if (existsSync(join(todoDir, RECORD_NEEDSTEST))) return 'needstest';
  if (existsSync(join(todoDir, RECORD_CONFIRMED))) return 'confirmed';
  if (existsSync(join(todoDir, RECORD_COMPLETED))) return 'completed';
  if (existsSync(join(todoDir, RECORD_FAILED))) return 'failed';
  if (existsSync(join(todoDir, RECORD_PROGRESS))) return 'progress';
  return 'open';
}

/** States that end a todo. `needstest` is deliberately NOT one — a pending human
 *  test must keep its batch out of the archive, or the hand-off is lost. */
export const TERMINAL_STATES: readonly TodoState[] = ['confirmed', 'completed', 'failed'];

/** A batch is archivable when every todo folder inside carries a terminal record. */
export function batchIsDone(batchDir: string): boolean {
  const todos = listDirs(batchDir);
  if (todos.length === 0) return false;
  return todos.every((t) => TERMINAL_STATES.includes(todoState(join(batchDir, t))));
}

export function todayStamp(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Minimal YAML frontmatter reader: returns null when the file has no `---` header. */
export function readFrontmatter(filePath: string): Record<string, string> | null {
  const text = readFileSync(filePath, 'utf8');
  if (!text.startsWith('---')) return null;
  const end = text.indexOf('\n---', 3);
  if (end === -1) return null;
  const header = text.slice(3, end);
  const out: Record<string, string> = {};
  for (const line of header.split('\n')) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

/**
 * Update frontmatter keys in place, preserving key order and the body. Keys that are
 * absent get appended to the header. Returns the text unchanged if it has no header.
 */
export function setFrontmatter(text: string, updates: Record<string, string>): string {
  if (!text.startsWith('---')) return text;
  const end = text.indexOf('\n---', 3);
  if (end === -1) return text;
  const seen = new Set<string>();
  const lines = text
    .slice(3, end)
    .split('\n')
    .map((line) => {
      const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (m && updates[m[1]] !== undefined) {
        seen.add(m[1]);
        return `${m[1]}: ${updates[m[1]]}`;
      }
      return line;
    });
  for (const [key, value] of Object.entries(updates)) {
    if (!seen.has(key)) lines.push(`${key}: ${value}`);
  }
  return '---' + lines.join('\n') + text.slice(end);
}

/** Directory of the installed novadev package itself (for reading templates/). */
export function packageDir(): string {
  return resolve(dirname(new URL(import.meta.url).pathname), '..');
}
