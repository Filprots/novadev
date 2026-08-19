// Shared helpers for the novadev CLI. Zero dependencies — Bun + node:fs only.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export const ROOT_DIR_NAME = '.novadev';
export const NOVADEV_VERSION = '0.2.0';

/** Batch folder name contract: YYYY-MM-DD_N (N = same-day sequence number, 1-based). */
export const BATCH_RE = /^(\d{4})-(\d{2})-(\d{2})_(\d+)$/;

export const RECORD_COMPLETED = 'ai_completed.md';
export const RECORD_FAILED = 'ai_failed.md';
export const RECORD_PROGRESS = 'ai_progress.md';

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
] as const;

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

export type TodoState = 'completed' | 'failed' | 'progress' | 'open';

export function todoState(todoDir: string): TodoState {
  if (existsSync(join(todoDir, RECORD_COMPLETED))) return 'completed';
  if (existsSync(join(todoDir, RECORD_FAILED))) return 'failed';
  if (existsSync(join(todoDir, RECORD_PROGRESS))) return 'progress';
  return 'open';
}

/** A batch is archivable when every todo folder inside carries a terminal record. */
export function batchIsDone(batchDir: string): boolean {
  const todos = listDirs(batchDir);
  if (todos.length === 0) return false;
  return todos.every((t) => {
    const s = todoState(join(batchDir, t));
    return s === 'completed' || s === 'failed';
  });
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

/** Directory of the installed novadev package itself (for reading templates/). */
export function packageDir(): string {
  return resolve(dirname(new URL(import.meta.url).pathname), '..');
}
