// Source drift (0.13.0): a concept whose `repo:` source has a commit dated after the day the concept was
// last written or verified is a NEXT ACTION. Git is asked in the repository that holds the path — here
// one nested inside the project, which the project's own repository ignores, as a super-repo ignores
// the projects it orchestrates.
import { describe, expect, test } from 'bun:test';
import { symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { lastCommitDate } from '../src/git.ts';
import { auditKnowledge, listConcepts, sourceDrift } from '../src/knowledge.ts';
import { CLI, KNOWLEDGE, STAMP, cleanEnv, git, project, run, tempDir, write } from './helpers.ts';

const AGENT = 'claude-code/claude-opus-5-5';
const APP = 'repos/app';

/** git in the repository at `dir`, as if run on `date` (author and committer alike). */
function gitOn(dir: string, date: string, ...args: string[]): void {
  const result = Bun.spawnSync({
    cmd: ['git', '-c', 'user.email=novadev@example.invalid', '-c', 'user.name=novadev tests', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args],
    cwd: dir,
    env: { ...cleanEnv(), GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr.toString()}`);
}

/** Commit everything in the repository at `dir` as made on `date`. */
function commitOn(dir: string, date: string, message = date): void {
  gitOn(dir, date, 'add', '-A');
  gitOn(dir, date, 'commit', '-q', '--no-verify', '--allow-empty', '-m', message);
}

/**
 * A project whose own repository ignores repos/, with an independent repository nested at repos/app.
 * Everything is first committed on 2026-09-20; the fixture's concepts were last checked on 2026-10-01.
 */
function nested(): string {
  const root = project();
  write(root, '.gitignore', 'repos/\n');
  write(root, 'src/own.ts', 'export {};\n');
  git(root, 'init', '-q');
  commitOn(root, '2026-09-20T10:00:00+02:00', 'base');
  for (const file of ['a.ts', 'b.ts', 'x.ts', 'y.ts', 'z.ts']) write(root, `${APP}/src/${file}`, `${file}\n`);
  git(join(root, APP), 'init', '-q');
  commitOn(join(root, APP), '2026-09-20T10:00:00+02:00', 'first');
  return root;
}

/** Change a file of the nested repository and commit it on `date`. */
function change(root: string, file: string, date: string): void {
  write(root, `${APP}/${file}`, `${file} on ${date}\n`);
  commitOn(join(root, APP), date);
}

/** A concept in planner/, last written on 2026-10-01 (the fixture's stamp), citing `sources`. */
function cites(root: string, name: string, sources: string[], extra = ''): void {
  write(
    root,
    `${KNOWLEDGE}/planner/${name}.md`,
    `---\ntype: Guide\ntitle: ${name}\ndescription: What ${name} explains.\ngenerated: ${STAMP}\n${extra}sources:\n${sources.map((s) => `  - resource: ${s}\n`).join('')}---\nThe text.\n`,
  );
}

const actions = (root: string) => auditKnowledge(root, join(root, '.novadev')).actions;
/** The drift actions: one per concept, then the count of the rest. */
const drifting = (root: string) => actions(root).filter((action) => / changed on |whose sources changed/.test(action));

function record(root: string, events: unknown[]): number {
  write(root, 'events.json', JSON.stringify({ events }));
  return run(root, 'knowledge', 'log', 'events.json').code;
}

describe('source drift', () => {
  test('a source in a nested repository, changed after the concept was last checked, is a NEXT ACTION naming the day', () => {
    const root = nested();
    cites(root, 'drawing', [`repo:${APP}/src/a.ts`]);
    expect(drifting(root)).toEqual([]); // its newest commit is from 2026-09-20
    change(root, 'src/a.ts', '2026-10-05T12:00:00+02:00');
    expect(drifting(root)).toEqual([
      'knowledge/planner/drawing.md: its source repo:repos/app/src/a.ts changed on 2026-10-05, after the concept was last checked (2026-10-01) — re-check it against the code, then record a "verify" if it still holds, or an "update" if it moved (`novadev knowledge log`)',
    ]);
    // The project's own repository knows nothing of it: the nested one answered.
    expect(git(root, 'log', '--format=%s', '--', `${APP}/src/a.ts`).stdout).toBe('');
  });

  test('whole days in the committer\'s own offset: the day the concept was checked never counts, the next one does', () => {
    const root = nested();
    cites(root, 'same-evening', [`repo:${APP}/src/x.ts`]);
    cites(root, 'west', [`repo:${APP}/src/y.ts`]);
    cites(root, 'east', [`repo:${APP}/src/z.ts`]);
    change(root, 'src/x.ts', '2026-10-01T23:00:00+02:00'); // the round's own commit, after it recorded the concept
    change(root, 'src/y.ts', '2026-10-01T23:30:00-10:00'); // already the 2nd in UTC, still the 1st where it was made
    change(root, 'src/z.ts', '2026-10-02T00:30:00+14:00'); // still the 1st in UTC, already the 2nd where it was made
    const listed = drifting(root);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toStartWith('knowledge/planner/east.md: its source repo:repos/app/src/z.ts changed on 2026-10-02, after the concept was last checked (2026-10-01)');
  });

  test('a folder drifts with any file in it, a file of the project\'s own repository too; several sources make one action', () => {
    const root = nested();
    cites(root, 'folder', [`repo:${APP}/src/`]);
    cites(root, 'own', ['repo:src/own.ts']);
    cites(root, 'both', [`repo:${APP}/src/a.ts`, `repo:${APP}/src/b.ts`, 'repo:./src/own.ts']);
    change(root, 'src/b.ts', '2026-10-03T09:00:00+02:00');
    change(root, 'src/a.ts', '2026-10-06T09:00:00+02:00');
    write(root, 'src/own.ts', 'export const changed = true;\n');
    commitOn(root, '2026-10-04T09:00:00+02:00', 'own change');
    const listed = drifting(root);
    expect(listed).toHaveLength(3);
    expect(listed[0]).toStartWith('knowledge/planner/both.md: its source repo:repos/app/src/a.ts changed on 2026-10-06 (and 2 other sources too), after the concept was last checked (2026-10-01)');
    expect(listed[1]).toStartWith('knowledge/planner/folder.md: its source repo:repos/app/src/ changed on 2026-10-06,');
    expect(listed[2]).toStartWith('knowledge/planner/own.md: its source repo:src/own.ts changed on 2026-10-04,');
    const both = sourceDrift(root, listConcepts(join(root, '.novadev'))).find((drift) => drift.concept.path === 'planner/both.md');
    expect(both?.sources).toEqual([
      { resource: `repo:${APP}/src/a.ts`, day: '2026-10-06' },
      { resource: 'repo:./src/own.ts', day: '2026-10-04' },
      { resource: `repo:${APP}/src/b.ts`, day: '2026-10-03' },
    ]);
  });

  test('a recorded verify clears it; a deprecated concept never drifts; a gone path is only "gone"', () => {
    const root = nested();
    git(root, 'config', 'user.name', 'Ada Lovelace');
    cites(root, 'drawing', [`repo:${APP}/src/a.ts`]);
    cites(root, 'old', [`repo:${APP}/src/a.ts`], 'status: deprecated\n');
    cites(root, 'moved', [`repo:${APP}/src/nope.ts`]);
    change(root, 'src/a.ts', '2026-10-05T12:00:00+02:00');
    const before = actions(root);
    expect(before.filter((action) => action.includes(' changed on '))).toHaveLength(1);
    expect(before.join('\n')).not.toContain('planner/old.md');
    expect(before).toContain(
      'knowledge/planner/moved.md: its source repo:repos/app/src/nope.ts is gone — the code it describes moved or went; re-check the concept and its sources (loop phase 9)',
    );
    expect(record(root, [{ path: 'planner/drawing.md', event: 'verify', by: AGENT, note: 'The drawing steps still hold after the a.ts change.' }])).toBe(0);
    expect(drifting(root)).toEqual([]);
  });

  test('more than five: five by name, then a count; `novadev knowledge --drifted` lists every one with its sources', () => {
    const root = nested();
    for (let i = 1; i <= 7; i++) cites(root, `c${i}`, [`repo:${APP}/src/a.ts`]);
    change(root, 'src/a.ts', '2026-10-05T12:00:00+02:00');
    const listed = drifting(root);
    expect(listed).toHaveLength(6);
    expect(listed[0]).toStartWith('knowledge/planner/c1.md: its source');
    expect(listed[4]).toStartWith('knowledge/planner/c5.md: its source');
    expect(listed[5]).toBe('… and 2 more concept(s) whose sources changed after their last check — `novadev knowledge --drifted` lists them all');

    const all = run(root, 'knowledge', '--drifted');
    expect(all.code).toBe(0);
    expect(all.stdout).toContain('knowledge — 7 of 13 match (drifted)');
    expect(all.stdout).toContain('  · [Guide] planner/c7.md — c7\n');
    expect(all.stdout).toContain('      source repo:repos/app/src/a.ts changed on 2026-10-05, after its last check on 2026-10-01\n');
    expect(run(root, 'knowledge', '--drifted', 'c3').stdout).toContain('knowledge — 1 of 13 match ("c3", drifted)');
    expect(run(root, 'knowledge').stdout).toContain('  drifted: 7 whose code changed after their last check — `novadev knowledge --drifted`\n');
  });

  test('sync lists it, and `sync --check` never fails on it', () => {
    const root = nested();
    cites(root, 'drawing', [`repo:${APP}/src/a.ts`]);
    change(root, 'src/a.ts', '2026-10-05T12:00:00+02:00');
    expect(run(root, 'sync').code).toBe(0); // writes planner/index.md
    const check = run(root, 'sync', '--check');
    expect(check.code).toBe(0);
    expect(check.stdout).toContain('→ knowledge/planner/drawing.md: its source repo:repos/app/src/a.ts changed on 2026-10-05');
  });

  test('git is asked once per path, however many concepts cite it — and a second audit asks nothing', () => {
    const root = nested();
    for (const name of ['one', 'two', 'three']) cites(root, name, [`repo:${APP}/src/a.ts`]);
    cites(root, 'four', [`repo:${APP}/src/b.ts`, `repo:${APP}/src/a.ts`]);
    change(root, 'src/a.ts', '2026-10-05T12:00:00+02:00');
    const answers = new Map<string, string | null>();
    const first = sourceDrift(root, listConcepts(join(root, '.novadev')), answers);
    expect(first).toHaveLength(4);
    // a.ts changed on the 5th; b.ts has no commit since the search's start, the day before the concepts' check.
    expect(answers).toEqual(
      new Map([
        [`${APP}/src/a.ts\x002026-10-01`, '2026-10-05'],
        [`${APP}/src/b.ts\x002026-10-01`, null],
      ]),
    );
    change(root, 'src/b.ts', '2026-10-07T12:00:00+02:00'); // a run commits nothing; the answers stand
    expect(sourceDrift(root, listConcepts(join(root, '.novadev')), answers)).toEqual(first);
    expect(answers.size).toBe(2);
  });

  test('a git hook\'s GIT_DIR does not hide the nested repository', () => {
    const root = nested();
    cites(root, 'drawing', [`repo:${APP}/src/a.ts`]);
    change(root, 'src/a.ts', '2026-10-05T12:00:00+02:00');
    const hooked = Bun.spawnSync({
      cmd: [process.execPath, CLI, 'sync'],
      cwd: root,
      env: { ...cleanEnv(), GIT_DIR: join(root, '.git'), GIT_WORK_TREE: root },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(hooked.stdout.toString()).toContain('→ knowledge/planner/drawing.md: its source repo:repos/app/src/a.ts changed on 2026-10-05');
  });

  test('a shallow clone\'s oldest commit says nothing — it seems to change every file; a first commit in a full history does', () => {
    const upstream = tempDir();
    write(upstream, 'a.ts', 'a\n');
    write(upstream, 'b.ts', 'b\n');
    git(upstream, 'init', '-q');
    commitOn(upstream, '2026-09-20T10:00:00+02:00', 'first');
    write(upstream, 'a.ts', 'a, changed\n');
    commitOn(upstream, '2026-10-05T10:00:00+02:00', 'second');
    expect(lastCommitDate(join(upstream, 'b.ts'), '2026-09-01T00:00:00Z')).toBe('2026-09-20T10:00:00+02:00');

    const root = nested();
    git(root, 'clone', '-q', '--depth', '1', `file://${upstream}`, join(root, 'repos/shallow'));
    // b.ts last changed on 2026-09-20, but the only commit fetched — dated 2026-10-05 — seems to add it.
    expect(lastCommitDate(join(root, 'repos/shallow/b.ts'), '2026-09-01T00:00:00Z')).toBeNull();
    cites(root, 'vendored', ['repo:repos/shallow/b.ts']);
    expect(drifting(root)).toEqual([]);
  });

  test('outside any repository, or in a folder no repository tracks, there is nothing to say', () => {
    const loose = tempDir();
    write(loose, 'a.ts', 'a\n');
    expect(lastCommitDate(join(loose, 'a.ts'), '2026-01-01T00:00:00Z')).toBeNull();
    expect(lastCommitDate(join(loose, 'nope.ts'), '2026-01-01T00:00:00Z')).toBeNull();
    const root = nested();
    write(root, 'repos/untracked/notes.md', 'x\n'); // ignored by the project, in no repository of its own
    cites(root, 'untracked', ['repo:repos/untracked/notes.md']);
    expect(drifting(root)).toEqual([]);
    expect(run(root, 'knowledge').stdout).toContain('  drifted: 0 whose code changed after their last check\n');
  });
});

describe('the review of 0.13.0: drift', () => {
  test('a merge counts on its own day: a side branch\'s change made before the check, merged after it, drifts', () => {
    const root = nested();
    const app = join(root, APP);
    cites(root, 'drawing', [`repo:${APP}/src/a.ts`]);
    gitOn(app, '2026-09-25T10:00:00+02:00', 'checkout', '-q', '-b', 'side');
    change(root, 'src/a.ts', '2026-09-25T10:00:00+02:00'); // made on the side branch, before the concept's check
    gitOn(app, '2026-09-25T10:00:00+02:00', 'checkout', '-q', '-');
    gitOn(app, '2026-10-05T12:00:00+02:00', 'merge', '-q', '--no-ff', 'side', '-m', 'merge side');
    const listed = drifting(root);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toStartWith('knowledge/planner/drawing.md: its source repo:repos/app/src/a.ts changed on 2026-10-05,');
  });

  test('a symbolic link is followed: a file linked into the project drifts with the file it points at', () => {
    const root = nested();
    symlinkSync(join(root, APP, 'src/a.ts'), join(root, 'src/linked.ts'));
    symlinkSync(join(root, APP, 'src'), join(root, 'src/linked-folder'));
    commitOn(root, '2026-09-20T12:00:00+02:00', 'links'); // the project's own repository holds the links themselves
    cites(root, 'file', ['repo:src/linked.ts']);
    cites(root, 'folder', ['repo:src/linked-folder']);
    change(root, 'src/a.ts', '2026-10-05T12:00:00+02:00');
    const listed = drifting(root);
    expect(listed).toHaveLength(2);
    expect(listed[0]).toStartWith('knowledge/planner/file.md: its source repo:src/linked.ts changed on 2026-10-05,');
    expect(listed[1]).toStartWith('knowledge/planner/folder.md: its source repo:src/linked-folder changed on 2026-10-05,');
  });

  test('a source inside .novadev/ is never asked about — every round commits there — and doctor notes it', () => {
    const root = nested();
    cites(root, 'bookkeeping', ['repo:.novadev/knowledge/planner/bookkeeping.md']);
    commitOn(root, '2026-10-05T12:00:00+02:00', 'a later round'); // commits the concept itself, after its check
    expect(drifting(root)).toEqual([]);
    expect(auditKnowledge(root, join(root, '.novadev')).notes).toContain(
      "knowledge/planner/bookkeeping.md: source repo:.novadev/knowledge/planner/bookkeeping.md is novadev's own bookkeeping, which every round commits — cite a todo as todo:<batch>/<todo> and a concept by its relative path; sync never asks git whether it changed",
    );
  });
});
