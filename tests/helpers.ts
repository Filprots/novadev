// Fixture trees for the novadev tests. Every project lives in its own temp folder and is removed
// after the test file; nothing here ever touches a real repository.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { NOVADEV_VERSION, WIKI_PAGES } from '../src/lib.ts';

export const REPO = resolve(import.meta.dir, '..');
export const CLI = join(REPO, 'bin', 'novadev.ts');

// Removed when the test process exits — a module-level hook, so it holds however the test runner
// shares this module between test files.
const made: string[] = [];
process.on('exit', () => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

export function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'novadev-test-'));
  made.push(dir);
  return dir;
}

export function write(root: string, rel: string, content: string): void {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

export function read(root: string, rel: string): string {
  return readFileSync(join(root, rel), 'utf8');
}

export function readJson(root: string, rel: string): Record<string, any> {
  return JSON.parse(read(root, rel));
}

export function exists(root: string, rel: string): boolean {
  return existsSync(join(root, rel));
}

export function mtime(root: string, rel: string): number {
  return statSync(join(root, rel)).mtimeMs;
}

/**
 * A minimal healthy project at the installed version: a full wiki, an empty features registry,
 * a memories index. `novadev sync` on it comes back clean.
 */
export function project(manifest: Record<string, unknown> = {}): string {
  const root = tempDir();
  setManifest(root, { novadev: true, version: NOVADEV_VERSION, ...manifest }, true);
  const pages = WIKI_PAGES.filter((page) => page !== 'INDEX.md');
  write(
    root,
    '.novadev/wiki/INDEX.md',
    `---\nupdated: 2026-10-01\n---\n\n# Wiki\n\n${pages.map((p) => `- ${p}`).join('\n')}\n`,
  );
  for (const page of pages) {
    write(root, `.novadev/wiki/${page}`, `---\nupdated: 2026-10-01\n---\n\n# ${page}\n\nHand-written text.\n`);
  }
  write(
    root,
    '.novadev/features/INDEX.md',
    '# Features index\n\n<!-- novadev:features-index:begin -->\n<!-- novadev:features-index:end -->\n',
  );
  write(root, '.novadev/memories/INDEX.md', '# Memories index\n\n(no memories yet)\n');
  return root;
}

/** Merge settings into .novadev/novadev.json (or replace it whole). */
export function setManifest(root: string, patch: Record<string, unknown>, replace = false): void {
  const path = '.novadev/novadev.json';
  const current = !replace && exists(root, path) ? readJson(root, path) : {};
  write(root, path, JSON.stringify({ ...current, ...patch }, null, 2) + '\n');
}

/** What the project's metrics command will print: `cat metrics-out.json`. */
export function metricsOutput(root: string, value: unknown): void {
  write(root, 'metrics-out.json', typeof value === 'string' ? value : JSON.stringify(value));
}

/** A project whose metrics command prints `value`. */
export function metricsProject(value: unknown, manifest: Record<string, unknown> = {}): string {
  const root = project({ metrics: 'cat metrics-out.json', ...manifest });
  metricsOutput(root, value);
  return root;
}

/** A todo folder with a brief and, optionally, records. */
export function todo(root: string, ref: string, files: Record<string, string> = {}): void {
  write(root, `.novadev/todos/${ref}/prompt.md`, `# prompt — ${ref}\n\nDo the thing.\n`);
  for (const [name, content] of Object.entries(files)) write(root, `.novadev/todos/${ref}/${name}`, content);
}

/** A completed record; `extra` is appended (a `## Debt` section, say). */
export function completed(slug: string, extra = ''): string {
  return `# ai_completed — ${slug}\n\n**Date:** 2026-10-01\n**Feature:** none — test fixture\n\n## What I did\nThe work.\n${extra}`;
}

export type Run = { code: number; stdout: string; stderr: string };

/** Run the CLI from `cwd`, exactly as a person would. */
export function run(cwd: string, ...args: string[]): Run {
  const result = Bun.spawnSync({
    cmd: [process.execPath, CLI, ...args],
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env },
  });
  return {
    code: result.exitCode ?? -1,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}
