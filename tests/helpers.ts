// Fixture trees for the novadev tests. Every project lives in its own temp folder, removed when the
// test run ends; nothing here ever touches a real repository.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { WIKI_PAGES, derivedIndexes, initialLog, listConcepts } from '../src/knowledge.ts';
import { NOVADEV_VERSION, csvList } from '../src/lib.ts';
import { yamlFlowList, yamlString } from '../src/okf.ts';

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

/** Where the knowledge bundle sits in a fixture, and the paths of its folders. */
export const KNOWLEDGE = '.novadev/knowledge';
export const WIKI = `${KNOWLEDGE}/wiki`;
export const MEMORIES = `${KNOWLEDGE}/memories`;
export const FEATURES = `${KNOWLEDGE}/features`;
/** The stamp every fixture concept carries: written by a test agent, on the day the log starts. */
export const STAMP = '{ by: claude-code/test, at: 2026-10-01T00:00:00Z }';

/** A wiki page as a concept: OKF frontmatter, then `body` (by default a heading and a line). */
export function wikiText(title: string, body = `# ${title}\n\nHand-written text.\n`): string {
  return `---\ntype: Wiki Page\ntitle: ${yamlString(title)}\ndescription: ${yamlString(`The ${title.toLowerCase()} of the project.`)}\ngenerated: ${STAMP}\n---\n\n${body}`;
}

/** Write one wiki page of a fixture, `file` inside knowledge/wiki/. */
export function wikiPage(root: string, file: string, body?: string): void {
  const title = WIKI_PAGES.find((page) => page.file === file)?.title ?? file.replace(/\.md$/, '');
  write(root, `${WIKI}/${file}`, wikiText(title, body));
}

/** Rewrite the bundle's derived index files, as `novadev sync` would. */
export function writeIndexes(root: string): void {
  const nd = join(root, '.novadev');
  for (const [path, content] of derivedIndexes(nd, listConcepts(nd))) write(root, `${KNOWLEDGE}/${path}`, content);
}

/**
 * A minimal healthy project at the installed version: a knowledge bundle with a full wiki, an
 * empty features registry (its hand-made index says so) and a log, the derived indexes written.
 * `novadev sync` on it comes back clean.
 */
export function project(manifest: Record<string, unknown> = {}): string {
  const root = tempDir();
  setManifest(root, { novadev: true, version: NOVADEV_VERSION, ...manifest }, true);
  write(root, `${KNOWLEDGE}/log.md`, initialLog('2026-10-01'));
  for (const page of WIKI_PAGES) wikiPage(root, page.file);
  write(root, `${FEATURES}/index.md`, '# Features\n');
  writeIndexes(root);
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

/**
 * A feature folder, `knowledge/features/<id>-<slug>/feature.md`, as an OKF concept. `tags` and
 * `touches` are comma lists, written as the YAML lists the file holds.
 */
export function feature(
  root: string,
  id: string,
  slug: string,
  o: { title?: string; status?: string; area?: string; tags?: string; touches?: string } = {},
): void {
  const title = o.title ?? slug;
  const status = o.status ?? 'shipped';
  const lifecycle = status === 'shipped' ? 'stable' : status === 'deprecated' ? 'deprecated' : 'draft';
  write(
    root,
    `${FEATURES}/${id}-${slug}/feature.md`,
    `---\ntype: Feature\nid: ${id}\ntitle: ${yamlString(title)}\ndescription: ${yamlString(`What ${title} does.`)}\nfeature-status: ${status}\nstatus: ${lifecycle}\narea: ${o.area ?? 'editor'}\ncreated: 2026-10-01\ntags: ${yamlFlowList(csvList(o.tags))}\ntouches: ${yamlFlowList(csvList(o.touches))}\ndepends-on: []\nsupersedes: []\nsuperseded-by: []\nconflicts-with: []\ngenerated: ${STAMP}\n---\n\n# ${id} — ${title}\n\n## What it does\n\nIt works.\n`,
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
