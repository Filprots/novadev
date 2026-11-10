// The review record and team mode (0.16.0): ai_review.md, `novadev todo review`, the `changes`,
// `review` and `unmerged` states.
import { describe, expect, test } from 'bun:test';
import { parseVerdict } from '../src/review.ts';
import { completed, exists, git, project, read, run, setManifest, todo, write } from './helpers.ts';

const REF = '2026-11-10_1/01-login';

function json(out: { stdout: string }): Record<string, any> {
  return JSON.parse(out.stdout);
}

function review(root: string, verdict: string, extra: Record<string, unknown> = {}) {
  write(root, 'review.json', JSON.stringify({ verdict, by: 'claude-code/reviewer', checks: [{ check: 'bun test', result: '12 pass, 0 fail' }], ...extra }));
  return run(root, 'todo', 'review', REF, 'review.json');
}

function state(root: string): string {
  return json(run(root, 'todo', 'list', '--json')).todos.find((t: { ref: string }) => t.ref === REF).state;
}

/** A team-mode project in git on main, with the todo's record committed on a task branch. */
function teamRepo(commits: (hash: string) => string = (hash) => hash): { root: string; hash: string } {
  const root = project({ team: true });
  todo(root, REF);
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'base');
  git(root, 'checkout', '-q', '-b', 'task/login');
  write(root, 'src/login.ts', 'export const login = 1;\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'login');
  const hash = git(root, 'rev-parse', '--short', 'HEAD').stdout.trim();
  write(root, `.novadev/todos/${REF}/ai_completed.md`, completed('01-login').replace('**Feature:** none — test fixture', `**Feature:** none — test fixture\n**Commits:** ${commits(hash)}`));
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'record');
  return { root, hash };
}

describe('the verdict', () => {
  test('reads APPROVE and CHANGES in the ways people write them', () => {
    expect(parseVerdict('APPROVE')).toBe('APPROVE');
    expect(parseVerdict('approved — nice work')).toBe('APPROVE');
    expect(parseVerdict('CHANGES')).toBe('CHANGES');
    expect(parseVerdict('changes requested')).toBe('CHANGES');
    expect(parseVerdict('request changes')).toBe('CHANGES');
    expect(parseVerdict('maybe')).toBeNull();
  });
});

describe('novadev todo review', () => {
  test('writes ai_review.md beside the record; a second review keeps the first in .review-history/', () => {
    const root = project();
    todo(root, REF, { 'ai_completed.md': completed('01-login') });
    const first = json(review(root, 'CHANGES', { findings: 'The error message is missing.' }));
    expect(first).toMatchObject({ verdict: 'CHANGES', state: 'changes', written: `todos/${REF}/ai_review.md` });
    const text = read(root, `.novadev/todos/${REF}/ai_review.md`);
    expect(text).toContain('**Verdict:** CHANGES');
    expect(text).toContain('**Reviewer:** claude-code/reviewer');
    expect(text).toContain('- `bun test` — 12 pass, 0 fail');
    expect(text).toContain('The error message is missing.');
    const second = json(review(root, 'APPROVE'));
    expect(second.state).toBe('completed');
    expect(second.previous).toMatch(/^todos\/2026-11-10_1\/01-login\/\.review-history\/.+\.md$/);
    expect(read(root, `.novadev/${second.previous}`)).toContain('**Verdict:** CHANGES');
  });

  test('refuses a todo with nothing finished, a verdict without checks, CHANGES without findings, a reviewer who is no actor', () => {
    const root = project();
    todo(root, REF);
    expect(json(review(root, 'APPROVE')).error).toContain('has no ai_completed.md');
    write(root, `.novadev/todos/${REF}/ai_completed.md`, completed('01-login'));
    write(root, 'r.json', JSON.stringify({ verdict: 'APPROVE', by: 'claude-code/reviewer', checks: [] }));
    expect(json(run(root, 'todo', 'review', REF, 'r.json')).error).toContain("'checks' must list what the reviewer ran");
    expect(json(review(root, 'CHANGES')).error).toContain("A CHANGES verdict needs 'findings'");
    expect(json(review(root, 'APPROVE', { by: 'somebody' })).error).toContain("'by' must be an actor");
    expect(json(review(root, 'LGTM')).error).toContain("'verdict' must be APPROVE or CHANGES");
  });
});

describe('without team mode', () => {
  test('a CHANGES review reopens a completed todo: a NEXT ACTION, the batch not complete', () => {
    const root = project({ archiveGraceDays: 3 });
    todo(root, REF, { 'ai_completed.md': completed('01-login') });
    review(root, 'CHANGES', { findings: 'Rename the function.' });
    expect(state(root)).toBe('changes');
    const out = run(root, 'sync').stdout;
    expect(out).toContain(`${REF}: its review asked for CHANGES (ai_review.md) — make them`);
    expect(exists(root, '.novadev/todos/2026-11-10_1/completed.md')).toBe(false);
    expect(run(root, 'status').stdout).toContain('↺ 01-login  (changes)');
    review(root, 'APPROVE');
    expect(state(root)).toBe('completed');
  });

  test('a completed todo needs no review', () => {
    const root = project();
    todo(root, REF, { 'ai_completed.md': completed('01-login') });
    expect(state(root)).toBe('completed');
  });
});

describe('team mode: completed = APPROVE + merged', () => {
  test('finished without a review it waits for one; approved off the default branch it waits for the merge', () => {
    const { root } = teamRepo();
    expect(state(root)).toBe('review');
    const waiting = run(root, 'sync').stdout;
    expect(waiting).toContain('WAITING ON REVIEW OR MERGE (1):');
    expect(waiting).toContain(`◇ ${REF} — finished; waiting for a review`);
    expect(waiting).not.toContain('NEXT ACTIONS');

    review(root, 'APPROVE');
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'review');
    expect(state(root)).toBe('unmerged');
    expect(run(root, 'sync').stdout).toMatch(/◇ 2026-11-10_1\/01-login — approved; waiting for the merge \(not on the default branch yet: [0-9a-f]+\)/);

    git(root, 'checkout', '-q', 'main');
    git(root, 'merge', '-q', '--no-ff', '-m', 'merge', 'task/login');
    expect(state(root)).toBe('completed');
  });

  test('a record without commits counts once it is committed on the default branch', () => {
    const { root } = teamRepo(() => 'none');
    review(root, 'APPROVE');
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'review');
    expect(state(root)).toBe('unmerged');
    git(root, 'checkout', '-q', 'main');
    git(root, 'merge', '-q', '--no-ff', '-m', 'merge', 'task/login');
    expect(state(root)).toBe('completed');
  });

  test('a sub-repo commit counts once it is on that repository\'s default branch', () => {
    const { root, hash } = teamRepo();
    setManifest(root, { subrepos: ['repos/*'] });
    const sub = `${root}/repos/irrippr`;
    write(root, '.gitignore', 'repos/\n');
    write(root, 'repos/irrippr/a.js', 'a\n');
    git(sub, 'init', '-q', '-b', 'master');
    git(sub, 'add', '-A');
    git(sub, 'commit', '-q', '-m', 'a');
    git(sub, 'checkout', '-q', '-b', 'task/login');
    write(root, 'repos/irrippr/a.js', 'b\n');
    git(sub, 'commit', '-q', '-am', 'b');
    const subHash = git(sub, 'rev-parse', '--short', 'HEAD').stdout.trim();
    write(root, `.novadev/todos/${REF}/ai_completed.md`, completed('01-login').replace('**Feature:** none — test fixture', `**Feature:** none — test fixture\n**Commits:** ${hash}, irrippr@${subHash}`));
    review(root, 'APPROVE');
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'record');
    git(root, 'checkout', '-q', 'main');
    git(root, 'merge', '-q', '--no-ff', '-m', 'merge', 'task/login');
    expect(state(root)).toBe('unmerged');
    expect(run(root, 'sync').stdout).toContain(`not on the default branch yet: irrippr@${subHash}`);
    git(sub, 'checkout', '-q', 'master');
    git(sub, 'merge', '-q', '--no-ff', '-m', 'merge', 'task/login');
    expect(state(root)).toBe('completed');
  });

  test('a finished todo waiting for its review takes no addendum', () => {
    const { root } = teamRepo();
    write(root, 'add.json', JSON.stringify({ text: 'One more thing.' }));
    expect(json(run(root, 'todo', 'addendum', REF, 'add.json')).error).toContain('is finished and waiting for its review');
  });
});
