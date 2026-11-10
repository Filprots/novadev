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
