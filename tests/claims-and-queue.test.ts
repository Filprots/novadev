// Batch 2026-11-12_2, todos 03 and 04: claims as notices with protected paths ("claims": "notice",
// "protectedPaths"), and the merge queue (`novadev worktree queue add|list|run|remove`) that brings
// each branch onto the newest default branches and checks the merged result before it lands.
import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { judgeOverlaps, parseClaimsSetting, parseProtectedPaths, protectedBy } from '../src/claim-policy.ts';
import { git, project, read, run, setManifest, tempDir, todo, write } from './helpers.ts';

function quiet(repo: string): void {
  git(repo, 'config', 'user.name', 'novadev tests');
  git(repo, 'config', 'user.email', 'novadev@example.invalid');
  git(repo, 'config', 'commit.gpgsign', 'false');
  git(repo, 'config', 'core.hooksPath', '/dev/null');
}

function commit(repo: string, message: string): string {
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', message);
  return git(repo, 'rev-parse', '--short', 'HEAD').stdout.trim();
}

/** A super-repo on main with one sub-repo (irrippr, on master); `manifest` adds settings. */
function superRepo(manifest: Record<string, unknown> = {}, gate: Record<string, string[]> = {}): { main: string; wts: string } {
  const main = project();
  const wts = join(tempDir(), 'wts');
  setManifest(main, { subrepos: ['repos/*'], worktree: { dir: wts, gate }, ...manifest });
  write(main, '.gitignore', 'repos/\n');
  write(main, 'src/base.ts', 'export const base = 1;\n');
  write(main, 'src/format/save.ts', 'export const save = 1;\n');
  todo(main, '2026-11-12_2/01-one');
  todo(main, '2026-11-12_2/02-two');
  git(main, 'init', '-q', '-b', 'main');
  quiet(main);
  const sub = join(main, 'repos', 'irrippr');
  write(main, 'repos/irrippr/a.js', 'one\n');
  git(sub, 'init', '-q', '-b', 'master');
  quiet(sub);
  commit(sub, 'start');
  expect(run(main, 'deploy').code).toBe(0);
  run(main, 'sync');
  commit(main, 'start');
  return { main, wts };
}

const NOTICE = { claims: 'notice', protectedPaths: ['src/format/', 'irrippr:core/**'] };

describe('the settings', () => {
  test('"claims" is lock or notice; "protectedPaths" is a list of paths or globs, normalised like claims', () => {
    expect(parseClaimsSetting(undefined)).toEqual({ ok: true, value: 'lock' });
    expect(parseClaimsSetting('notice')).toEqual({ ok: true, value: 'notice' });
    expect(parseClaimsSetting('warn').ok).toBe(false);
    const { main } = superRepo();
    expect(parseProtectedPaths(main, ['./src/format/', 'irrippr:core/**'])).toEqual({ ok: true, value: ['src/format', 'repos/irrippr/core/**'] });
    expect(parseProtectedPaths(main, 'src').ok).toBe(false);
    expect(parseProtectedPaths(main, ['nosuch:x']).ok).toBe(false);
    expect(parseProtectedPaths(main, ['../x']).ok).toBe(false);
  });

  test('a protected path holds the files under it; a glob too; under "lock" nothing is named protected', () => {
    const policy = { mode: 'notice' as const, protectedPaths: ['src/format', 'repos/irrippr/core/**', 'lib/*/schema.ts'] };
    expect(protectedBy(policy, 'src/format/save.ts')).toBe('src/format');
    expect(protectedBy(policy, 'src/formatter.ts')).toBeNull();
    expect(protectedBy(policy, 'repos/irrippr/core/a/b.js')).toBe('repos/irrippr/core/**');
    expect(protectedBy(policy, 'lib/x/schema.ts')).toBe('lib/*/schema.ts');
    expect(protectedBy(policy, 'lib/x/y/schema.ts')).toBeNull();
    expect(protectedBy({ ...policy, mode: 'lock' }, 'src/format/save.ts')).toBeNull();
    const holder = { kind: 'worktree' as const, id: 'w', worktree: '/w', branch: null, agent: null, claims: [] };
    const over = (claim: string, theirs: string) => ({ claim, theirs, holder });
    // A folder above a protected path reaches it: two claims on `src` share `src/format` too.
    const judged = judgeOverlaps(policy, [over('src', 'src'), over('src/ui', 'src'), over('lib', 'lib/x'), over('lib/x/other.ts', 'lib/x/other.ts')]);
    expect(judged.hard.map((o) => o.claim)).toEqual(['src', 'lib']);
    expect(judged.soft.map((o) => o.claim)).toEqual(['src/ui', 'lib/x/other.ts']);
    expect(judgeOverlaps({ ...policy, mode: 'lock' }, [over('src/ui', 'src')]).hard).toHaveLength(1);
  });
});

describe('claims as notices', () => {
  test('without the setting an overlap is refused, as before — with protectedPaths set or not', () => {
    const { main } = superRepo({ protectedPaths: ['src/format/'] });
    expect(run(main, 'worktree', 'create', 'w1', '--claim', 'src/ui/').code).toBe(0);
    const refused = run(main, 'worktree', 'create', 'w2', '--claim', 'src/ui/a.ts');
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain('One owner per file');
    expect(refused.stderr).not.toContain('protected');
  });

  test('outside the protected paths both go on and both are listed; under one the claim is refused as before', () => {
    const { main, wts } = superRepo(NOTICE);
    expect(run(main, 'worktree', 'create', 'w1', '--claim', 'src/ui/', '--claim', 'src/format/save.ts').code).toBe(0);
    const second = run(main, 'worktree', 'create', 'w2', '--claim', 'src/ui/a.ts');
    expect(second.code).toBe(0);
    expect(second.stdout).toContain('shared (a notice, not a lock): src/ui/a.ts overlaps src/ui — claimed by worktree w1');

    const list = JSON.parse(run(main, 'worktree', 'list', '--json').stdout).worktrees;
    expect(list.find((w: any) => w.name === 'w1').shares).toEqual([{ path: 'src/ui/a.ts', with: 'worktree w2' }]);
    expect(list.find((w: any) => w.name === 'w2').shares).toEqual([{ path: 'src/ui/a.ts', with: 'worktree w1' }]);
    const status = run(main, 'status').stdout;
    expect(status).toContain('shared claims — 1');
    expect(status).toContain('src/ui/a.ts — worktree w1 and worktree w2');
    expect(JSON.parse(run(main, 'status', '--json').stdout).sharedClaims).toEqual([{ path: 'src/ui/a.ts', between: ['worktree w1', 'worktree w2'] }]);

    // The protected path stays a lock: create, worktree claim, work start --claim and work claim.
    const refused = run(main, 'worktree', 'create', 'w3', '--claim', 'src/format/');
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain('src/format overlaps src/format/save.ts — claimed by worktree w1');
    expect(refused.stderr).toContain('These paths are protected ("protectedPaths" in novadev.json)');
    expect(run(main, 'worktree', 'claim', 'w2', 'src/format/save.ts').code).toBe(1);
    const w2 = join(wts, 'w2');
    expect(JSON.parse(run(w2, 'work', 'start', '2026-11-12_2/02', '--agent', 'claude-code/test', '--claim', 'src/format/save.ts').stdout).error).toContain('These paths are protected');
    const started = JSON.parse(run(w2, 'work', 'start', '2026-11-12_2/02', '--agent', 'claude-code/test', '--claim', 'src/ui/b.ts').stdout);
    expect(started.taken).toBe(true);
    expect(started.shared[0]).toContain('src/ui/b.ts overlaps src/ui — claimed by worktree w1');
    expect(JSON.parse(run(w2, 'work', 'claim', '2026-11-12_2/02', 'src/format/save.ts').stdout).error).toContain('These paths are protected');
    expect(JSON.parse(run(w2, 'work', 'claim', '2026-11-12_2/02', 'src/ui/c.ts').stdout).shared[0]).toContain('src/ui/c.ts overlaps src/ui');
    // The lead's decision still passes.
    expect(run(main, 'worktree', 'claim', 'w2', 'src/format/save.ts', '--allow-overlap').stdout).toContain('overlaps (allowed): src/format/save.ts overlaps src/format/save.ts');
  });

  test('the gate passes with a shared unprotected file and names it — in the merge request too; it fails on a protected file the worktree does not hold', () => {
    const { main, wts } = superRepo(NOTICE);
    run(main, 'worktree', 'create', 'w1', '--claim', 'src/ui/');
    run(main, 'worktree', 'create', 'w2', '--claim', 'docs/');
    const [w1, w2] = [join(wts, 'w1'), join(wts, 'w2')];
    write(w1, 'src/base.ts', 'export const base = 2;\n');
    commit(w1, 'base in w1');
    // Outside its claims, in a file w1 changed too, and in a folder w1 claims: all three are notices.
    write(w2, 'src/base.ts', 'export const base = 3;\n');
    write(w2, 'src/ui/x.ts', 'x\n');
    write(w2, 'lib/free.ts', 'free\n');
    commit(w2, 'w2');
    const gate = run(main, 'worktree', 'gate', 'w2');
    expect(gate.code).toBe(0);
    expect(gate.stdout).toContain('✓ gate passed for w2');
    expect(gate.stdout).not.toContain('changed outside the claims');
    expect(gate.stdout).toContain('shared with other open worktrees');
    expect(gate.stdout).toContain('src/base.ts — also changed in worktree w1');
    expect(gate.stdout).toContain('src/ui/x.ts — claimed by worktree w1');
    expect(gate.stdout).not.toContain('lib/free.ts');
    const mr = run(main, 'worktree', 'mr', 'w2').stdout;
    expect(mr).toContain('Shared with other open worktrees');
    expect(mr).toContain('- src/base.ts — also changed in worktree w1');

    write(w2, 'src/format/save.ts', 'export const save = 2;\n');
    commit(w2, 'format');
    const failed = run(main, 'worktree', 'gate', 'w2');
    expect(failed.code).toBe(1);
    expect(failed.stdout).toContain('project: changed under a protected path this worktree does not hold: src/format/save.ts (src/format)');
    expect(run(main, 'worktree', 'claim', 'w2', 'src/format/save.ts').code).toBe(0);
    expect(run(main, 'worktree', 'gate', 'w2').code).toBe(0);
  });
});

describe('the merge queue', () => {
  test('add, list, remove; a second add keeps the place; remove of the worktree leaves the queue', () => {
    const { main } = superRepo();
    run(main, 'worktree', 'create', 'w1');
    run(main, 'worktree', 'create', 'w2');
    expect(run(main, 'worktree', 'queue', 'list').stdout).toContain('the merge queue is empty');
    expect(run(main, 'worktree', 'queue', 'add', 'w1', '--agent', 'paperclip/minifil').stdout).toContain('✓ w1 queued for merge — place 1 of 1');
    expect(run(main, 'worktree', 'queue', 'add', 'w2').stdout).toContain('place 2 of 2');
    expect(run(main, 'worktree', 'queue', 'add', 'w1').stdout).toContain('w1 is in the merge queue already (place 1)');
    expect(run(main, 'worktree', 'queue', 'add', 'nosuch').code).toBe(1);
    const list = run(main, 'worktree', 'queue', 'list').stdout;
    expect(list).toMatch(/ 1\. w1 {2}queued .* by paperclip\/minifil\n 2\. w2 {2}queued/);
    expect(JSON.parse(run(main, 'worktree', 'queue', 'list', '--json').stdout).entries.map((e: any) => [e.name, e.position])).toEqual([['w1', 1], ['w2', 2]]);
    expect(JSON.parse(run(main, 'worktree', 'list', '--json').stdout).worktrees[1].queue).toMatchObject({ state: 'queued', position: 2 });
    const status = run(main, 'status').stdout;
    expect(status).toContain('merge queue — 2 waiting, 0 failed');
    expect(JSON.parse(run(main, 'status', '--json').stdout).mergeQueue.entries).toHaveLength(2);
    expect(run(main, 'worktree', 'queue', 'remove', 'w1').stdout).toContain('✓ w1 taken out of the merge queue');
    expect(run(main, 'worktree', 'queue', 'remove', 'w1').code).toBe(1);
    run(main, 'worktree', 'remove', 'w2');
    expect(run(main, 'worktree', 'queue', 'list').stdout).toContain('the merge queue is empty');
    // The express lane goes first.
    run(main, 'worktree', 'create', 'w3');
    run(main, 'worktree', 'queue', 'add', 'w1');
    expect(run(main, 'worktree', 'queue', 'add', 'w3', '--express').stdout).toContain('place 1 of 2 (express lane)');
  });

  test('two branches that each pass alone and conflict: the first lands, the second fails with nothing merged, the queue goes on; fixed and queued again it lands', () => {
    const { main, wts } = superRepo();
    for (const name of ['w1', 'w2', 'w3']) run(main, 'worktree', 'create', name);
    const [w1, w2, w3] = [join(wts, 'w1'), join(wts, 'w2'), join(wts, 'w3')];
    write(w1, 'src/base.ts', 'export const base = 2;\n');
    commit(w1, 'two');
    write(w2, 'src/base.ts', 'export const base = 3;\n');
    commit(w2, 'three');
    write(w3, 'src/other.ts', 'other\n');
    commit(w3, 'other');
    for (const name of ['w1', 'w2', 'w3']) expect(run(main, 'worktree', 'gate', name).code).toBe(0);
    for (const name of ['w1', 'w2', 'w3']) run(main, 'worktree', 'queue', 'add', name);

    const ran = run(main, 'worktree', 'queue', 'run');
    expect(ran.code).toBe(1);
    expect(ran.stdout).toContain('✓ merged w1 into project main');
    expect(ran.stdout).toContain('✗ project: w2 would conflict with main — nothing merged');
    expect(ran.stdout).toContain('✗ w2 failed — nothing of it merged; the queue goes on');
    expect(ran.stdout).toContain('✓ merged w3 into project main');
    expect(ran.stdout).toContain('merge queue: 2 landed, 1 failed, 0 still waiting');
    expect(read(main, 'src/base.ts')).toContain('base = 2');
    expect(read(main, 'src/other.ts')).toBe('other\n');
    // w3 was behind main by w1's merge: it was brought onto it, in its worktree, before it landed.
    expect(read(w3, 'src/base.ts')).toContain('base = 2');
    const list = run(main, 'worktree', 'queue', 'list').stdout;
    expect(list).toContain('✗ w2  FAILED');
    expect(list).toContain('w2 would conflict with main');
    expect(run(main, 'status').stdout).toContain('merge queue — 0 waiting, 1 failed');

    // Back to the builder: sync, resolve, queue again.
    expect(run(main, 'worktree', 'sync', 'w2').code).toBe(1);
    write(w2, 'src/base.ts', 'export const base = 5;\n');
    commit(w2, 'resolved');
    expect(run(main, 'worktree', 'queue', 'add', 'w2').stdout).toContain('(again, after its failure)');
    const again = run(main, 'worktree', 'queue', 'run');
    expect(again.code).toBe(0);
    expect(read(main, 'src/base.ts')).toContain('base = 5');
    expect(run(main, 'worktree', 'queue', 'list').stdout).toContain('the merge queue is empty');
  });

  test('two that merge cleanly but break a gate command together: the second is refused, and nothing of it lands — in an earlier repository neither', () => {
    // The project's check: a.ts and b.ts must not both exist. Each branch passes it alone.
    const { main, wts } = superRepo({}, { '.': ['! (test -f src/a.ts && test -f src/b.ts)'] });
    run(main, 'worktree', 'create', 'w1');
    run(main, 'worktree', 'create', 'w2', 'irrippr');
    const [w1, w2] = [join(wts, 'w1'), join(wts, 'w2')];
    write(w1, 'src/a.ts', 'a\n');
    commit(w1, 'a');
    write(w2, 'src/b.ts', 'b\n');
    commit(w2, 'b');
    write(w2, 'repos/irrippr/a.js', 'two\n');
    commit(join(w2, 'repos/irrippr'), 'two');
    expect(run(main, 'worktree', 'gate', 'w1').code).toBe(0);
    expect(run(main, 'worktree', 'gate', 'w2').code).toBe(0);
    run(main, 'worktree', 'queue', 'add', 'w1');
    run(main, 'worktree', 'queue', 'add', 'w2');
    const ran = run(main, 'worktree', 'queue', 'run');
    expect(ran.code).toBe(1);
    expect(ran.stdout).toContain('✓ merged w1 into project main');
    expect(ran.stdout).toContain('✗ the checks failed on the merged result — nothing merged');
    expect(existsSync(join(main, 'src/b.ts'))).toBe(false);
    // The sub-repo merges first in a real merge: here it never started.
    expect(read(main, 'repos/irrippr/a.js')).toBe('one\n');
    expect(run(main, 'worktree', 'queue', 'list').stdout).toContain('the checks failed on the merged result: project: `! (test -f src/a.ts && test -f src/b.ts)` failed');

    // `worktree merge` is the direct form with the same checks.
    const direct = run(main, 'worktree', 'merge', 'w2', '--yes');
    expect(direct.code).toBe(1);
    expect(direct.stdout).toContain('✗ the checks failed on the merged result — nothing merged');
    expect(read(main, 'repos/irrippr/a.js')).toBe('one\n');
    expect(run(main, 'worktree', 'merge', 'w2').stdout).toContain('Before anything lands, the gate runs on the merged result');
  });

  test('a merge that fails late in the project undoes the sub-repo it had merged', () => {
    const { main, wts } = superRepo();
    run(main, 'worktree', 'create', 'w1', 'irrippr');
    const w1 = join(wts, 'w1');
    write(w1, 'src/a.ts', 'a\n');
    commit(w1, 'a');
    write(w1, 'repos/irrippr/a.js', 'two\n');
    commit(join(w1, 'repos/irrippr'), 'two');
    // A hook of the project's repository refuses the merge commit — after the sub-repo merged.
    write(main, '.git/hooks-test/commit-msg', '#!/bin/sh\nexit 1\n');
    require('node:fs').chmodSync(join(main, '.git/hooks-test/commit-msg'), 0o755);
    git(main, 'config', 'core.hooksPath', join(main, '.git/hooks-test'));
    run(main, 'worktree', 'queue', 'add', 'w1');
    const ran = run(main, 'worktree', 'queue', 'run');
    expect(ran.code).toBe(1);
    expect(ran.stdout).toContain('Undone: irrippr. Nothing is merged.');
    expect(read(main, 'repos/irrippr/a.js')).toBe('one\n');
    expect(existsSync(join(main, 'src/a.ts'))).toBe(false);
    expect(run(main, 'worktree', 'queue', 'list').stdout).toContain('✗ w1  FAILED');
  });

  test('one merge at a time: a live queue lock refuses a run and a direct merge; a dead one is taken over', () => {
    const { main, wts } = superRepo();
    run(main, 'worktree', 'create', 'w1');
    write(join(wts, 'w1'), 'src/a.ts', 'a\n');
    commit(join(wts, 'w1'), 'a');
    run(main, 'worktree', 'queue', 'add', 'w1');
    const lock = (pid: number) => write(main, '.git/novadev/queue.lock', JSON.stringify({ host: require('node:os').hostname(), pid, at: new Date().toISOString(), what: 'worktree queue run' }));
    lock(process.pid);
    const refused = run(main, 'worktree', 'queue', 'run');
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain('One merge at a time: worktree queue run is running');
    expect(run(main, 'worktree', 'merge', 'w1', '--yes').stderr).toContain('One merge at a time');
    expect(run(main, 'worktree', 'queue', 'list').stdout).toContain('running: worktree queue run');
    expect(existsSync(join(main, 'src/a.ts'))).toBe(false);
    lock(2 ** 22 + 12345);
    expect(run(main, 'worktree', 'queue', 'run').code).toBe(0);
    expect(read(main, 'src/a.ts')).toBe('a\n');
    expect(existsSync(join(main, '.git/novadev/queue.lock'))).toBe(false);
  });
});

describe('the docs', () => {
  test('the README, the playbook and the help teach the settings and the queue', () => {
    const readme = read(join(import.meta.dir, '..'), 'README.md');
    for (const words of ['"claims": "notice"', '`protectedPaths`', 'novadev worktree queue add <name>', 'checks the merged result before anything', '`mergeQueue`', '`sharedClaims`']) expect(readme).toContain(words);
    const playbook = read(join(import.meta.dir, '..'), 'templates/skills/novadev-work.md');
    for (const words of ['"claims": "notice"', '`protectedPaths`', 'novadev worktree queue run']) expect(playbook).toContain(words);
    const help = run(tempDir(), 'help').stdout;
    for (const words of ['"queue add <name> | list | run | remove <name>"', '"protectedPaths"']) expect(help).toContain(words);
  });
});
