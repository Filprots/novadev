// Records that name commits in several repositories (0.16.0): `repo@hash` and `**Repos:**`,
// resolved against the sub-repos "subrepos" in novadev.json names.
import { describe, expect, test } from 'bun:test';
import { commitRefsIn, forgetSubrepos, listSubrepos, parseSubreposSetting, repoNamesIn } from '../src/subrepos.ts';
import { commitAll, feature, git, project, read, run, setManifest, todo, write } from './helpers.ts';

/** A super-repo on main whose repos/irrippr is an independent repository it ignores. */
function superRepo(manifest: Record<string, unknown> = { subrepos: ['repos/*'] }): { root: string; own: string; sub: string } {
  const root = project(manifest);
  feature(root, 'FEAT-0001', 'layouting');
  write(root, '.gitignore', 'repos/\n');
  git(root, 'init', '-q', '-b', 'main');
  commitAll(root, 'super');
  const own = git(root, 'rev-parse', '--short', 'HEAD').stdout.trim();
  const subDir = `${root}/repos/irrippr`;
  write(root, 'repos/irrippr/src/big.js', 'one\n');
  git(subDir, 'init', '-q', '-b', 'master');
  git(subDir, 'add', '-A');
  git(subDir, 'commit', '-q', '-m', 'sub');
  write(root, 'repos/irrippr/src/big.js', 'two\n');
  git(subDir, 'commit', '-q', '-am', 'change big.js');
  const sub = git(subDir, 'rev-parse', '--short', 'HEAD').stdout.trim();
  forgetSubrepos();
  return { root, own, sub };
}

function record(commits: string, extra = ''): string {
  return `# ai_completed — 01-layout\n\n**Date:** 2026-11-10\n**Feature:** FEAT-0001\n**Commits:** ${commits}\n${extra}\n## What I did\nThe work.\n`;
}

describe('reading the lines', () => {
  test('commitRefsIn reads bare hashes and repo@hash, each once, in order', () => {
    expect(commitRefsIn('4f2a9c1, irrippr@abc1234, irrisketch_locales@9e8d7c6, 4f2a9c1')).toEqual([
      { repo: null, hash: '4f2a9c1', text: '4f2a9c1' },
      { repo: 'irrippr', hash: 'abc1234', text: 'irrippr@abc1234' },
      { repo: 'irrisketch_locales', hash: '9e8d7c6', text: 'irrisketch_locales@9e8d7c6' },
    ]);
    expect(commitRefsIn('`paper.js@abcdef0` (merge)')).toEqual([{ repo: 'paper.js', hash: 'abcdef0', text: 'paper.js@abcdef0' }]);
    expect(commitRefsIn('none — docs only; ask fil@example.org')).toEqual([]);
  });

  test('repoNamesIn reads a Repos line', () => {
    expect(repoNamesIn('irrippr, `irrisketch_locales`')).toEqual(['irrippr', 'irrisketch_locales']);
    expect(repoNamesIn('none')).toEqual([]);
  });

  test('the setting: folders inside the project, a last "/*" only', () => {
    expect(parseSubreposSetting(['repos/*', './vendor/engine/'])).toEqual({ ok: true, value: ['repos/*', 'vendor/engine'] });
    expect(parseSubreposSetting(null)).toEqual({ ok: true, value: [] });
    expect(parseSubreposSetting('repos/*').ok).toBe(false);
    expect(parseSubreposSetting(['../other']).ok).toBe(false);
    expect(parseSubreposSetting(['repos/*/src']).ok).toBe(false);
  });
});

describe('the link graph across repositories', () => {
  test('a sub-repo commit resolves in its own repository, and work.md shows it with the repos', () => {
    const { root, own, sub } = superRepo();
    todo(root, '2026-11-10_1/01-layout', { 'ai_completed.md': record(`${own}, irrippr@${sub}`, '**Repos:** irrippr\n') });
    const out = run(root, 'links', '--fix');
    expect(out.stdout).not.toContain('history');
    expect(out.stdout).not.toContain('not a sub-repo');
    const work = read(root, '.novadev/knowledge/features/FEAT-0001-layouting/work.md');
    expect(work).toContain(`\`irrippr@${sub}\` — 2026-11-10_1/01-layout`);
    expect(work).toContain(`\`${own}\` — 2026-11-10_1/01-layout`);
    expect(work).toContain('repos: irrippr');
  });

  test('a commit missing from the sub-repo, an unknown repo name, and an unknown Repos name are NEXT ACTIONS', () => {
    const { root } = superRepo();
    todo(root, '2026-11-10_1/01-layout', { 'ai_completed.md': record('irrippr@1234567, irris@abcdef0', '**Repos:** irrippr, irris\n') });
    const out = run(root, 'sync');
    expect(out.stdout).toContain("commit irrippr@1234567 (2026-11-10_1/01-layout) is not in irrippr's history (repos/irrippr)");
    expect(out.stdout).toContain('commit irris@abcdef0 (2026-11-10_1/01-layout) names the repository "irris", which is not a sub-repo');
    expect(out.stdout).toContain('2026-11-10_1/01-layout: **Repos:** names "irris", which is not a sub-repo');
  });

  test('a bare hash that belongs to a sub-repo gets the way to write it', () => {
    const { root, sub } = superRepo();
    todo(root, '2026-11-10_1/01-layout', { 'ai_completed.md': record(sub) });
    expect(run(root, 'sync').stdout).toContain(`commit ${sub} (2026-11-10_1/01-layout) is not in this repository's history — it is in irrippr: write it as irrippr@${sub}`);
  });

  test('two sub-repos with one name are a problem', () => {
    const { root } = superRepo({ subrepos: ['repos/*', 'more/*'] });
    write(root, 'more/irrippr/a.txt', 'a\n');
    git(`${root}/more/irrippr`, 'init', '-q');
    forgetSubrepos();
    expect(listSubrepos(root).problems[0]).toContain('"subrepos" finds two repositories named irrippr (repos/irrippr, more/irrippr)');
  });

  test('a folder of the project that is not a repository is not a sub-repo', () => {
    const { root } = superRepo({ subrepos: ['repos/*', 'docs'] });
    write(root, 'docs/a.md', 'a\n');
    forgetSubrepos();
    const list = listSubrepos(root);
    expect(list.repos.map((repo) => repo.name)).toEqual(['irrippr']);
    expect(list.notes[0]).toContain('"subrepos" names docs, which is not a git repository here');
  });
});

describe('placement across repositories', () => {
  test('a sub-repo commit that changed a hub inside it needs a Placement section', () => {
    const { root, sub } = superRepo();
    setManifest(root, { hubs: ['repos/irrippr/src/big.js'], placementSince: null });
    todo(root, '2026-11-10_1/01-layout', { 'ai_completed.md': record(`irrippr@${sub}`) });
    const out = run(root, 'sync');
    expect(out.stdout).toContain(`2026-11-10_1/01-layout/ai_completed.md: commit irrippr@${sub} changed the hub repos/irrippr/src/big.js`);
    write(root, '.novadev/todos/2026-11-10_1/01-layout/ai_completed.md', record(`irrippr@${sub}`, '\n## Placement\nThe new branch went into src/layout/ (40 lines), not the hub.\n'));
    expect(run(root, 'sync').stdout).not.toContain('changed the hub');
  });
});

// A project that moved repositories (todo 2026-11-24_2/01): IRRISketch became one repository on 2026-11-18. Its older
// records name commits of the repositories it came from, and its records still say which folders a todo touched —
// 1,455 of the 1,594 NEXT ACTIONS of its `novadev sync` were these two notes.
describe('a project that moved repositories', () => {
  /** One repository, no sub-repos; a record of before the move, one of after it, both naming a commit nobody has. */
  function moved(manifest: Record<string, unknown>): { root: string; own: string } {
    const root = project(manifest);
    feature(root, 'FEAT-0001', 'layouting');
    git(root, 'init', '-q', '-b', 'main');
    commitAll(root, 'the first commit of the new repository');
    const own = git(root, 'rev-parse', '--short', 'HEAD').stdout.trim();
    const rec = (date: string, commits: string, repos: string) => `# ai_completed — x\n\n**Date:** ${date}\n**Feature:** FEAT-0001\n**Commits:** ${commits}\n**Repos:** ${repos}\n\n## What I did\nThe work.\n`;
    todo(root, '2026-10-07_2/01-old', { 'ai_completed.md': rec('2026-10-07', '1234567, irrippr@abcdef0', 'irrippr, irrisketch_locales') });
    todo(root, '2026-11-20_1/01-new', { 'ai_completed.md': rec('2026-11-20', `${own}, 7654321`, 'project (.paperclip/scripts), irris') });
    // a record with no day of its own is its batch's day
    todo(root, '2026-09-29_3/01-undated', { 'ai_completed.md': '# ai_completed — y\n\n**Feature:** FEAT-0001\n**Commits:** fedcba9\n\n## What I did\nThe work.\n' });
    forgetSubrepos();
    return { root, own };
  }

  test('without the settings every record is asked, as before', () => {
    const { root } = moved({});
    const out = run(root, 'sync').stdout;
    for (const line of [
      "commit 1234567 (2026-10-07_2/01-old) is not in this repository's history",
      "commit fedcba9 (2026-09-29_3/01-undated) is not in this repository's history",
      "commit 7654321 (2026-11-20_1/01-new) is not in this repository's history",
      'commit irrippr@abcdef0 (2026-10-07_2/01-old) names the repository "irrippr", which is not a sub-repo',
      '2026-10-07_2/01-old: **Repos:** names "irrippr", which is not a sub-repo',
      '2026-11-20_1/01-new: **Repos:** names "project", which is not a sub-repo',
    ]) expect(out).toContain(line);
  });

  test('"commitsSince": a record dated before that day is not asked for its commits or its Repos names; a later one still is', () => {
    const { root } = moved({ commitsSince: '2026-11-18' });
    const out = run(root, 'sync').stdout;
    expect(out).not.toContain('01-old');
    expect(out).not.toContain('01-undated');
    expect(out).toContain("commit 7654321 (2026-11-20_1/01-new) is not in this repository's history");
    expect(out).toContain('2026-11-20_1/01-new: **Repos:** names "project", which is not a sub-repo');
    // the old record's commits stay in the feature's history as they were written
    const work = read(root, '.novadev/knowledge/features/FEAT-0001-layouting/work.md');
    expect(work).toContain('- `1234567` — 2026-10-07_2/01-old\n- `irrippr@abcdef0` — 2026-10-07_2/01-old');
    // the day itself is "since": a record of that day is asked
    setManifest(root, { commitsSince: '2026-11-20' });
    expect(run(root, 'sync').stdout).toContain("commit 7654321 (2026-11-20_1/01-new) is not in this repository's history");
    setManifest(root, { commitsSince: '2026-11-21' });
    expect(run(root, 'sync').stdout).not.toContain('7654321');
  });

  test('"subrepos": [] says the project has none: a Repos line is free text; a commit that is missing is still named', () => {
    const { root } = moved({ subrepos: [], commitsSince: '2026-11-18' });
    forgetSubrepos();
    expect(listSubrepos(root).declaredNone).toBe(true);
    const out = run(root, 'sync').stdout;
    expect(out).not.toContain('**Repos:** names');
    expect(out).toContain("commit 7654321 (2026-11-20_1/01-new) is not in this repository's history");
    expect(out.match(/is not in this repository's history|not a sub-repo/g)).toHaveLength(1);
    // … and a project that never set "subrepos" (or set it to null) has not said so
    setManifest(root, { subrepos: null });
    forgetSubrepos();
    expect(listSubrepos(root).declaredNone).toBe(false);
    expect(run(root, 'sync').stdout).toContain('2026-11-20_1/01-new: **Repos:** names "project", which is not a sub-repo');
  });

  test('a "commitsSince" that is no day is a problem, and every record is asked until it is fixed', () => {
    const { root } = moved({ commitsSince: 'the switch' });
    const out = run(root, 'sync');
    expect(out.code).toBe(1);
    expect(out.stdout).toContain('✗ novadev.json: "commitsSince" must be a day like "2026-11-18" — the day from which the records\' commits are in this repository; a record dated before it is not asked for its commits — or null to ask every record');
    expect(out.stdout).toContain("commit 1234567 (2026-10-07_2/01-old) is not in this repository's history");
    setManifest(root, { commitsSince: '2026-02-30' });
    expect(run(root, 'sync').code).toBe(1);
  });
});
