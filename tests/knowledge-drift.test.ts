// Source drift (0.13.0): a concept whose `repo:` source has a commit dated after the day the concept was
// last written or verified is a NEXT ACTION. Git is asked in the repository that holds the path — here
// one nested inside the project, which the project's own repository ignores, as a super-repo ignores
// the projects it orchestrates.
import { describe, expect, test } from 'bun:test';
import { symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { lastCommitDate } from '../src/git.ts';
import { type SourceChange, auditKnowledge, listConcepts, sourceDrift } from '../src/knowledge.ts';
import { parseEvents, recordEvents } from '../src/knowledge-log.ts';
import { CLI, KNOWLEDGE, STAMP, cleanEnv, git, project, read, run, tempDir, write } from './helpers.ts';

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
    const answers = new Map<string, SourceChange | null>();
    const first = sourceDrift(root, listConcepts(join(root, '.novadev')), answers);
    expect(first).toHaveLength(4);
    // a.ts changed on the 5th; b.ts has no commit since the search's start, the day before the concepts' check.
    expect(answers).toEqual(
      new Map([
        [`${APP}/src/a.ts\x002026-10-01`, { day: '2026-10-05', commit: git(join(root, APP), 'rev-parse', 'HEAD').stdout.trim(), parents: [git(join(root, APP), 'rev-parse', 'HEAD^').stdout.trim()] }],
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

describe('a re-check that reaches the line with the code it re-checked', () => {
  /** Record a "verify" of planner/<name>.md as `novadev knowledge log` does, at the moment `at`. */
  function verifyOn(root: string, name: string, at: string, folder = 'planner'): void {
    const nd = join(root, '.novadev');
    const events = parseEvents(root, nd, {
      events: [{ path: `${folder}/${name}.md`, event: 'verify', by: AGENT, note: `The ${name} text still holds after the change to its code.` }],
    });
    recordEvents(root, nd, events, new Date(at));
  }

  /**
   * A branch `side` of the project's own repository, on 2026-10-04: it changes src/own.ts, re-checks
   * the concepts `names` that day, and commits both. The checkout is back on the first branch after.
   */
  function recheckOnSide(root: string, names: string[]): void {
    gitOn(root, '2026-10-04T09:00:00+02:00', 'checkout', '-q', '-b', 'side');
    write(root, 'src/own.ts', 'export const changed = true;\n');
    for (const name of names) verifyOn(root, name, '2026-10-04T15:00:00+02:00');
    commitOn(root, '2026-10-04T15:30:00+02:00', 'the change and its re-check');
    gitOn(root, '2026-10-04T15:30:00+02:00', 'checkout', '-q', '-');
  }

  /** The branch checked out in `root`. */
  const branchOf = (root: string) => git(root, 'rev-parse', '--abbrev-ref', 'HEAD').stdout.trim();

  /** src/own.ts as ten lines, line `n` of them changed to `text`: two branches change two lines and merge cleanly. */
  function ownLines(root: string, changes: Record<number, string> = {}): void {
    const lines = Array.from({ length: 10 }, (_, i) => changes[i + 1] ?? `export const line${i + 1} = ${i + 1};`);
    write(root, 'src/own.ts', `${lines.join('\n')}\n`);
  }

  /** The fixture with src/own.ts as ten lines and planner/drawing.md citing it, committed on 2026-10-01. */
  function tenLines(): string {
    const root = nested();
    ownLines(root);
    cites(root, 'drawing', ['repo:src/own.ts']);
    commitOn(root, '2026-10-01T10:00:00+02:00', 'the concept');
    return root;
  }

  test('a branch re-checks a concept along with the code it changed, merged a day later: the merge is that check, no drift', () => {
    const root = nested();
    cites(root, 'drawing', ['repo:src/own.ts']);
    commitOn(root, '2026-10-01T10:00:00+02:00', 'the concept');
    recheckOnSide(root, ['drawing']);
    gitOn(root, '2026-10-05T12:00:00+02:00', 'merge', '-q', '--no-ff', 'side', '-m', 'merge side');
    // The stamp says 2026-10-04; the code reached the line with the merge, on 2026-10-05 — and so did the stamp.
    expect(drifting(root)).toEqual([]);
    expect(run(root, 'knowledge').stdout).toContain('  drifted: 0 whose code changed after their last check\n');
  });

  test('a merge is no check of code that reached the line before it: the re-check it brought never saw that code; a plain commit never counts — an import checked nothing', () => {
    const root = nested();
    cites(root, 'drawing', ['repo:src/own.ts']);
    commitOn(root, '2026-10-01T10:00:00+02:00', 'the concept');
    gitOn(root, '2026-10-02T09:00:00+02:00', 'checkout', '-q', '-b', 'side');
    verifyOn(root, 'drawing', '2026-10-02T15:00:00+02:00');
    commitOn(root, '2026-10-02T15:30:00+02:00', 'a re-check');
    gitOn(root, '2026-10-02T15:30:00+02:00', 'checkout', '-q', '-');
    write(root, 'src/own.ts', 'export const changed = true;\n');
    commitOn(root, '2026-10-03T12:00:00+02:00', 'the code, on the line');
    expect(drifting(root)).toHaveLength(1); // the line's concept is still the one checked on the 1st
    gitOn(root, '2026-10-05T12:00:00+02:00', 'merge', '-q', '--no-ff', 'side', '-m', 'merge side');
    // The merge of the 5th brought the re-check of the 2nd, which never saw the code of the 3rd.
    const merged = drifting(root);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toStartWith('knowledge/planner/drawing.md: its source repo:src/own.ts changed on 2026-10-03, after the concept was last checked (2026-10-02) — ');

    // One plain commit brings a concept and its code in together: a squash, a rebase — or an import.
    const imported = nested();
    cites(imported, 'drawing', ['repo:src/own.ts']); // stamped 2026-10-01
    write(imported, 'src/own.ts', 'export const imported = true;\n');
    commitOn(imported, '2026-10-05T12:00:00+02:00', 'import the project and its knowledge');
    const listed = drifting(imported);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toStartWith('knowledge/planner/drawing.md: its source repo:src/own.ts changed on 2026-10-05, after the concept was last checked (2026-10-01)');
  });

  test('a merge that changes the concept\'s file without a stamp is no check: an unrecorded edit, a block sync writes', () => {
    const root = nested();
    cites(root, 'drawing', ['repo:src/own.ts']);
    commitOn(root, '2026-10-01T10:00:00+02:00', 'the concept');
    gitOn(root, '2026-10-04T09:00:00+02:00', 'checkout', '-q', '-b', 'side');
    write(root, 'src/own.ts', 'export const changed = true;\n');
    const page = `${KNOWLEDGE}/planner/drawing.md`;
    write(root, page, `${read(root, page)}\n<!-- novadev:budgets:begin -->\nnumbers\n<!-- novadev:budgets:end -->\n`);
    commitOn(root, '2026-10-04T15:30:00+02:00', 'the code, and the page changed with no stamp');
    gitOn(root, '2026-10-04T15:30:00+02:00', 'checkout', '-q', '-');
    gitOn(root, '2026-10-05T12:00:00+02:00', 'merge', '-q', '--no-ff', 'side', '-m', 'merge side');
    const listed = drifting(root);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toStartWith('knowledge/planner/drawing.md: its source repo:src/own.ts changed on 2026-10-05, after the concept was last checked (2026-10-01) — ');
  });

  test('a page moved by a branch keeps the stamps it had: the move is no check — git\'s rename detection finds its old path', () => {
    // The code changed on the line; a branch only moves the page.
    const root = nested();
    cites(root, 'drawing', ['repo:src/own.ts']);
    commitOn(root, '2026-10-01T10:00:00+02:00', 'the concept');
    write(root, 'src/own.ts', 'export const changed = true;\n');
    commitOn(root, '2026-10-03T10:00:00+02:00', 'code on the line');
    gitOn(root, '2026-10-04T09:00:00+02:00', 'checkout', '-q', '-b', 'side');
    gitOn(root, '2026-10-04T09:00:00+02:00', 'mv', `${KNOWLEDGE}/planner/drawing.md`, `${KNOWLEDGE}/planner/drawing-moved.md`);
    commitOn(root, '2026-10-04T10:00:00+02:00', 'reorganise');
    gitOn(root, '2026-10-04T10:00:00+02:00', 'checkout', '-q', '-');
    gitOn(root, '2026-10-05T12:00:00+02:00', 'merge', '-q', '--no-ff', 'side', '-m', 'merge side');
    expect(drifting(root)).toHaveLength(1);

    // The branch changes the code and moves the page; the line re-checked the page after the branch
    // left, without its code: the merge brings the line's stamps to the new path — none of its own.
    const moved = nested();
    cites(moved, 'drawing', ['repo:src/own.ts']);
    commitOn(moved, '2026-10-01T10:00:00+02:00', 'the concept');
    gitOn(moved, '2026-10-02T09:00:00+02:00', 'checkout', '-q', '-b', 'side');
    write(moved, 'src/own.ts', 'export const changed = true;\n');
    gitOn(moved, '2026-10-02T09:00:00+02:00', 'mv', `${KNOWLEDGE}/planner/drawing.md`, `${KNOWLEDGE}/planner/drawing-moved.md`);
    commitOn(moved, '2026-10-02T10:00:00+02:00', 'the code, and the page moved');
    gitOn(moved, '2026-10-02T10:00:00+02:00', 'checkout', '-q', '-');
    verifyOn(moved, 'drawing', '2026-10-03T15:00:00+02:00');
    commitOn(moved, '2026-10-03T15:30:00+02:00', 'a re-check on the line, without the branch\'s code');
    gitOn(moved, '2026-10-05T12:00:00+02:00', 'merge', '-q', '--no-ff', 'side', '-m', 'merge side');
    expect(read(moved, `${KNOWLEDGE}/planner/drawing-moved.md`)).toMatch(/verified:\n  - \{ by: [^,]+, at: 2026-10-03T/); // the line's stamp, moved along
    const listed = drifting(moved);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toStartWith('knowledge/planner/drawing-moved.md: its source repo:src/own.ts changed on 2026-10-05, after the concept was last checked (2026-10-03) — ');

    // A branch that moves the page AND re-checks it with its code: that merge is the check.
    const both = nested();
    cites(both, 'drawing', ['repo:src/own.ts']);
    commitOn(both, '2026-10-01T10:00:00+02:00', 'the concept');
    gitOn(both, '2026-10-04T09:00:00+02:00', 'checkout', '-q', '-b', 'side');
    gitOn(both, '2026-10-04T09:00:00+02:00', 'mv', `${KNOWLEDGE}/planner/drawing.md`, `${KNOWLEDGE}/planner/drawing-moved.md`);
    write(both, 'src/own.ts', 'export const changed = true;\n');
    verifyOn(both, 'drawing-moved', '2026-10-04T15:00:00+02:00');
    commitOn(both, '2026-10-04T15:30:00+02:00', 'moved, the code, the re-check');
    gitOn(both, '2026-10-04T15:30:00+02:00', 'checkout', '-q', '-');
    gitOn(both, '2026-10-05T12:00:00+02:00', 'merge', '-q', '--no-ff', 'side', '-m', 'merge side');
    expect(drifting(both)).toEqual([]);
  });

  test('a page a branch writes new along with the code it describes: the merge brings all its stamps — that is its check', () => {
    const root = nested();
    commitOn(root, '2026-10-01T10:00:00+02:00', 'the project');
    gitOn(root, '2026-10-04T09:00:00+02:00', 'checkout', '-q', '-b', 'side');
    write(root, 'src/own.ts', 'export const changed = true;\n');
    write(
      root,
      `${KNOWLEDGE}/planner/fresh.md`,
      `---\ntype: Guide\ntitle: fresh\ndescription: What fresh explains.\ngenerated: { by: ${AGENT}, at: 2026-10-04T15:00:00+02:00 }\nsources:\n  - resource: repo:src/own.ts\n---\nThe text.\n`,
    );
    commitOn(root, '2026-10-04T15:30:00+02:00', 'the code and its new page');
    gitOn(root, '2026-10-04T15:30:00+02:00', 'checkout', '-q', '-');
    gitOn(root, '2026-10-05T12:00:00+02:00', 'merge', '-q', '--no-ff', 'side', '-m', 'merge side');
    expect(drifting(root)).toEqual([]);
  });

  test('a re-check made in a branch before more code on the same branch did not see that code', () => {
    const root = nested();
    cites(root, 'drawing', ['repo:src/own.ts']);
    commitOn(root, '2026-10-01T10:00:00+02:00', 'the concept');
    gitOn(root, '2026-10-02T09:00:00+02:00', 'checkout', '-q', '-b', 'side');
    verifyOn(root, 'drawing', '2026-10-02T15:00:00+02:00');
    commitOn(root, '2026-10-02T15:30:00+02:00', 'a re-check');
    write(root, 'src/own.ts', 'export const changed = true;\n');
    commitOn(root, '2026-10-03T10:00:00+02:00', 'more code, no re-check');
    gitOn(root, '2026-10-03T10:00:00+02:00', 'checkout', '-q', '-');
    gitOn(root, '2026-10-05T12:00:00+02:00', 'merge', '-q', '--no-ff', 'side', '-m', 'merge side');
    const listed = drifting(root);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toStartWith('knowledge/planner/drawing.md: its source repo:src/own.ts changed on 2026-10-05, after the concept was last checked (2026-10-02) — ');
  });

  test('code the line changed while the branch was away: the re-check the merge brings never saw it', () => {
    const root = tenLines();
    gitOn(root, '2026-10-02T09:00:00+02:00', 'checkout', '-q', '-b', 'side');
    ownLines(root, { 1: 'export const side = true;' });
    verifyOn(root, 'drawing', '2026-10-02T15:00:00+02:00');
    commitOn(root, '2026-10-02T15:30:00+02:00', 'the code and its re-check');
    gitOn(root, '2026-10-02T15:30:00+02:00', 'checkout', '-q', '-');
    ownLines(root, { 10: 'export const line = true;' });
    commitOn(root, '2026-10-03T10:00:00+02:00', 'other code on the line');
    gitOn(root, '2026-10-05T12:00:00+02:00', 'merge', '-q', '--no-ff', 'side', '-m', 'merge side');
    expect(read(root, 'src/own.ts')).toContain('side = true');
    expect(read(root, 'src/own.ts')).toContain('line = true');
    const listed = drifting(root);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toStartWith('knowledge/planner/drawing.md: its source repo:src/own.ts changed on 2026-10-05, after the concept was last checked (2026-10-02) — ');
  });

  test('the worktree flow: the line is merged into the branch, then the branch into the line — a re-check counts only if it saw what that brought', () => {
    // Another builder's code reaches the line (by its own merge) after this branch re-checked; this
    // branch never changed the code. The lead merges the line into the branch, then the branch.
    const root = nested();
    cites(root, 'drawing', ['repo:src/own.ts']);
    commitOn(root, '2026-10-01T10:00:00+02:00', 'the concept');
    const main = branchOf(root);
    gitOn(root, '2026-10-02T09:00:00+02:00', 'checkout', '-q', '-b', 'side');
    verifyOn(root, 'drawing', '2026-10-02T15:00:00+02:00');
    commitOn(root, '2026-10-02T15:30:00+02:00', 're-check');
    gitOn(root, '2026-10-03T09:00:00+02:00', 'checkout', '-q', '-b', 'other', main);
    write(root, 'src/own.ts', 'export const other = true;\n');
    commitOn(root, '2026-10-03T10:00:00+02:00', 'other code');
    gitOn(root, '2026-10-03T10:00:00+02:00', 'checkout', '-q', main);
    gitOn(root, '2026-10-03T12:00:00+02:00', 'merge', '-q', '--no-ff', 'other', '-m', 'merge other');
    expect(drifting(root)).toHaveLength(1);
    gitOn(root, '2026-10-05T09:00:00+02:00', 'checkout', '-q', 'side');
    gitOn(root, '2026-10-05T09:00:00+02:00', 'merge', '-q', '--no-ff', main, '-m', "Merge branch 'main' into side");
    gitOn(root, '2026-10-05T09:00:00+02:00', 'checkout', '-q', main);
    gitOn(root, '2026-10-05T12:00:00+02:00', 'merge', '-q', '--no-ff', 'side', '-m', 'Merge side (worktree side)');
    const listed = drifting(root);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toStartWith('knowledge/planner/drawing.md: its source repo:src/own.ts changed on 2026-10-03, after the concept was last checked (2026-10-02) — ');

    // Both change the code: the line's merge into the branch changes it too. A re-check made before
    // it never saw the line's part; one made after it (or on its day) did.
    for (const again of [false, true]) {
      const flow = tenLines();
      const line = branchOf(flow);
      gitOn(flow, '2026-10-02T09:00:00+02:00', 'checkout', '-q', '-b', 'side');
      ownLines(flow, { 1: 'export const side = true;' });
      verifyOn(flow, 'drawing', '2026-10-02T15:00:00+02:00');
      commitOn(flow, '2026-10-02T15:30:00+02:00', 'the code and its re-check');
      gitOn(flow, '2026-10-02T15:30:00+02:00', 'checkout', '-q', line);
      ownLines(flow, { 10: 'export const line = true;' });
      commitOn(flow, '2026-10-03T10:00:00+02:00', 'other code on the line');
      gitOn(flow, '2026-10-04T09:00:00+02:00', 'checkout', '-q', 'side');
      gitOn(flow, '2026-10-04T09:00:00+02:00', 'merge', '-q', '--no-ff', line, '-m', "Merge branch 'main' into side");
      if (again) {
        verifyOn(flow, 'drawing', '2026-10-04T10:00:00+02:00');
        commitOn(flow, '2026-10-04T10:30:00+02:00', 're-checked with the line\'s code');
      }
      gitOn(flow, '2026-10-04T10:30:00+02:00', 'checkout', '-q', line);
      gitOn(flow, '2026-10-05T12:00:00+02:00', 'merge', '-q', '--no-ff', 'side', '-m', 'Merge side (worktree side)');
      const found = drifting(flow);
      if (again) expect(found).toEqual([]);
      else {
        expect(found).toHaveLength(1);
        expect(found[0]).toStartWith('knowledge/planner/drawing.md: its source repo:src/own.ts changed on 2026-10-05, after the concept was last checked (2026-10-02) — ');
      }
    }
  });

  test('in a branch, merging the line in — whose re-check of its own code came along — does not excuse the branch\'s own unchecked code', () => {
    // The line re-checks the page in a plain commit; the branch changed the code without a re-check.
    const root = nested();
    cites(root, 'drawing', ['repo:src/own.ts']);
    commitOn(root, '2026-10-01T10:00:00+02:00', 'the concept');
    const main = branchOf(root);
    gitOn(root, '2026-10-02T09:00:00+02:00', 'checkout', '-q', '-b', 'side');
    gitOn(root, '2026-10-02T09:00:00+02:00', 'checkout', '-q', main);
    verifyOn(root, 'drawing', '2026-10-03T15:00:00+02:00');
    commitOn(root, '2026-10-03T15:30:00+02:00', 'a re-check on the line');
    gitOn(root, '2026-10-04T09:00:00+02:00', 'checkout', '-q', 'side');
    write(root, 'src/own.ts', 'export const branch = true;\n');
    commitOn(root, '2026-10-04T10:00:00+02:00', 'branch code, page not re-checked');
    expect(drifting(root)).toHaveLength(1);
    gitOn(root, '2026-10-06T09:00:00+02:00', 'merge', '-q', '--no-ff', main, '-m', "Merge branch 'main' into side");
    const listed = drifting(root);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toStartWith('knowledge/planner/drawing.md: its source repo:src/own.ts changed on 2026-10-04, after the concept was last checked (2026-10-03) — ');

    // The line changes the code too and re-checks it, so the merge into the branch changes the code
    // and brings a re-check: of the line's code only — the branch's own change still drifts.
    const flow = tenLines();
    const line = branchOf(flow);
    gitOn(flow, '2026-10-02T09:00:00+02:00', 'checkout', '-q', '-b', 'side');
    ownLines(flow, { 1: 'export const side = true;' });
    commitOn(flow, '2026-10-02T10:00:00+02:00', 'branch code, page not re-checked');
    gitOn(flow, '2026-10-02T10:00:00+02:00', 'checkout', '-q', line);
    ownLines(flow, { 10: 'export const line = true;' });
    verifyOn(flow, 'drawing', '2026-10-03T15:00:00+02:00');
    commitOn(flow, '2026-10-03T15:30:00+02:00', 'line code and its re-check');
    gitOn(flow, '2026-10-04T09:00:00+02:00', 'checkout', '-q', 'side');
    gitOn(flow, '2026-10-04T09:00:00+02:00', 'merge', '-q', '--no-ff', line, '-m', "Merge branch 'main' into side");
    const found = drifting(flow);
    expect(found).toHaveLength(1);
    expect(found[0]).toStartWith('knowledge/planner/drawing.md: its source repo:src/own.ts changed on 2026-10-04, after the concept was last checked (2026-10-03) — ');
  });

  test('a later merge the same day that changes the code without a re-check: drifted, though the re-check was merged that morning', () => {
    const root = nested();
    cites(root, 'drawing', ['repo:src/own.ts']);
    commitOn(root, '2026-10-01T10:00:00+02:00', 'the concept');
    recheckOnSide(root, ['drawing']);
    const main = branchOf(root);
    gitOn(root, '2026-10-05T09:00:00+02:00', 'merge', '-q', '--no-ff', 'side', '-m', 'merge side');
    expect(drifting(root)).toEqual([]);
    gitOn(root, '2026-10-05T10:00:00+02:00', 'checkout', '-q', '-b', 'other');
    write(root, 'src/own.ts', 'export const other = true;\n');
    commitOn(root, '2026-10-05T11:00:00+02:00', 'other code, page not re-checked');
    gitOn(root, '2026-10-05T11:00:00+02:00', 'checkout', '-q', main);
    gitOn(root, '2026-10-05T17:00:00+02:00', 'merge', '-q', '--no-ff', 'other', '-m', 'merge other');
    const listed = drifting(root);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toStartWith('knowledge/planner/drawing.md: its source repo:src/own.ts changed on 2026-10-05, after the concept was last checked (2026-10-04) — ');
  });

  test('a merge counts for the source it brought: another source changed on the line meanwhile drifts, and the message names both days', () => {
    const root = nested();
    write(root, 'src/other.ts', 'export {};\n');
    cites(root, 'drawing', ['repo:src/own.ts', 'repo:src/other.ts']);
    commitOn(root, '2026-10-01T10:00:00+02:00', 'the concept');
    recheckOnSide(root, ['drawing']);
    write(root, 'src/other.ts', 'export const changed = true;\n');
    commitOn(root, '2026-10-05T10:00:00+02:00', 'other code on the line, after the re-check was made');
    gitOn(root, '2026-10-06T12:00:00+02:00', 'merge', '-q', '--no-ff', 'side', '-m', 'merge side');
    const drifts = sourceDrift(root, listConcepts(join(root, '.novadev')));
    expect(drifts.map(({ checked, stamped, sources }) => ({ checked, stamped, sources }))).toEqual([
      { checked: '2026-10-06', stamped: '2026-10-04', sources: [{ resource: 'repo:src/other.ts', day: '2026-10-05' }] },
    ]);
    expect(drifting(root)[0]).toStartWith(
      'knowledge/planner/drawing.md: its source repo:src/other.ts changed on 2026-10-05, after the concept was last checked (2026-10-04, merged on 2026-10-06) — ',
    );
    expect(run(root, 'knowledge', '--drifted').stdout).toContain(
      '      source repo:src/other.ts changed on 2026-10-05, after its last check on 2026-10-04, merged on 2026-10-06\n',
    );
  });

  test('only that concept, on that line, up to that day: a concept the merge left alone, a nested repository\'s source and later code still drift', () => {
    const root = nested();
    cites(root, 'drawing', ['repo:src/own.ts']);
    cites(root, 'untouched', ['repo:src/own.ts']);
    cites(root, 'app', [`repo:${APP}/src/a.ts`]);
    commitOn(root, '2026-10-01T10:00:00+02:00', 'the concepts');
    recheckOnSide(root, ['drawing', 'app']);
    change(root, 'src/a.ts', '2026-10-05T12:00:00+02:00'); // the nested repository: no merge of the project's brings it in
    gitOn(root, '2026-10-06T12:00:00+02:00', 'merge', '-q', '--no-ff', 'side', '-m', 'merge side');
    const listed = drifting(root);
    expect(listed).toHaveLength(2);
    expect(listed[0]).toStartWith('knowledge/planner/untouched.md: its source repo:src/own.ts changed on 2026-10-06, after the concept was last checked (2026-10-01)');
    expect(listed[1]).toStartWith('knowledge/planner/app.md: its source repo:repos/app/src/a.ts changed on 2026-10-05, after the concept was last checked (2026-10-04)');

    write(root, 'src/own.ts', 'export const changed = 2;\n');
    commitOn(root, '2026-10-08T12:00:00+02:00', 'a later change');
    const later = drifting(root);
    expect(later).toHaveLength(3);
    expect(later[0]).toStartWith('knowledge/planner/drawing.md: its source repo:src/own.ts changed on 2026-10-08, after the concept was last checked (2026-10-04)');
    expect(later[1]).toStartWith('knowledge/planner/untouched.md: its source repo:src/own.ts changed on 2026-10-08,');
  });

  test('git is asked about a merge only for a source the stamps leave drifted, once per run', () => {
    const root = nested();
    const nd = join(root, '.novadev');
    cites(root, 'drawing', ['repo:src/own.ts']);
    commitOn(root, '2026-10-01T10:00:00+02:00', 'the concept');
    const days = new Map<string, SourceChange | null>();
    const checks = new Map<string, boolean>();
    expect(sourceDrift(root, listConcepts(nd), days, checks)).toEqual([]);
    expect(checks.size).toBe(0); // nothing drifted by its stamps: no merge was asked about

    recheckOnSide(root, ['drawing']);
    gitOn(root, '2026-10-05T12:00:00+02:00', 'merge', '-q', '--no-ff', 'side', '-m', 'merge side');
    days.clear();
    expect(sourceDrift(root, listConcepts(nd), days, checks)).toEqual([]);
    const head = git(root, 'rev-parse', 'HEAD').stdout.trim();
    expect(days.get('src/own.ts\x002026-10-04')).toEqual({ day: '2026-10-05', commit: head, parents: git(root, 'rev-parse', 'HEAD^1', 'HEAD^2').stdout.trim().split('\n') });
    expect(checks).toEqual(new Map([[`${head}\x00planner/drawing.md\x00src/own.ts`, true]]));

    // A run commits nothing: the answers stand, and git is not asked again.
    checks.set(`${head}\x00planner/drawing.md\x00src/own.ts`, false);
    expect(sourceDrift(root, listConcepts(nd), days, checks).map((drift) => drift.sources)).toEqual([[{ resource: 'repo:src/own.ts', day: '2026-10-05' }]]);
    expect(checks.size).toBe(1);
    expect(sourceDrift(root, listConcepts(nd))).toEqual([]);
  });
});
