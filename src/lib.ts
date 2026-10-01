// Shared helpers for the novadev CLI. Zero dependencies — Bun + node:fs only.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export const ROOT_DIR_NAME = '.novadev';
export const NOVADEV_VERSION = '0.10.0';

/** Compare dotted versions: <0 when a is older, 0 when equal, >0 when a is newer. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** `.novadev/novadev.json` — the manifest: the deployed version plus the project's settings. */
export function manifestPath(nd: string): string {
  return join(nd, 'novadev.json');
}

/** The manifest as an object, or null when it is missing, unreadable, or not a JSON object. */
export function readManifest(nd: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(readFileSync(manifestPath(nd), 'utf8'));
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Write the manifest back in the one format every writer uses (2-space JSON, trailing newline). */
export function writeManifest(nd: string, manifest: Record<string, unknown>): void {
  writeFileSync(manifestPath(nd), JSON.stringify(manifest, null, 2) + '\n');
}

/** The version recorded in the project's novadev.json, or null when absent/unreadable. */
export function deployedVersion(nd: string): string | null {
  try {
    const manifest = JSON.parse(readFileSync(join(nd, 'novadev.json'), 'utf8'));
    return typeof manifest.version === 'string' ? manifest.version : null;
  } catch {
    return null;
  }
}

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

/**
 * Canonical skill playbooks shipped into <root>/skills/, and the slash commands that route to them.
 *
 * All four are named `novadev-*` so typing `/novadev` in an agent's chat offers the whole set:
 * `-work` is the development loop, the other three are the human's own entry points into it.
 */
export const SKILLS = [
  {
    file: 'novadev-work.md',
    slug: 'novadev-work',
    description:
      'The novadev development loop — the single always-applied playbook for this project. Covers the pre-context ritual, executing todo briefs, writing ai_ records, the features registry, handing untestable work to the human via totest, reviewing their results, memories, the wiki, and the `novadev sync` close-out. Invoke it for any development work here; the human writes todo briefs and this drives everything else.',
  },
  {
    file: 'novadev-file-a-todo.md',
    slug: 'novadev-file-a-todo',
    description:
      'Turn what the user just said into a real novadev todo folder, with their screenshots and files in it. Use when they describe work they want done rather than done now — a bug, a wish, a "we should…" — and especially when they say "/novadev-file-a-todo", "file this", "make a todo of this", "note this down for later". Works in a terminal chat and through a phone-side chat plugin, where an attached photo lands in the todo folder.',
  },
  {
    file: 'novadev-what-to-test.md',
    slug: 'novadev-what-to-test',
    description:
      'Show the human-testing queue, help the user pick one scenario, walk them through it, and record what they found. Use when they say "/novadev-what-to-test", "what should I test", "what is waiting for me", "let\'s test something", or when they report the result of a test walk ("it worked", "scenario 2 failed"). Works in a terminal chat and through a phone-side chat plugin, where an attached screenshot lands beside the verdict.',
  },
  {
    file: 'novadev-test-review.md',
    slug: 'novadev-test-review',
    description:
      'Write up a round of hand-testing the user already did: they say what they tested, what passed, what broke and what they want changed, attach their screenshots, and name the feature by number or by name — this files a fully formed review into that task\'s test-results/ folder with every file attached. Use when they say "/novadev-test-review", "I tested X", "here is what I found", "passed", or hand over testing notes without walking the queue first.',
  },
] as const;

/**
 * The 0.6.0-and-earlier skill set, collapsed into the single gateway playbook in 0.7.0.
 * Deploy and `migrate-repo` delete these so no stale slash command survives an upgrade.
 */
export const LEGACY_SKILL_FILES = [
  'workflow.md',
  'wiki-init.md',
  'wiki-update.md',
  'wiki-compact.md',
  'memories-review.md',
  'debt-scan.md',
  'feature-init.md',
  'feature-check.md',
  'feature-update.md',
  'test-plan.md',
  'review-tests.md',
  'links-audit.md',
] as const;

export const LEGACY_ADAPTER_SLUGS = [
  'novadev-workflow',
  'novadev-wiki-init',
  'novadev-wiki-update',
  'novadev-wiki-compact',
  'novadev-memories-review',
  'novadev-debt-scan',
  'novadev-feature-init',
  'novadev-feature-check',
  'novadev-feature-update',
  'novadev-test-plan',
  'novadev-review-tests',
  'novadev-links-audit',
] as const;

/**
 * The 0.8.0 names the 0.9.0 four-skill split replaced. Kept apart from the LEGACY_* lists above
 * because these were not folded into anything — the playbook was RENAMED, so deploy must remove the
 * old file and the old `/novadev` slash command or the project ends up carrying both.
 */
export const RENAMED_SKILL_FILES = ['novadev.md'] as const;
export const RENAMED_ADAPTER_SLUGS = ['novadev'] as const;

// ---------------------------------------------------------------------------
// Features registry
// ---------------------------------------------------------------------------

/**
 * A feature is a FOLDER: `features/FEAT-NNNN-<slug>/` holding the hand-written
 * `feature.md` plus derived `work.md` (todos/records/commits) and `tests.md` (human
 * test rounds). Splitting the derived indexes out keeps feature.md readable once a
 * capability has accumulated twenty todos and eight test rounds.
 */
export const FEATURE_DIR_RE = /^(FEAT-\d{4})-[a-z0-9][a-z0-9-]*$/;
/** Pre-0.6.0 flat layout, kept so doctor/migrate can recognise and fix it. */
export const LEGACY_FEATURE_FILE_RE = /^(FEAT-\d{4})-[a-z0-9][a-z0-9-]*\.md$/;
export const FEATURE_ID_RE = /^FEAT-\d{4}$/;
export const FEATURE_DOC = 'feature.md';
export const FEATURE_WORK = 'work.md';
export const FEATURE_TESTS = 'tests.md';

export const FEATURE_STATUSES = ['planned', 'in-progress', 'shipped', 'deprecated'] as const;
export type FeatureStatus = (typeof FEATURE_STATUSES)[number];

export const FEATURE_REQUIRED_KEYS = ['id', 'title', 'status', 'area', 'created', 'updated'] as const;
/** Frontmatter keys whose values are FEAT-ID references to other features. */
export const FEATURE_REF_KEYS = ['depends-on', 'supersedes', 'superseded-by', 'conflicts-with'] as const;

export type Feature = {
  id: string;
  /** The folder name, e.g. FEAT-0007-magic-link — also how the feature is referenced on disk. */
  file: string;
  dir: string;
  /** Path to feature.md (the hand-written document). */
  path: string;
  workPath: string;
  testsPath: string;
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

/** Feature folders left over in the pre-0.6.0 flat layout (`features/FEAT-*.md`). */
export function legacyFeatureFiles(nd: string): string[] {
  return listFiles(featuresDir(nd)).filter((f) => LEGACY_FEATURE_FILE_RE.test(f));
}

export function listFeatures(nd: string): Feature[] {
  const dir = featuresDir(nd);
  const out: Feature[] = [];
  for (const folder of listDirs(dir)) {
    const featureDir = join(dir, folder);
    const path = join(featureDir, FEATURE_DOC);
    if (!existsSync(path)) continue;
    const fm = readFrontmatter(path) ?? {};
    const refs: Record<string, string[]> = {};
    for (const key of FEATURE_REF_KEYS) refs[key] = featureIdsIn(fm[key] ?? '');
    out.push({
      id: fm.id ?? folder.match(FEATURE_DIR_RE)?.[1] ?? folder,
      file: folder,
      dir: featureDir,
      path,
      workPath: join(featureDir, FEATURE_WORK),
      testsPath: join(featureDir, FEATURE_TESTS),
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
/** Pre-0.6.0 rounds lived inside the task; they now archive out. */
export const TEST_HISTORY_DIR = 'history';
/** Completed round folder: rev<N>-<YYYY-MM-DD>, under archive/<year>/totest/<task>/. */
export const TEST_ROUND_RE = /^rev(\d+)-(\d{4})-(\d{2})-(\d{2})$/;
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
  /** Pre-0.6.0 in-task history/ folders, if any are still lying around. */
  legacyRounds: string[];
  fm: Record<string, string>;
};

export function totestDir(nd: string): string {
  return join(nd, 'totest');
}

/** One completed, archived testing round. */
export type TestRound = {
  taskId: string;
  round: string;
  revision: number;
  date: string;
  year: string;
  dir: string;
  verdict: string;
  featureIds: string[];
  todoRefs: string[];
  results: string[];
};

/** Completed rounds under archive/<year>/totest/<task>/<round>/, newest last. */
export function listTestRounds(nd: string, taskId?: string): TestRound[] {
  const out: TestRound[] = [];
  for (const year of listDirs(join(nd, 'archive'))) {
    const totest = join(archiveYearDir(nd, year), 'totest');
    for (const task of listDirs(totest)) {
      if (taskId && task !== taskId) continue;
      for (const round of listDirs(join(totest, task))) {
        const dir = join(totest, task, round);
        const planPath = join(dir, TEST_PLAN_FILE);
        const fm = existsSync(planPath) ? (readFrontmatter(planPath) ?? {}) : {};
        const m = round.match(TEST_ROUND_RE);
        out.push({
          taskId: task,
          round,
          revision: Number(m?.[1] ?? fm.revision ?? '') || 0,
          date: m ? `${m[2]}-${m[3]}-${m[4]}` : (fm['last-tested'] ?? fm.updated ?? ''),
          year,
          dir,
          verdict: (fm.verdict ?? '').trim(),
          featureIds: featureIdsIn(`${fm.feature ?? ''} ${task}`),
          todoRefs: csvList(fm.todos ?? fm.todo),
          results: listFiles(join(dir, TEST_RESULTS_DIR)).filter((f) => f !== 'README.md'),
        });
      }
    }
  }
  return out.sort((a, b) =>
    a.taskId === b.taskId ? a.revision - b.revision : a.taskId.localeCompare(b.taskId),
  );
}

/**
 * OPEN test tasks only. `totest/` is an active queue: a task folder exists while a
 * round is in flight and is archived on review, so anything listed here is genuinely
 * waiting on a person. Completed rounds come from `listTestRounds`.
 */
export function listTestTasks(nd: string): TestTask[] {
  const out: TestTask[] = [];
  for (const id of listDirs(totestDir(nd))) {
    const taskDir = join(totestDir(nd), id);
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
      legacyRounds: listDirs(join(taskDir, TEST_HISTORY_DIR)),
      fm,
    });
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

/**
 * The archive is namespaced by kind since 0.6.0: `archive/<year>/todos/<batch>/` and
 * `archive/<year>/totest/<task>/<round>/`. Pre-0.6.0 repos put batches straight under
 * the year, so readers tolerate both and `novadev migrate-repo` moves them.
 */
export const ARCHIVE_KINDS = ['todos', 'totest'] as const;

export function archiveYearDir(nd: string, year: string): string {
  return join(nd, 'archive', year);
}

/** Every todo folder in the project, in todos/ and archive/<year>/ alike. */
export function listAllTodos(nd: string): TodoRef[] {
  const out: TodoRef[] = [];
  const collect = (batchesDir: string, archived: boolean) => {
    for (const batch of listDirs(batchesDir)) {
      if (archived && (ARCHIVE_KINDS as readonly string[]).includes(batch)) continue;
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
  for (const year of listDirs(join(nd, 'archive'))) {
    const yearDir = archiveYearDir(nd, year);
    collect(join(yearDir, 'todos'), true);
    collect(yearDir, true); // pre-0.6.0: batches sat directly under the year
  }
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

/** A fenced code block (``` or ~~~): the line it opens on, and the line it closes on — null when it never closes. */
export type Fence = { open: number; close: number | null };

/**
 * The fenced code blocks of a markdown text, in order. A fence opens with three or more backticks
 * or tildes (indented by at most three spaces) and closes with a line of the same character, at
 * least as long, and nothing else. An unclosed fence runs to the end of the text — the way markdown
 * renders it.
 */
export function fenceRanges(lines: readonly string[]): Fence[] {
  const out: Fence[] = [];
  let open: { char: string; length: number; at: number } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (open === null) {
      const start = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
      // A backtick fence's info string may not contain a backtick: "```x```" is inline code.
      if (start && !(start[1]![0] === '`' && start[2]!.includes('`'))) {
        open = { char: start[1]![0]!, length: start[1]!.length, at: i };
      }
      continue;
    }
    const end = /^ {0,3}(`{3,}|~{3,})[ \t]*\r?$/.exec(line);
    if (end && end[1]![0] === open.char && end[1]!.length >= open.length) {
      out.push({ open: open.at, close: i });
      open = null;
    }
  }
  if (open !== null) out.push({ open: open.at, close: null });
  return out;
}

/** Which lines of a markdown text are fenced code, the fence lines included (see `fenceRanges`). */
export function fencedLines(lines: readonly string[]): boolean[] {
  const fenced = lines.map(() => false);
  for (const fence of fenceRanges(lines)) {
    for (let i = fence.open; i <= (fence.close ?? lines.length - 1); i++) fenced[i] = true;
  }
  return fenced;
}

/** True when `line` is `marker` on a line of its own: indented by at most three spaces, nothing else. */
export function isMarkerLine(line: string, marker: string): boolean {
  const bare = line.replace(/[ \t\r]+$/, '');
  return bare.endsWith(marker) && /^ {0,3}$/.test(bare.slice(0, bare.length - marker.length));
}

/** Where a derived block sits in a text: nowhere, between two marker lines, or broken. */
export type BlockSpot =
  | { state: 'absent' }
  | { state: 'found'; begin: number; end: number }
  | { state: 'broken'; begins: number; ends: number };

/**
 * Find a block's two marker lines. A marker counts only on a line of its own (indented by at most
 * three spaces, as markdown allows for a comment) and outside fenced code. A page that QUOTES a
 * marker — in a sentence, in an inline code span, in a fenced example — is therefore never taken for
 * the block itself, and a rewrite can never reach the hand-written text around such a quote.
 * Anything but exactly one begin line followed by exactly one end line is `broken`.
 */
export function findBlock(lines: readonly string[], name: string): BlockSpot {
  const fenced = fencedLines(lines);
  const begins: number[] = [];
  const ends: number[] = [];
  lines.forEach((line, i) => {
    if (fenced[i]) return;
    if (isMarkerLine(line, blockBegin(name))) begins.push(i);
    else if (isMarkerLine(line, blockEnd(name))) ends.push(i);
  });
  if (begins.length === 0 && ends.length === 0) return { state: 'absent' };
  if (begins.length === 1 && ends.length === 1 && begins[0]! < ends[0]!) {
    return { state: 'found', begin: begins[0]!, end: ends[0]! };
  }
  return { state: 'broken', begins: begins.length, ends: ends.length };
}

/** What is wrong with a block that cannot be rewritten, in words — null when it can be. */
export function blockTrouble(text: string, name: string): string | null {
  const spot = findBlock(text.replace(/\r\n/g, '\n').split('\n'), name);
  if (spot.state === 'found') return null;
  if (spot.state === 'absent') return `missing ${blockBegin(name)} … ${blockEnd(name)} block`;
  return `the ${name} block markers are broken — there must be one "${blockBegin(name)}" line, then one "${blockEnd(name)}" line, each on a line of its own (found ${spot.begins} and ${spot.ends})`;
}

/**
 * Replace a block's content and keep both marker lines; everything outside them is left exactly as
 * it was. Returns null when there is no well-formed block (see `findBlock`).
 *
 * A file with CRLF line endings (a Windows checkout with core.autocrlf) keeps them: the block is
 * written in LF and the result turned back into CRLF, so an up-to-date file never reads as stale.
 */
export function writeBlock(text: string, name: string, body: string): string | null {
  const crlf = text.includes('\r\n');
  const lines = (crlf ? text.replace(/\r\n/g, '\n') : text).split('\n');
  const spot = findBlock(lines, name);
  if (spot.state !== 'found') return null;
  const next = [...lines.slice(0, spot.begin + 1), body.trim(), ...lines.slice(spot.end)].join('\n');
  return crlf ? next.replace(/\n/g, '\r\n') : next;
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

/** True for an existing folder — false for a file, a broken link, or nothing. */
export function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * The folders inside `path`, sorted. Empty when `path` is not a folder (missing, or a file where a
 * folder belongs), so one misplaced file never crashes a command; entries that cannot be read (a
 * broken link) are skipped.
 */
export function listDirs(path: string): string[] {
  return listEntries(path, 'dir');
}

/** The files inside `path`, sorted — empty when `path` is not a folder (see `listDirs`). */
export function listFiles(path: string): string[] {
  return listEntries(path, 'file');
}

function listEntries(path: string, kind: 'dir' | 'file'): string[] {
  if (!isDirectory(path)) return [];
  return readdirSync(path)
    .filter((name) => {
      try {
        const stat = statSync(join(path, name));
        return kind === 'dir' ? stat.isDirectory() : stat.isFile();
      } catch {
        return false;
      }
    })
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

/**
 * A finished batch does NOT archive immediately: it stays in `todos/` for a grace
 * period, carrying an autogenerated `completed.md`, so recent work is still visible
 * where you look for it — and so the next same-day batch number is obvious instead of
 * hidden in the archive. Configure with "archiveGraceDays" in novadev.json.
 */
export const BATCH_COMPLETE_FILE = 'completed.md';
export const ARCHIVE_GRACE_DEFAULT = 3;

export function archiveGraceDays(nd: string): number {
  try {
    const manifest = JSON.parse(readFileSync(join(nd, 'novadev.json'), 'utf8'));
    const n = Number(manifest.archiveGraceDays);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : ARCHIVE_GRACE_DEFAULT;
  } catch {
    return ARCHIVE_GRACE_DEFAULT;
  }
}

/** The date a batch was first recorded complete, from its completed.md. */
export function batchCompletedOn(batchDir: string): string | null {
  const path = join(batchDir, BATCH_COMPLETE_FILE);
  if (!existsSync(path)) return null;
  const fm = readFrontmatter(path);
  const value = (fm?.completed ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

/** Whole days from `from` (YYYY-MM-DD) to today; negative dates yield 0. */
export function daysSince(from: string): number {
  const start = Date.parse(from + 'T00:00:00Z');
  const now = Date.parse(todayStamp() + 'T00:00:00Z');
  if (Number.isNaN(start) || Number.isNaN(now)) return 0;
  return Math.max(0, Math.round((now - start) / 86400000));
}

/** Add whole days to a YYYY-MM-DD stamp. */
export function addDays(stamp: string, days: number): string {
  const t = Date.parse(stamp + 'T00:00:00Z');
  if (Number.isNaN(t)) return stamp;
  return new Date(t + days * 86400000).toISOString().slice(0, 10);
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

// ---------------------------------------------------------------------------
// Small value guards — for reading JSON a person or a command wrote
// ---------------------------------------------------------------------------

/** A plain JSON object: not null, not an array. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** A whole number, 0 or more. */
export function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/** Code-point order: the same on every machine, whatever its locale. */
export function byCodePoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** A parse that either worked or says, in words, why not. */
export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/** The failed half of `Parsed` (unlike `fail`, it does not exit the process). */
export function refuse(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

/** A derived file novadev (re)writes: where, why, and its new content. */
export type Fix = { path: string; label: string; next: string };

/** The line every file deploy manages carries. A README without it is the project's own. */
export const MANAGED_MARK = 'managed by `novadev deploy`';

/** True when the file at `path` says it is managed by `novadev deploy`. */
export function isNovadevManaged(path: string): boolean {
  try {
    return readFileSync(path, 'utf8').includes(MANAGED_MARK);
  } catch {
    return false;
  }
}

/** Directory of the installed novadev package itself (for reading templates/). */
export function packageDir(): string {
  return resolve(dirname(new URL(import.meta.url).pathname), '..');
}
