// Fixture trees for the novadev tests. Every project lives in its own temp folder, removed when the
// test run ends; nothing here ever touches a real repository.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { NOVADEV_VERSION, WIKI_PAGES } from '../src/lib.ts';

export const REPO = resolve(import.meta.dir, '..');
export const CLI = join(REPO, 'bin', 'novadev.ts');

/**
 * Every fixture folder of this test run starts with this name, so the run can find and remove its
 * own folders — and only its own: a run beside it has another process id.
 */
const PREFIX = `novadev-test-${process.pid}-`;

export function tempDir(): string {
  return mkdtempSync(join(tmpdir(), PREFIX));
}

/**
 * Remove the fixture folders of this test run. tests/setup.ts (a preload, see bunfig.toml) calls it
 * once, after every test file: bun test fires no process "exit" hook, and an afterAll in this shared
 * module would run only for the first test file that loads it.
 */
export function removeTempDirs(): void {
  for (const name of readdirSync(tmpdir())) {
    if (name.startsWith(PREFIX)) rmSync(join(tmpdir(), name), { recursive: true, force: true });
  }
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

/**
 * What the project's metrics command will print: `cat metrics-out.json`. The hub paths it names are
 * created in the project, as they would be in a real one: a folder (a path ending in "/") gets a
 * `.keep` file, any other path becomes a file. A path that is already there is left as it is.
 */
export function metricsOutput(root: string, value: unknown): void {
  write(root, 'metrics-out.json', typeof value === 'string' ? value : JSON.stringify(value));
  const hubs = (value as { hubs?: unknown } | null)?.hubs;
  if (!Array.isArray(hubs)) return;
  for (const hub of hubs) {
    const path = (hub as { path?: unknown } | null)?.path;
    if (typeof path !== 'string' || path === '' || path.includes('..') || path.startsWith('/')) continue;
    if (exists(root, path)) continue;
    write(root, path.endsWith('/') ? `${path}.keep` : path, '');
  }
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

/** A feature folder, `features/<id>-<slug>/feature.md`; `touches` is the frontmatter value as written. */
export function feature(
  root: string,
  id: string,
  slug: string,
  o: { title?: string; status?: string; area?: string; tags?: string; touches?: string } = {},
): void {
  const title = o.title ?? slug;
  write(
    root,
    `.novadev/features/${id}-${slug}/feature.md`,
    `---\nid: ${id}\ntitle: ${title}\nstatus: ${o.status ?? 'shipped'}\narea: ${o.area ?? 'editor'}\ncreated: 2026-10-01\nupdated: 2026-10-01\ntags: ${o.tags ?? ''}\ntouches: ${o.touches ?? ''}\ndepends-on:\nsupersedes:\nsuperseded-by:\nconflicts-with:\n---\n\n# ${id} — ${title}\n\n## What it does\n\nIt works.\n`,
  );
}

/** A completed record; `extra` is appended (a `## Debt` section, say). */
export function completed(slug: string, extra = ''): string {
  return `# ai_completed — ${slug}\n\n**Date:** 2026-10-01\n**Feature:** none — test fixture\n\n## What I did\nThe work.\n${extra}`;
}

export type Run = { code: number; stdout: string; stderr: string };

/**
 * The environment for anything a test starts. Without the GIT_* variables a parent git process
 * may have set (a hook running the tests), so git in a fixture always means the fixture's repo.
 */
export function cleanEnv(): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
}

/** Run the CLI from `cwd`, exactly as a person would. */
export function run(cwd: string, ...args: string[]): Run {
  const result = Bun.spawnSync({
    cmd: [process.execPath, CLI, ...args],
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    env: cleanEnv(),
  });
  return {
    code: result.exitCode ?? -1,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

/** git in a fixture, with a fixed identity and none of the user's signing or hooks. */
export function git(root: string, ...args: string[]): Run {
  const result = Bun.spawnSync({
    cmd: [
      'git',
      '-c', 'user.email=novadev@example.invalid',
      '-c', 'user.name=novadev tests',
      '-c', 'commit.gpgsign=false',
      '-c', 'core.hooksPath=/dev/null',
      ...args,
    ],
    cwd: root,
    stdout: 'pipe',
    stderr: 'pipe',
    env: cleanEnv(),
  });
  const out = { code: result.exitCode ?? -1, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
  if (out.code !== 0) throw new Error(`git ${args.join(' ')} failed: ${out.stderr}`);
  return out;
}

/** Make the fixture a git repository (once) and commit everything in it. */
export function commitAll(root: string, message = 'fixture'): void {
  if (!exists(root, '.git')) git(root, 'init', '-q');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '--no-verify', '--allow-empty', '-m', message);
}
