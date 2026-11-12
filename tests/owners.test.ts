// Area owners (owners.ts): `"owners"` in novadev.json maps feature areas and path globs to an owner and
// to reviewers. A todo's suggested owner (file-todo, todo show, the JSON lists), the required reviewers of
// a merge request, the reviews `novadev todo review` holds an approval for, `novadev owners`, and the
// audit in sync and doctor. A project without the setting behaves exactly as before.
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { auditOwners, globMatch, judgeReviews, matchRules, readOwners, readSignOffs, requiredReviewerLines, suggestOwner, whoOwns } from '../src/owners.ts';
import { forgetReviewCache } from '../src/review.ts';
import { statusData } from '../src/status.ts';
import { listFeatures } from '../src/lib.ts';
import { reviewTodo, showTodo } from '../src/todo.ts';
import { completed, exists, feature, git, project, read, run, setManifest, tempDir, todo, write } from './helpers.ts';

const REF = '2026-11-10_1/01-login';
const DEV = 'paperclip/dev';
const DEV2 = 'paperclip/dev-2';
const REV_A = 'paperclip/reviewer-a';
const REV_B = 'paperclip/reviewer-b';
const LEAD = 'paperclip/minifil';
const OWNERS = {
  areas: { auth: { owner: DEV, reviewers: [REV_A, 'human:anna'] } },
  paths: { 'src/billing/**': { owner: DEV2, reviewers: [REV_B] }, '*.sql': { reviewers: ['human:dba'] } },
};
const BRIEF = (title: string, body = 'The words.') => `# prompt — x\n\n**Source:** chat-initiated — 2026-10-01\n\n## ${title}\n${body}\n`;

function json(out: { stdout: string }): Record<string, any> {
  return JSON.parse(out.stdout);
}

function payload(root: string, name: string, value: unknown): string {
  write(root, name, JSON.stringify(value));
  return name;
}

/** A project with owners and two features: FEAT-0001 (area auth, touches src/auth/) and FEAT-0002 (area billing, touches src/billing/). */
function owned(manifest: Record<string, unknown> = {}): string {
  const root = project({ owners: OWNERS, ...manifest });
  feature(root, 'FEAT-0001', 'login', { area: 'auth', touches: 'src/auth/' });
  feature(root, 'FEAT-0002', 'invoices', { area: 'billing', touches: 'src/billing/' });
  return root;
}

/** A finished todo whose record links a feature and names a commit that changed `files`. */
function finished(root: string, featureLine: string, files: string[]): string {
  todo(root, REF, { 'prompt.md': BRIEF('Magic link') });
  if (!exists(root, '.git')) {
    git(root, 'init', '-q', '-b', 'main');
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'base');
  }
  for (const file of files) write(root, file, `// ${file} ${Math.random()}\n`);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '--allow-empty', '-m', 'work');
  const hash = git(root, 'rev-parse', '--short', 'HEAD').stdout.trim();
  write(root, `.novadev/todos/${REF}/ai_completed.md`, completed('01-login').replace('**Feature:** none — test fixture', `**Feature:** ${featureLine}\n**Commits:** ${hash}`));
  return hash;
}

function review(root: string, by: string, extra: Record<string, unknown> = {}) {
  forgetReviewCache();
  return run(root, 'todo', 'review', REF, payload(root, 'review.json', { verdict: 'APPROVE', by, checks: ['bun test — green'], ...extra }));
}

describe('the setting', () => {
  test('areas and paths become rules; a sub-repo is named before a colon; override lists who may approve without a review', () => {
    const root = project({ subrepos: ['repos/*'], owners: { ...OWNERS, paths: { ...OWNERS.paths, 'irrippr:ps/**': { reviewers: REV_A } }, override: ['human:filipp'] } });
    const owners = readOwners(join(root, '.novadev'));
    expect(owners.errors).toEqual([]);
    expect(owners.override).toEqual(['human:filipp']);
    expect(owners.rules.map((r) => [r.name, r.owner, r.reviewers, r.repo, r.glob])).toEqual([
      ['area auth', DEV, [REV_A, 'human:anna'], null, 'auth'],
      ['path src/billing/**', DEV2, [REV_B], null, 'src/billing/**'],
      ['path *.sql', null, ['human:dba'], null, '*.sql'],
      ['path irrippr:ps/**', null, [REV_A], 'irrippr', 'ps/**'],
    ]);
  });

  test('no setting: nothing is configured', () => {
    expect(readOwners(join(project(), '.novadev'))).toEqual({ configured: false, rules: [], override: [], errors: [] });
  });

  test('what novadev cannot read is named by sync and doctor, and left out', () => {
    const root = project({
      owners: {
        area: {},
        areas: { auth: { owner: 'the boss' }, pay: { owner: DEV, reviewer: [REV_A] }, empty: {} },
        paths: { 'ghost:src/**': { owner: DEV }, '../out/**': { owner: DEV } },
        override: 'nobody',
      },
    });
    const nd = join(root, '.novadev');
    expect(readOwners(nd).rules.map((r) => r.name)).toEqual(['area pay', 'path ghost:src/**']);
    const audit = auditOwners(nd);
    for (const text of [
      'unknown key "area" (known: areas, paths, override)',
      '"areas" → "auth" "owner": "the boss" is not an actor',
      '"areas" → "auth" names neither an "owner" nor "reviewers" novadev can read',
      '"areas" → "pay": unknown key "reviewer" (known: owner, reviewers)',
      '"areas" → "empty" names neither',
      '"paths" → "../out/**": a path inside the project is needed',
      '"override": "nobody" is not an actor',
      'the project names no sub-repo "ghost"',
    ]) {
      expect(audit.problems.join('\n')).toContain(text);
    }
    expect(audit.notes.join('\n')).toContain('names the area "pay", which no feature has');
    const sync = run(root, 'sync').stdout;
    expect(sync).toContain('✗ .novadev/novadev.json: "owners" — unknown key "area"');
    expect(run(root, 'doctor').stdout).toContain('.novadev/novadev.json: "owners" — unknown key "area"');
    expect(run(root, 'doctor').stdout).toContain('names the area "pay", which no feature has');
  });

  test('a healthy setting leaves sync clean', () => {
    const root = owned();
    run(root, 'sync');
    const sync = run(root, 'sync').stdout;
    expect(sync).not.toContain('owners');
    expect(sync).not.toContain('PROBLEMS');
  });
});

describe('globs', () => {
  test('*, **, ?, a plain folder or file, a bare name in any folder', () => {
    expect(globMatch('src/billing/**', 'src/billing/a/b.ts')).toBe(true);
    expect(globMatch('src/billing/**', 'src/billing')).toBe(true);
    expect(globMatch('src/billing/**', 'src/billing2/a.ts')).toBe(false);
    expect(globMatch('src/*/api.ts', 'src/auth/api.ts')).toBe(true);
    expect(globMatch('src/*/api.ts', 'src/auth/v2/api.ts')).toBe(false);
    expect(globMatch('src/**/api.ts', 'src/auth/v2/api.ts')).toBe(true);
    expect(globMatch('src/**/api.ts', 'src/api.ts')).toBe(true);
    expect(globMatch('src/auth', 'src/auth/login.ts')).toBe(true);
    expect(globMatch('src/auth/', 'src/authx/login.ts')).toBe(false);
    expect(globMatch('src/login.ts', 'src/login.ts')).toBe(true);
    expect(globMatch('*.sql', 'db/migrations/001.sql')).toBe(true);
    expect(globMatch('*.sql', 'db/001.sql.bak')).toBe(false);
    expect(globMatch('migrations*', 'db/migrations-old/1.txt')).toBe(true);
    expect(globMatch('src/a?.ts', 'src/ab.ts')).toBe(true);
    expect(globMatch('src/a?.ts', 'src/abc.ts')).toBe(false);
    expect(globMatch('src/a.ts', 'src/axts')).toBe(false);
  });

  test('a sub-repo rule holds only that sub-repo\'s files, by the folder the project gives it', () => {
    const root = project({ subrepos: ['repos/*'], owners: { paths: { 'irrippr:ps/**': { reviewers: [REV_A] }, 'ps/**': { reviewers: [REV_B] } } } });
    const owners = readOwners(join(root, '.novadev'));
    const names = (files: string[]) => matchRules(root, owners, { files }).map((m) => m.rule.name);
    expect(names(['repos/irrippr/ps/a.js'])).toEqual(['path irrippr:ps/**']);
    expect(names(['ps/a.js'])).toEqual(['path ps/**']);
    expect(names(['repos/irris/ps/a.js'])).toEqual([]);
  });
});

describe('the suggested owner', () => {
  test('from the feature a todo names (its area, its touches) and from the paths its brief names', () => {
    const root = owned();
    todo(root, '2026-11-10_1/01-login', { 'prompt.md': BRIEF('Magic link', 'Feature: FEAT-0001 — the login needs a magic link.') });
    todo(root, '2026-11-10_1/02-invoice', { 'prompt.md': BRIEF('Invoice totals', 'The totals in `src/billing/totals.ts` are wrong, see https://example.com/a/b.') });
    todo(root, '2026-11-10_1/03-linked', { 'prompt.md': BRIEF('Rounding'), 'ai_progress.md': '# ai_progress — 03-linked\n\n**Date:** 2026-11-10\n**Feature:** FEAT-0002\n\nHalf way.\n' });
    todo(root, '2026-11-10_1/04-other', { 'prompt.md': BRIEF('A new icon', 'A nicer icon in `assets/icon.svg`.') });
    const todos = json(run(root, 'todo', 'list', '--json')).todos as any[];
    expect(todos.map((t) => [t.todo, t.suggestedOwner?.owner])).toEqual([
      ['01-login', DEV],
      ['02-invoice', DEV2],
      ['03-linked', DEV2],
      ['04-other', undefined],
    ]);
    expect(todos[0].suggestedOwner).toEqual({ owner: DEV, because: ['area auth (FEAT-0001)'] });
    expect(todos[1].suggestedOwner).toEqual({ owner: DEV2, because: ['path src/billing/** (src/billing/totals.ts)'] });
    expect(todos[2].suggestedOwner).toEqual({ owner: DEV2, because: ['path src/billing/** (FEAT-0002 touches src/billing/)'] });
    expect(todos[3]).not.toHaveProperty('suggestedOwner');
    // todo show and status --json carry the same; the printed lists do not change
    expect(showTodo(join(root, '.novadev'), '2026-11-10_1/02').suggestedOwner).toEqual(todos[1].suggestedOwner);
    const status = statusData(join(root, '.novadev')) as { batches: { todos: Record<string, any>[] }[] };
    expect(status.batches[0]!.todos.map((t) => t.suggestedOwner?.owner)).toEqual([DEV, DEV2, DEV2, undefined]);
    expect(run(root, 'todo', 'list').stdout).toBe(
      '2026-11-10_1/01-login  (open)  Magic link\n2026-11-10_1/02-invoice  (open)  Invoice totals\n2026-11-10_1/03-linked  (progress)  Rounding\n2026-11-10_1/04-other  (open)  A new icon\n',
    );
  });

  test('the owner most rules name; the others are listed', () => {
    const root = owned();
    const owners = readOwners(join(root, '.novadev'));
    const features = listFeatures(join(root, '.novadev'));
    const suggestion = suggestOwner(matchRules(root, owners, { features, files: ['src/billing/a.ts'], touches: true }));
    // one rule each: the first in the setting's order is suggested, the other is named beside it
    expect(suggestion).toEqual({ owner: DEV, because: ['area auth (FEAT-0001)'], others: [{ owner: DEV2, because: ['path src/billing/** (src/billing/a.ts, FEAT-0002 touches src/billing/)'] }] });
    const two = suggestOwner(matchRules(root, owners, { features, files: ['src/billing/a.ts', 'db/1.sql'], touches: true }));
    expect(two!.owner).toBe(DEV);
    setManifest(root, { owners: { ...OWNERS, paths: { ...OWNERS.paths, '*.sql': { owner: DEV2 } } } });
    expect(suggestOwner(matchRules(root, readOwners(join(root, '.novadev')), { features, files: ['src/billing/a.ts', 'db/1.sql'], touches: true }))!.owner).toBe(DEV2);
    expect(suggestOwner([])).toBeNull();
  });

  test('file-todo answers with it', () => {
    const root = owned();
    const filed = json(
      run(root, 'file-todo', 'file', payload(root, 'f.json', {
        parts: [
          { slug: 'magic-link', title: 'Magic link', request: '**Feature:** FEAT-0001\nSend a link instead of a password.' },
          { slug: 'new-icon', title: 'A new icon', request: 'A nicer icon.' },
        ],
      })),
    ).filed as any[];
    expect(filed[0].suggestedOwner).toEqual({ owner: DEV, because: ['area auth (FEAT-0001)'] });
    expect(filed[1]).toEqual({ ref: filed[1].ref, path: `.novadev/todos/${filed[1].ref}`, attachments: [] });
  });
});

describe('novadev owners', () => {
  test('a path, an area, a sub-repo file; nothing that matches; the rules', () => {
    const root = owned({ subrepos: ['repos/*'], lead: LEAD, owners: { ...OWNERS, paths: { ...OWNERS.paths, 'irrippr:ps/**': { owner: DEV, reviewers: [REV_A] } } } });
    expect(json(run(root, 'owners', 'src/billing/totals.ts', '--json'))).toEqual({
      query: 'src/billing/totals.ts',
      configured: true,
      owner: DEV2,
      reviewers: [REV_B],
      rules: [{ rule: 'path src/billing/**', owner: DEV2, reviewers: [REV_B], because: ['src/billing/totals.ts'] }],
    });
    expect(run(root, 'owners', 'auth').stdout).toBe(`auth — owner: ${DEV}; reviewers: ${REV_A}, human:anna\n  area auth  owner: ${DEV}  reviewers: ${REV_A}, human:anna  (area auth)\n`);
    // a file a feature touches is in that feature's area
    expect(whoOwns(join(root, '.novadev'), 'src/auth/login.ts')).toMatchObject({ owner: DEV, rules: [{ rule: 'area auth', because: ['FEAT-0001'] }] });
    expect(whoOwns(join(root, '.novadev'), 'irrippr:ps/a.js')).toMatchObject({ owner: DEV, reviewers: [REV_A] });
    expect(whoOwns(join(root, '.novadev'), 'db/001.sql')).toMatchObject({ owner: null, reviewers: ['human:dba'] });
    expect(run(root, 'owners', 'README.md').stdout).toBe('README.md — no rule matches: nobody owns it, no review is required\n');
    const rules = run(root, 'owners').stdout;
    expect(rules).toContain('owners — 4 rule(s)\n  area auth  owner: paperclip/dev  reviewers: paperclip/reviewer-a, human:anna\n');
    expect(rules).toContain(`may approve without a required review (with a reason): a person, or ${LEAD}`);
    expect(json(run(root, 'owners', '--json'))).toMatchObject({ configured: true, lead: [LEAD], override: [], errors: [] });
  });

  test('a project without owners says so, and answers nothing', () => {
    const root = project();
    expect(run(root, 'owners').stdout).toBe('owners — none set ("owners" in .novadev/novadev.json)\n');
    expect(run(root, 'owners', 'src/a.ts').stdout).toBe('owners — none set ("owners" in .novadev/novadev.json)\n');
    expect(json(run(root, 'owners', 'src/a.ts', '--json'))).toEqual({ query: 'src/a.ts', configured: false, owner: null, reviewers: [], rules: [] });
  });
});

describe('the merge request names the required reviewers', () => {
  test('the path rules of the changed files and the areas of the features that touch them', () => {
    const root = owned();
    expect(requiredReviewerLines(root, ['src/billing/totals.ts', 'src/auth/login.ts', 'db/001.sql', '.novadev/todos/x/prompt.md', 'README.md'])).toEqual([
      'Required reviewers (one of each line must approve — `novadev todo review`):',
      `- area auth: ${REV_A} or human:anna — FEAT-0001`,
      `- path src/billing/**: ${REV_B} — src/billing/totals.ts`,
      '- path *.sql: human:dba — db/001.sql',
    ]);
    expect(requiredReviewerLines(root, ['README.md'])).toEqual([]);
    expect(requiredReviewerLines(project(), ['src/billing/totals.ts'])).toEqual([]);
  });

  test('novadev worktree mr carries the section — and no line of it without the setting', () => {
    const make = (manifest: Record<string, unknown>) => {
      const main = project();
      const wts = join(tempDir(), 'wts');
      setManifest(main, { worktree: { dir: wts }, ...manifest });
      write(main, 'src/base.ts', 'export const base = 1;\n');
      git(main, 'init', '-q', '-b', 'main');
      for (const [key, value] of [['user.name', 'novadev tests'], ['user.email', 'novadev@example.invalid'], ['commit.gpgsign', 'false'], ['core.hooksPath', '/dev/null']]) git(main, 'config', key!, value!);
      expect(run(main, 'deploy').code).toBe(0);
      run(main, 'sync');
      git(main, 'add', '-A');
      git(main, 'commit', '-q', '-m', 'start');
      expect(run(main, 'worktree', 'create', 'irr-1').code).toBe(0);
      const wt = join(wts, 'irr-1');
      write(wt, 'src/billing/totals.ts', 'export const total = 1;\n');
      git(wt, 'add', '-A');
      git(wt, 'commit', '-q', '-m', 'totals');
      return run(main, 'worktree', 'mr', 'irr-1').stdout;
    };
    const withOwners = make({ owners: OWNERS });
    expect(withOwners).toContain(`\n\nRequired reviewers (one of each line must approve — \`novadev todo review\`):\n- path src/billing/**: ${REV_B} — src/billing/totals.ts\n\nClaims: none\n`);
    const without = make({});
    expect(without).not.toContain('Required reviewers');
    expect(without).toContain('totals\n\nClaims: none\n');
  });
});

describe('novadev todo review with owners: one reviewer of each matching rule', () => {
  test('an approval by one area\'s reviewer is kept as a sign-off; the second area\'s reviewer completes it', () => {
    const root = owned({ team: true });
    const hash = finished(root, 'FEAT-0001', ['src/billing/totals.ts']);
    const nd = join(root, '.novadev');
    expect(showTodo(nd, REF).requiredReviewers).toEqual([
      { rule: 'area auth', reviewers: [REV_A, 'human:anna'] },
      { rule: 'path src/billing/**', reviewers: [REV_B] },
    ]);

    const first = json(review(root, REV_A));
    expect(first).toMatchObject({
      verdict: 'PARTIAL',
      approved: false,
      state: 'review',
      requiredReviewers: [
        { rule: 'area auth', reviewers: [REV_A, 'human:anna'], approvedBy: REV_A },
        { rule: 'path src/billing/**', reviewers: [REV_B], approvedBy: null },
      ],
      waitingFor: [{ rule: 'path src/billing/**', reviewers: [REV_B] }],
      message: `Kept as a sign-off, not the approval yet: path src/billing/** needs one of ${REV_B}.`,
    });
    expect(first.signoffs).toMatchObject([{ by: REV_A }]);
    const text = read(root, `.novadev/todos/${REF}/ai_review.md`);
    expect(text).toContain(`**Verdict:** PARTIAL — approved by ${REV_A}; still needed: path src/billing/** (one of ${REV_B})`);
    expect(text).toContain(`**Reviewed commits:** ${hash}`);
    expect(text).toContain(`**Required reviewers:** area auth — ${REV_A} ✓; path src/billing/** — one of ${REV_B} (waiting)`);
    expect(readSignOffs(text).signoffs.map((s) => s.by)).toEqual([REV_A]);
    expect(run(root, 'sync').stdout).toContain(`◇ ${REF} — finished; reviewed in part — still needed: path src/billing/** (one of ${REV_B})`);

    // somebody no rule names: kept too, still not the approval
    const stranger = json(review(root, 'claude-code/passer-by'));
    expect(stranger).toMatchObject({ verdict: 'PARTIAL', approved: false });
    expect(stranger.signoffs.map((s: any) => s.by)).toEqual([REV_A, 'claude-code/passer-by']);

    const second = json(review(root, REV_B));
    expect(second).toMatchObject({ verdict: 'APPROVE', approved: true, state: 'completed' });
    expect(second).not.toHaveProperty('waitingFor');
    expect(second.signoffs.map((s: any) => s.by)).toEqual([REV_A, 'claude-code/passer-by', REV_B]);
    const done = read(root, `.novadev/todos/${REF}/ai_review.md`);
    expect(done).toContain('**Verdict:** APPROVE\n');
    expect(done).toContain(`**Required reviewers:** area auth — ${REV_A} ✓; path src/billing/** — ${REV_B} ✓`);
  });

  test('one reviewer named by both rules is enough for both', () => {
    const root = owned({ owners: { areas: { auth: { reviewers: [REV_A] } }, paths: { 'src/billing/**': { reviewers: [REV_B, REV_A] } } } });
    finished(root, 'FEAT-0001', ['src/billing/totals.ts']);
    expect(json(review(root, REV_A))).toMatchObject({ verdict: 'APPROVE', approved: true, state: 'completed' });
  });

  test('without team mode a PARTIAL review still holds the todo in review', () => {
    const root = owned();
    finished(root, 'FEAT-0001', []);
    const list = () => json(run(root, 'todo', 'list', '--json')).todos.find((t: any) => t.ref === REF).state;
    expect(list()).toBe('completed');
    expect(json(review(root, 'claude-code/passer-by'))).toMatchObject({ verdict: 'PARTIAL', state: 'review' });
    expect(list()).toBe('review');
    expect(json(review(root, 'human:anna'))).toMatchObject({ verdict: 'APPROVE', approved: true, state: 'completed' });
    expect(list()).toBe('completed');
  });

  test('the lead overrides with a reason, which the review records; another agent may not; a reason is needed', () => {
    const root = owned({ lead: LEAD });
    finished(root, 'FEAT-0001', ['src/billing/totals.ts']);
    const nobody = json(review(root, DEV, { override: { reason: 'It is fine.' } }));
    expect(nobody.error).toBe(
      `"${DEV}" may not approve without the required reviews (area auth, path src/billing/**): an override is for a person, or ${LEAD}. Without "override" the approval is kept as a sign-off.`,
    );
    expect(json(review(root, LEAD, { override: {} })).error).toContain('An override needs its reason');
    expect(exists(root, `.novadev/todos/${REF}/ai_review.md`)).toBe(false);

    json(review(root, REV_A));
    const over = json(review(root, LEAD, { override: { reason: 'Hotfix for production;\nreviewer-b is offline until Monday.' } }));
    expect(over).toMatchObject({
      verdict: 'APPROVE',
      approved: true,
      state: 'completed',
      override: { by: LEAD, reason: 'Hotfix for production; reviewer-b is offline until Monday.', without: ['path src/billing/**'] },
    });
    expect(over.override.at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    const text = read(root, `.novadev/todos/${REF}/ai_review.md`);
    expect(text).toContain('**Verdict:** APPROVE\n');
    expect(text).toMatch(new RegExp(`\\*\\*Override:\\*\\* ${LEAD} @ \\S+ — Hotfix for production; reviewer-b is offline until Monday\\.`));
    expect(text).toContain(`path src/billing/** — one of ${REV_B} (overridden)`);
  });

  test('a person may override; so may an actor of "override"; an override nobody needs is not recorded', () => {
    const root = owned({ owners: { ...OWNERS, override: ['paperclip/cto'] } });
    finished(root, 'FEAT-0001', []);
    expect(json(review(root, 'paperclip/cto', { override: { reason: 'Reviewed in the call.' } }))).toMatchObject({ approved: true, override: { by: 'paperclip/cto', without: ['area auth'] } });
    expect(json(review(root, 'human:filipp', { override: 'My call.' }))).toMatchObject({ approved: true, override: { by: 'human:filipp', reason: 'My call.' } });
    const plain = json(review(root, REV_A, { override: { reason: 'not needed' } }));
    expect(plain).toMatchObject({ approved: true, verdict: 'APPROVE' });
    expect(plain).not.toHaveProperty('override');
  });

  test('sign-offs are for the commits the record names: new commits ask for the reviews again; CHANGES clears them', () => {
    const root = owned();
    finished(root, 'FEAT-0001', ['src/billing/totals.ts']);
    json(review(root, REV_A));
    finished(root, 'FEAT-0001', ['src/billing/totals.ts']);
    const again = json(review(root, REV_B));
    expect(again).toMatchObject({ verdict: 'PARTIAL', approved: false, waitingFor: [{ rule: 'area auth' }] });
    expect(again.dropped.signoffs).toEqual([REV_A]);
    expect(again.signoffs.map((s: any) => s.by)).toEqual([REV_B]);

    const changes = json(review(root, REV_A, { verdict: 'CHANGES', findings: 'The total is off by one.' }));
    expect(changes).toMatchObject({ verdict: 'CHANGES', state: 'changes' });
    expect(changes).not.toHaveProperty('signoffs');
    expect(read(root, `.novadev/todos/${REF}/ai_review.md`)).not.toContain('Sign-offs');
    expect(json(review(root, REV_A))).toMatchObject({ verdict: 'PARTIAL', signoffs: [{ by: REV_A }] });
  });

  test('without commits in the record the features\' touches stand in for the files', () => {
    const root = owned();
    todo(root, REF, { 'prompt.md': BRIEF('Totals'), 'ai_completed.md': completed('01-login').replace('none — test fixture', 'FEAT-0002') });
    expect(json(review(root, REV_A))).toMatchObject({ verdict: 'PARTIAL', waitingFor: [{ rule: 'path src/billing/**', reviewers: [REV_B] }] });
    expect(read(root, `.novadev/todos/${REF}/ai_review.md`)).toContain('**Reviewed commits:** none');
    expect(json(review(root, REV_B))).toMatchObject({ verdict: 'APPROVE', approved: true });
  });

  test('judgeReviews: one reviewer per rule', () => {
    const required = [
      { rule: 'area auth', reviewers: [REV_A, 'human:anna'], because: [] },
      { rule: 'path x', reviewers: [REV_B], because: [] },
    ];
    expect(judgeReviews(required, []).missing.map((m) => m.rule)).toEqual(['area auth', 'path x']);
    expect(judgeReviews(required, [{ by: 'human:anna', at: '2026-11-12T10:00:00+01:00' }]).missing.map((m) => m.rule)).toEqual(['path x']);
    expect(judgeReviews(required, [{ by: 'human:anna', at: 'x' }, { by: REV_B, at: 'x' }]).missing).toEqual([]);
  });
});

describe('no owners configured: everything as before', () => {
  test('a review, a todo, a filing and the lists carry no key more, and an "override" in the payload is ignored', () => {
    const root = project({ team: true });
    feature(root, 'FEAT-0001', 'login', { area: 'auth', touches: 'src/auth/' });
    finished(root, 'FEAT-0001', ['src/auth/login.ts']);
    const out = json(review(root, 'claude-code/reviewer', { override: { reason: 'x' } }));
    expect(Object.keys(out).sort()).toEqual(['ref', 'state', 'verdict', 'written']);
    expect(out).toMatchObject({ verdict: 'APPROVE', state: 'completed' });
    const text = read(root, `.novadev/todos/${REF}/ai_review.md`);
    expect(text).toBe(`# ai_review — 01-login\n\n**Date:** ${text.match(/\*\*Date:\*\* (\S+)/)![1]}\n**Verdict:** APPROVE\n**Reviewer:** claude-code/reviewer\n\n## Checks\n\n- bun test — green\n\n## Findings\n\nNone.\n`);
    const shown = showTodo(join(root, '.novadev'), REF);
    expect(shown).not.toHaveProperty('suggestedOwner');
    expect(shown).not.toHaveProperty('requiredReviewers');
    expect(json(run(root, 'todo', 'list', '--json')).todos[0]).not.toHaveProperty('suggestedOwner');
    expect(run(root, 'doctor').stdout).not.toContain('owners');
  });

  test('owners with no rule that matches the work: the review is the plain one', () => {
    const root = owned();
    finished(root, 'none — a docs change', ['docs/readme.md']);
    const out = json(review(root, 'claude-code/reviewer'));
    expect(Object.keys(out).sort()).toEqual(['ref', 'state', 'verdict', 'written']);
    expect(read(root, `.novadev/todos/${REF}/ai_review.md`)).not.toContain('Sign-offs');
  });
});
