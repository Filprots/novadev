// Batch 2026-11-12_2, todos 07 and 09: the work-in-progress limit per holder ("wipLimit",
// "wipCountsPaused") and the express lane for an urgent todo — exempt from the limit, pausing what
// its holder was in, first in the merge queue, and skipping no check.
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { parseWipSettings } from '../src/wip.ts';
import { completed, exists, git, project, read, run, setManifest, tempDir, todo, write } from './helpers.ts';

const A = 'paperclip/dev-1';
const B = 'paperclip/dev-2';

function repo(manifest: Record<string, unknown> = {}): { main: string; wts: string } {
  const main = project();
  const wts = join(tempDir(), 'wts');
  setManifest(main, { worktree: { dir: wts, gate: { '.': ['! test -f src/bad.ts'] } }, ...manifest });
  for (const t of ['01-one', '02-two', '03-three', '04-hotfix']) todo(main, `2026-11-12_2/${t}`);
  write(main, 'src/base.ts', 'base\n');
  git(main, 'init', '-q', '-b', 'main');
  git(main, 'config', 'user.name', 'novadev tests');
  git(main, 'config', 'user.email', 'novadev@example.invalid');
  git(main, 'config', 'commit.gpgsign', 'false');
  git(main, 'config', 'core.hooksPath', '/dev/null');
  expect(run(main, 'deploy').code).toBe(0);
  run(main, 'sync');
  commit(main, 'start');
  return { main, wts };
}

function commit(at: string, message: string): void {
  git(at, 'add', '-A');
  git(at, 'commit', '-q', '-m', message);
}

const start = (at: string, ref: string, agent = A, ...more: string[]) => JSON.parse(run(at, 'work', 'start', ref, '--agent', agent, ...more).stdout);
const urgent = (at: string, ref: string) => expect(run(at, 'todo', 'priority', ref, 'urgent', '--by', 'human:filipp').code).toBe(0);

describe('the settings', () => {
  test('"wipLimit" is a whole number (0 or absent: off); "wipCountsPaused" true or false', () => {
    expect(parseWipSettings({})).toEqual({ ok: true, value: { limit: null, countsPaused: true } });
    expect(parseWipSettings({ wipLimit: 0 })).toEqual({ ok: true, value: { limit: null, countsPaused: true } });
    expect(parseWipSettings({ wipLimit: 2, wipCountsPaused: false })).toEqual({ ok: true, value: { limit: 2, countsPaused: false } });
    expect(parseWipSettings({ wipLimit: '2' }).ok).toBe(false);
    expect(parseWipSettings({ wipLimit: 1.5 }).ok).toBe(false);
    expect(parseWipSettings({ wipCountsPaused: 'no' }).ok).toBe(false);
    const { main } = repo({ wipLimit: 'two' });
    expect(run(main, 'sync').stdout + run(main, 'sync').stderr).toContain('"wipLimit" must be a whole number');
  });
});

describe('the work-in-progress limit', () => {
  test('off by default: one holder starts as many todos as it likes', () => {
    const { main } = repo();
    for (const t of ['01', '02', '03']) expect(start(main, `2026-11-12_2/${t}`).taken).toBe(true);
    expect(run(main, 'status').stdout).not.toContain('work in progress —');
    expect(JSON.parse(run(main, 'status', '--json').stdout).wip).toMatchObject({ limit: null, holders: [{ agent: A, count: 3 }] });
  });

  test('at the limit one more is refused, naming what the holder has and how to free a slot; another holder is not', () => {
    const { main } = repo({ wipLimit: 2 });
    expect(start(main, '2026-11-12_2/01').taken).toBe(true);
    expect(start(main, '2026-11-12_2/02').taken).toBe(true);
    const refused = start(main, '2026-11-12_2/03');
    expect(refused.error).toContain(`Work-in-progress limit: ${A} holds 2 of 2 todo(s)`);
    expect(refused.error).toContain('2026-11-12_2/01-one — in work');
    expect(refused.error).toContain('2026-11-12_2/02-two — in work');
    expect(refused.error).toContain('Free a slot first: finish one and hand it to review');
    expect(exists(main, '.novadev/todos/2026-11-12_2/03-three/working.md')).toBe(false);
    // Resuming what it holds is not one more.
    expect(start(main, '2026-11-12_2/01').taken).toBe(true);
    expect(start(main, '2026-11-12_2/03', B).taken).toBe(true);
    // A lock without an actor cannot be counted.
    const status = run(main, 'status').stdout;
    expect(status).toContain('work in progress — limit 2 todo(s) per holder, paused ones count');
    expect(status).toMatch(/paperclip\/dev-1 {2}2\/2 {2}AT THE LIMIT {2}2026-11-12_2\/01-one, 2026-11-12_2\/02-two/);
    expect(status).toMatch(/paperclip\/dev-2 {2}1\/2 {2}2026-11-12_2\/03-three/);
  });

  test('a slot is freed by finishing (the record, then stop) and by a stop; several todos in one start are counted together', () => {
    const { main } = repo({ wipLimit: 2 });
    expect(start(main, '2026-11-12_2', A, '--todo', '01', '--todo', '02', '--todo', '03').error).toContain('this start would add 3');
    start(main, '2026-11-12_2/01');
    start(main, '2026-11-12_2/02');
    // Finished but still locked: its record frees the slot already; the stop releases the lock.
    write(main, '.novadev/todos/2026-11-12_2/01-one/ai_completed.md', completed('one'));
    expect(start(main, '2026-11-12_2/03').taken).toBe(true);
    expect(run(main, 'work', 'stop', '2026-11-12_2/03').code).toBe(0);
    expect(run(main, 'work', 'stop', '2026-11-12_2/02').code).toBe(0);
    expect(start(main, '2026-11-12_2/03').taken).toBe(true);
  });

  test('a paused todo takes a slot — unless "wipCountsPaused": false; a lock on a whole batch counts every unfinished todo of it', () => {
    const pause = (at: string, ref: string) => {
      write(at, 'pause.json', JSON.stringify({ stopped: 'Half way.', next: ['Go on.'] }));
      expect(run(at, 'work', 'pause', ref, 'pause.json').code).toBe(0);
    };
    const counted = repo({ wipLimit: 1 });
    start(counted.main, '2026-11-12_2/01');
    pause(counted.main, '2026-11-12_2/01');
    expect(start(counted.main, '2026-11-12_2/02').error).toContain('2026-11-12_2/01-one — paused');
    expect(start(counted.main, '2026-11-12_2/02').error).toContain('A paused todo takes a slot here.');

    const free = repo({ wipLimit: 1, wipCountsPaused: false });
    start(free.main, '2026-11-12_2/01');
    pause(free.main, '2026-11-12_2/01');
    expect(start(free.main, '2026-11-12_2/02').taken).toBe(true);
    // Resuming the paused one would be a second in work.
    expect(start(free.main, '2026-11-12_2/01').error).toContain('holds 1 of 1');
    expect(run(free.main, 'status').stdout).toContain('+ paused: 2026-11-12_2/01-one');

    const whole = repo({ wipLimit: 3 });
    expect(start(whole.main, '2026-11-12_2').error).toContain('this start would add 4');
    write(whole.main, '.novadev/todos/2026-11-12_2/04-hotfix/ai_completed.md', completed('hotfix'));
    expect(start(whole.main, '2026-11-12_2').taken).toBe(true);
    expect(JSON.parse(run(whole.main, 'status', '--json').stdout).wip.holders[0]).toMatchObject({ agent: A, count: 3, atLimit: true });
  });
});

describe('the express lane', () => {
  test('an urgent todo is started at the limit: the todo its holder was in is paused with a record, and status says who was paused for it', () => {
    const { main } = repo({ wipLimit: 1 });
    start(main, '2026-11-12_2/01');
    write(main, 'wp.json', JSON.stringify({ phase: 3, note: 'Half of the parser is written.' }));
    run(main, 'work', 'waypoint', '2026-11-12_2/01', 'wp.json');
    urgent(main, '2026-11-12_2/04');
    const started = start(main, '2026-11-12_2/04');
    expect(started.taken).toBe(true);
    expect(started.expressLane.urgent).toEqual(['2026-11-12_2/04-hotfix']);
    expect(started.expressLane.paused).toEqual([{ ref: '2026-11-12_2/01-one', waypoint: 2 }]);
    expect(started.expressLane.note).toContain('it skips no check');
    const lock = read(main, '.novadev/todos/2026-11-12_2/01-one/working.md');
    expect(lock).toContain('state: paused');
    expect(lock).toContain('Paused for the urgent todo 2026-11-12_2/04-hotfix (the express lane)');
    expect(lock).toContain('novadev work start 2026-11-12_2/01-one');
    expect(lock).toContain('Half of the parser is written.');
    const status = run(main, 'status').stdout;
    // The urgent todo is first in its batch, and names who was paused for it.
    expect(status.indexOf('04-hotfix')).toBeLessThan(status.indexOf('02-two'));
    expect(status).toContain('paused for it: 2026-11-12_2/01-one (paperclip/dev-1)');
    expect(status).toContain('+ urgent (exempt): 2026-11-12_2/04-hotfix');
    // Still at the limit for normal work (the paused one counts), and below the limit nothing is paused.
    expect(start(main, '2026-11-12_2/02').error).toContain('Work-in-progress limit');
    const other = repo({ wipLimit: 2 });
    start(other.main, '2026-11-12_2/01');
    urgent(other.main, '2026-11-12_2/04');
    expect(start(other.main, '2026-11-12_2/04').expressLane).toBeUndefined();
    expect(read(other.main, '.novadev/todos/2026-11-12_2/01-one/working.md')).toContain('state: working');
  });

  test('the urgent worktree overtakes queued normal ones — behind other express entries — and the checks still refuse a bad urgent branch', () => {
    const { main, wts } = repo();
    for (const name of ['n1', 'n2', 'hot', 'hot2']) run(main, 'worktree', 'create', name);
    urgent(main, '2026-11-12_2/04');
    commit(main, 'urgent');
    run(main, 'worktree', 'create', 'u1', '--todo', '2026-11-12_2/04');
    write(join(wts, 'n1'), 'src/n1.ts', 'n1\n');
    commit(join(wts, 'n1'), 'n1');
    write(join(wts, 'u1'), 'src/bad.ts', 'breaks the gate\n');
    commit(join(wts, 'u1'), 'bad');
    write(join(wts, 'hot'), 'src/hot.ts', 'hot\n');
    commit(join(wts, 'hot'), 'hot');
    run(main, 'worktree', 'queue', 'add', 'n1');
    run(main, 'worktree', 'queue', 'add', 'n2');
    expect(run(main, 'worktree', 'queue', 'add', 'hot', '--express').stdout).toContain('place 1 of 3 (express lane');
    const added = run(main, 'worktree', 'queue', 'add', 'u1').stdout;
    expect(added).toContain('place 2 of 4 (express lane: urgent 2026-11-12_2/04-hotfix');
    expect(added).toContain('every check still runs');
    expect(JSON.parse(run(main, 'worktree', 'queue', 'list', '--json').stdout).entries.map((e: any) => e.name)).toEqual(['hot', 'u1', 'n1', 'n2']);
    expect(run(main, 'status').stdout).toContain('2. u1 [express]');

    const ran = run(main, 'worktree', 'queue', 'run');
    expect(ran.code).toBe(1);
    expect(ran.stdout.indexOf('— hot (express lane)')).toBeLessThan(ran.stdout.indexOf('— u1 (express lane)'));
    expect(ran.stdout.indexOf('— u1 (express lane)')).toBeLessThan(ran.stdout.indexOf('— n1'));
    expect(ran.stdout).toContain('✗ u1 failed — nothing of it merged; the queue goes on');
    expect(exists(main, 'src/bad.ts')).toBe(false);
    expect(read(main, 'src/hot.ts')).toBe('hot\n');
    expect(read(main, 'src/n1.ts')).toBe('n1\n');
  });
});

describe('the docs', () => {
  test('the README, the playbook and the help teach the limit and the express lane', () => {
    const root = join(import.meta.dir, '..');
    const readme = read(root, 'README.md');
    for (const words of ['"wipLimit"', '`wipCountsPaused`', 'express lane', 'Work-in-progress limit', '`expressLane.paused`']) expect(readme).toContain(words);
    const playbook = read(root, 'templates/skills/novadev-work.md');
    for (const words of ['work-in-progress limit', 'express lane', 'Paused for the urgent todo']) expect(playbook).toContain(words);
    expect(run(tempDir(), 'help').stdout).toContain('"wipLimit"');
  });
});
