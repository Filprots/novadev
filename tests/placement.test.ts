// The `## Placement` section and the check doctor and sync run on it: a record whose commits changed
// a file inside a hub path must say where its new units went. Fixture repositories only.
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { type HubPaths, hubPaths, inHub, parseHubsSetting } from '../src/hubs.ts';
import { markdownSections, recordDate } from '../src/lib.ts';
import { parsePlacementSince, placementState } from '../src/placement.ts';
import {
  commitAll,
  git,
  metricsOutput,
  project,
  read,
  run,
  setManifest,
  tempDir,
  todo,
  write,
} from './helpers.ts';

const SECTION = '\n## Placement\n- the registry → src/kits/registry.ts (new, 2 lines); not on the Workbench: it only calls it.\n';

/** A work record; `body` is appended after "## What I did". */
function record(
  o: { slug?: string; kind?: string; date?: string; commits?: string; body?: string } = {},
): string {
  const kind = o.kind ?? 'ai_completed';
  const commits = o.commits ? `**Commits:** ${o.commits}\n` : '';
  return `# ${kind} — ${o.slug ?? '01-a'}\n\n**Date:** ${o.date ?? '2026-10-01'}\n**Feature:** none — test fixture\n${commits}\n## What I did\nThe work.\n${o.body ?? ''}`;
}

/** Commit `files` (and only them), and return the short hash. */
function commitFiles(root: string, files: Record<string, string>, message = 'work'): string {
  for (const [rel, content] of Object.entries(files)) write(root, rel, content);
  git(root, 'add', '--', ...Object.keys(files));
  git(root, 'commit', '-q', '--no-verify', '-m', message);
  return git(root, 'rev-parse', '--short', 'HEAD').stdout.trim();
}

/**
 * A deployed project (so doctor is healthy) with a hub folder `src/wb/` listed in novadev.json, a
 * file outside it, and everything committed.
 */
function hubProject(manifest: Record<string, unknown> = {}): string {
  const root = project();
  expect(run(root, 'deploy').code).toBe(0);
  setManifest(root, { hubs: ['src/wb/'], placementSince: null, ...manifest });
  write(root, 'src/wb/workbench.ts', 'export const workbench = 1;\n');
  write(root, 'src/kits/registry.ts', 'export const registry = 1;\n');
  commitAll(root, 'base');
  return root;
}

/** The PROBLEMS lines of a doctor or sync run, without the mark. */
function problems(stdout: string): string[] {
  const block = stdout.split('PROBLEMS')[1]?.split('\n\n')[0] ?? '';
  return block
    .split('\n')
    .filter((line) => line.startsWith('  ✗ '))
    .map((line) => line.slice(4));
}

const ASK =
  'each new unit of state or behaviour with its owner, its size before → after, and why it is not on a hub; or "nothing new placed"';
const MISSING_ASK = `add one (loop phase 4): ${ASK}`;

describe('the section', () => {
  test('missing, empty or written', () => {
    expect(placementState(record())).toBe('missing');
    expect(placementState(record({ body: SECTION }))).toBe('written');
    expect(placementState(record({ body: '\n## Placement\nnothing new placed\n' }))).toBe('written');
    expect(placementState(record({ body: '\n## Placement\n\n## Verification\nAll tests pass.\n' }))).toBe('empty');
  });

  test('the template copied as it is says nothing: placeholders and comments are not words', () => {
    const template = '\n## Placement\n<each new unit: its owner, its size before → after, why not on a hub — or "nothing new placed">\n<!-- fill in -->\n';
    expect(placementState(record({ body: template }))).toBe('empty');
  });

  test('a section in a code block or a comment is a quote, not a section', () => {
    expect(placementState(record({ body: '\n```markdown\n## Placement\n- x → y\n```\n' }))).toBe('missing');
    expect(placementState(record({ body: '\n<!--\n## Placement\n- x → y\n-->\n' }))).toBe('missing');
  });

  test('only a level-2 heading whose title is a word of its own starts it', () => {
    expect(placementState(record({ body: '\n### Placement\n- x → y\n' }))).toBe('missing');
    expect(placementState(record({ body: '\n## Placements\n- x → y\n' }))).toBe('missing');
    expect(placementState(record({ body: '\n## Placement notes\n- x → y\n' }))).toBe('written');
    expect(placementState(record({ body: '\n## placement\n- x → y\n' }))).toBe('written');
  });

  test('a level-3 heading inside the section belongs to it; CRLF records read the same', () => {
    expect(placementState(record({ body: '\n## Placement\n### Kits\n- x → y\n' }))).toBe('written');
    expect(placementState(record({ body: SECTION }).replace(/\n/g, '\r\n'))).toBe('written');
  });

  test('markdownSections: every section with that title, each up to the next level-1/2 heading', () => {
    const text = '# r\n## Placement\none\n### sub\ntwo\n## Notes\nthree\n## Placement\nfour\n# end\nfive\n';
    expect(markdownSections(text, 'Placement')).toEqual([['one', '### sub', 'two'], ['four']]);
  });

  test('markdownSections reads the title as plain text, never as a pattern', () => {
    expect(markdownSections('## C++ notes\nx', 'C++')).toEqual([['x']]);
    expect(markdownSections('## Debt\nx\n', 'D.bt')).toEqual([]);
    expect(markdownSections('## Debt: why\nx\n## Debt_old\ny\n', 'Debt')).toEqual([['x']]);
  });
});

describe('the settings', () => {
  test('"placementSince": a day, or null / absent for every record', () => {
    expect(parsePlacementSince(undefined)).toEqual({ ok: true, value: null });
    expect(parsePlacementSince(null)).toEqual({ ok: true, value: null });
    expect(parsePlacementSince('2026-10-01')).toEqual({ ok: true, value: '2026-10-01' });
    for (const bad of ['2026-13-45', '2026-02-30', 'yesterday', '2026-10-1', 20261001, true, ['2026-10-01']]) {
      expect(parsePlacementSince(bad)).toEqual({ ok: false, error: expect.stringContaining('"placementSince" must be a day like "2026-10-01"') });
    }
  });

  test('"hubs": a list of project paths, normalized like a snapshot\'s, or null / absent for none', () => {
    expect(parseHubsSetting(undefined)).toEqual({ ok: true, value: [] });
    expect(parseHubsSetting(null)).toEqual({ ok: true, value: [] });
    expect(parseHubsSetting(['src/wb/', './src/wb/', 'src\\wb\\', 'src/stage3d.ts'])).toEqual({
      ok: true,
      value: ['src/wb/', 'src/stage3d.ts'],
    });
    for (const bad of ['src/wb/', [''], ['/abs/wb'], ['C:\\wb'], ['../outside'], [1], [null], { path: 'src/wb/' }]) {
      expect(parseHubsSetting(bad)).toEqual({ ok: false, error: expect.stringContaining('"hubs" must be a list of paths inside the project') });
    }
  });

  test('a file is in a hub when it is the hub path or inside it — as a folder, with or without "/"', () => {
    expect(inHub('src/wb/a.ts', 'src/wb/')).toBe(true);
    expect(inHub('src/wb/deep/a.ts', 'src/wb')).toBe(true);
    expect(inHub('src/wb2/a.ts', 'src/wb')).toBe(false);
    expect(inHub('src/wb.ts', 'src/wb.ts')).toBe(true);
    expect(inHub('src/wb.tsx', 'src/wb.ts')).toBe(false);
    expect(inHub('lib/src/wb/a.ts', 'src/wb/')).toBe(false);
  });

  test('a record\'s date: the latest day on its **Date:** line, or none', () => {
    expect(recordDate('**Date:** 2026-10-01\n')).toBe('2026-10-01');
    expect(recordDate('**Date:** 2026-09-11, updated 2026-10-02\n')).toBe('2026-10-02');
    expect(recordDate('**Date:** 2026-09-18 · **State:** not fixed\n')).toBe('2026-09-18');
    expect(recordDate('**Date:** soon\n')).toBeNull();
    expect(recordDate('no date line\n')).toBeNull();
  });
});

describe('where hub paths come from', () => {
  const snapshot = (hubs: unknown[]) =>
    `{"updated":"2026-10-01","hubs":${JSON.stringify(hubs)}}`;

  test('the snapshot, when it names a hub path — then the novadev.json list is not used', () => {
    const root = project({ hubs: ['src/listed/'] });
    write(root, '.novadev/metrics/latest.json', snapshot([{ name: 'Workbench', measure: 9, over: [], path: 'src/wb/' }, { name: 'Bare', measure: 1, over: [] }]));
    expect(hubPaths(join(root, '.novadev'))).toEqual({ source: 'snapshot', hubs: [{ path: 'src/wb/', name: 'Workbench' }] });
  });

  test('novadev.json, when the snapshot names none — or there is no snapshot, or it cannot be read', () => {
    const root = project({ hubs: ['src/listed/'] });
    const listed: HubPaths = { source: 'novadev.json', hubs: [{ path: 'src/listed/' }] };
    expect(hubPaths(join(root, '.novadev'))).toEqual(listed);
    write(root, '.novadev/metrics/latest.json', snapshot([{ name: 'Bare', measure: 1, over: [] }]));
    expect(hubPaths(join(root, '.novadev'))).toEqual(listed);
    write(root, '.novadev/metrics/latest.json', '{ broken');
    expect(hubPaths(join(root, '.novadev'))).toEqual(listed);
  });

  test('nowhere: no snapshot paths and no list (or a broken one)', () => {
    expect(hubPaths(join(project(), '.novadev'))).toEqual({ source: null, hubs: [] });
    expect(hubPaths(join(project({ hubs: 'src/wb/' }), '.novadev'))).toEqual({ source: null, hubs: [] });
  });
});

describe('doctor: a record whose commits changed a hub', () => {
  test('has no "## Placement" section: a problem that names the record, the commit and the hub', () => {
    const root = hubProject();
    const hash = commitFiles(root, { 'src/wb/workbench.ts': 'export const workbench = 2;\n' });
    todo(root, '2026-10-01_1/01-a', { 'ai_completed.md': record({ commits: hash }) });
    const result = run(root, 'doctor');
    expect(result.code).toBe(1);
    expect(problems(result.stdout)).toEqual([
      `2026-10-01_1/01-a/ai_completed.md: commit ${hash} changed the hub src/wb/, but the record has no "## Placement" section — ${MISSING_ASK}`,
    ]);

    todo(root, '2026-10-01_1/01-a', { 'ai_completed.md': record({ commits: hash, body: SECTION }) });
    expect(run(root, 'doctor').stdout.trim()).toBe('doctor: structure is healthy.');
  });

  test('an empty section is a problem too; "nothing new placed" is an answer', () => {
    const root = hubProject();
    const hash = commitFiles(root, { 'src/wb/workbench.ts': 'export const workbench = 2;\n' });
    todo(root, '2026-10-01_1/01-a', { 'ai_completed.md': record({ commits: hash, body: '\n## Placement\n\n## Notes\nNone.\n' }) });
    expect(problems(run(root, 'doctor').stdout)).toEqual([
      `2026-10-01_1/01-a/ai_completed.md: commit ${hash} changed the hub src/wb/, but its "## Placement" section is empty — fill it in (loop phase 4): ${ASK}`,
    ]);
    todo(root, '2026-10-01_1/01-a', { 'ai_completed.md': record({ commits: hash, body: '\n## Placement\nNothing new placed.\n' }) });
    expect(run(root, 'doctor').code).toBe(0);
  });

  test('a "**Placement:**" line elsewhere does not count, and the message says where it must go', () => {
    const root = hubProject();
    const hash = commitFiles(root, { 'src/wb/workbench.ts': 'export const workbench = 2;\n' });
    const body = '\n## Decisions\n- **Placement:** nothing new on any hub.\n';
    todo(root, '2026-10-01_1/01-a', { 'ai_completed.md': record({ commits: hash, body }) });
    expect(problems(run(root, 'doctor').stdout)).toEqual([
      `2026-10-01_1/01-a/ai_completed.md: commit ${hash} changed the hub src/wb/, but the record has no "## Placement" section — its "**Placement:**" line does not count: move it under a "## Placement" heading`,
    ]);
  });

  test('several commits and hubs: only the commits that changed a hub are named, every hub once', () => {
    const root = hubProject({ hubs: ['src/wb/', 'src/stage3d.ts'] });
    write(root, 'src/stage3d.ts', 'export const stage = 1;\n');
    commitAll(root, 'stage');
    const outside = commitFiles(root, { 'src/kits/registry.ts': 'export const registry = 2;\n' });
    const one = commitFiles(root, { 'src/wb/workbench.ts': 'export const workbench = 2;\n' });
    const two = commitFiles(root, { 'src/stage3d.ts': 'export const stage = 2;\n', 'src/wb/workbench.ts': 'export const workbench = 3;\n' });
    todo(root, '2026-10-01_1/01-a', { 'ai_completed.md': record({ commits: `${outside}, ${one}, ${two}` }) });
    expect(problems(run(root, 'doctor').stdout)).toEqual([
      `2026-10-01_1/01-a/ai_completed.md: commits ${one}, ${two} changed the hubs src/wb/ and src/stage3d.ts, but the record has no "## Placement" section — ${MISSING_ASK}`,
    ]);
  });

  test('ai_progress.md and ai_failed.md are records too', () => {
    const root = hubProject();
    const hash = commitFiles(root, { 'src/wb/workbench.ts': 'export const workbench = 2;\n' });
    todo(root, '2026-10-01_1/01-a', { 'ai_progress.md': record({ kind: 'ai_progress', commits: hash }) });
    todo(root, '2026-10-01_1/02-b', { 'ai_failed.md': record({ slug: '02-b', kind: 'ai_failed', commits: hash }) });
    expect(problems(run(root, 'doctor').stdout).map((line) => line.split(':')[0])).toEqual([
      '2026-10-01_1/01-a/ai_progress.md',
      '2026-10-01_1/02-b/ai_failed.md',
    ]);
  });
});

describe('doctor: records the check leaves alone', () => {
  test('commits that changed no hub file, a record with no **Commits:** line, and another repository\'s commit', () => {
    const root = hubProject();
    const outside = commitFiles(root, { 'src/kits/registry.ts': 'export const registry = 2;\n' });
    commitFiles(root, { 'src/wb/workbench.ts': 'export const workbench = 2;\n' });
    todo(root, '2026-10-01_1/01-a', { 'ai_completed.md': record({ commits: outside }) });
    todo(root, '2026-10-01_1/02-b', { 'ai_completed.md': record({ slug: '02-b' }) });
    todo(root, '2026-10-01_1/03-c', { 'ai_completed.md': record({ slug: '03-c', commits: 'abcdef1234567' }) });
    const result = run(root, 'doctor');
    expect(problems(result.stdout)).toEqual([]);
    expect(result.stdout).toContain('commit abcdef1234567 (2026-10-01_1/03-c) is not in this repository\'s history');
  });

  test('a record dated before "placementSince" is history; one dated that day or later is checked', () => {
    const root = hubProject({ placementSince: '2026-10-01' });
    const hash = commitFiles(root, { 'src/wb/workbench.ts': 'export const workbench = 2;\n' });
    todo(root, '2026-09-30_1/01-old', { 'ai_completed.md': record({ slug: '01-old', date: '2026-09-30', commits: hash }) });
    todo(root, '2026-10-01_1/01-a', { 'ai_completed.md': record({ date: '2026-10-01', commits: hash }) });
    todo(root, '2026-10-01_1/02-b', { 'ai_completed.md': record({ slug: '02-b', date: 'not written yet', commits: hash }) });
    expect(problems(run(root, 'doctor').stdout).map((line) => line.split(':')[0])).toEqual([
      '2026-10-01_1/01-a/ai_completed.md',
      '2026-10-01_1/02-b/ai_completed.md',
    ]);
  });

  test('an archived record is history', () => {
    const root = hubProject();
    const hash = commitFiles(root, { 'src/wb/workbench.ts': 'export const workbench = 2;\n' });
    write(root, '.novadev/archive/2026/todos/2026-09-01_1/01-a/prompt.md', '# prompt\n\nOld.\n');
    write(root, '.novadev/archive/2026/todos/2026-09-01_1/01-a/ai_completed.md', record({ commits: hash }));
    expect(problems(run(root, 'doctor').stdout)).toEqual([]);
  });

  test('no hub paths: nothing to check', () => {
    const root = hubProject({ hubs: null });
    const hash = commitFiles(root, { 'src/wb/workbench.ts': 'export const workbench = 2;\n' });
    todo(root, '2026-10-01_1/01-a', { 'ai_completed.md': record({ commits: hash }) });
    expect(run(root, 'doctor').stdout.trim()).toBe('doctor: structure is healthy.');
  });

  test('no git repository: a note says the check cannot run', () => {
    const root = project({ hubs: ['src/wb/'] });
    run(root, 'deploy');
    write(root, 'src/wb/workbench.ts', 'x\n');
    todo(root, '2026-10-01_1/01-a', { 'ai_completed.md': record({ commits: 'abc1234' }) });
    const result = run(root, 'doctor');
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(
      '· placement: 1 record(s) name commits, but there is no git repository here to say which files they changed — the "## Placement" check cannot run',
    );
  });
});

describe('what git says a commit changed', () => {
  test('a move out of a hub changed the hub: both of its paths count', () => {
    const root = hubProject();
    git(root, 'mv', 'src/wb/workbench.ts', 'src/kits/workbench.ts');
    git(root, 'commit', '-q', '--no-verify', '-m', 'move');
    const hash = git(root, 'rev-parse', '--short', 'HEAD').stdout.trim();
    todo(root, '2026-10-01_1/01-a', { 'ai_completed.md': record({ commits: hash }) });
    expect(problems(run(root, 'doctor').stdout)).toHaveLength(1);
  });

  test('a merge counts what it brought in over its first parent', () => {
    const root = hubProject();
    const main = git(root, 'rev-parse', '--abbrev-ref', 'HEAD').stdout.trim();
    git(root, 'checkout', '-q', '-b', 'side');
    commitFiles(root, { 'src/wb/workbench.ts': 'export const workbench = 2;\n' });
    git(root, 'checkout', '-q', main);
    commitFiles(root, { 'src/kits/registry.ts': 'export const registry = 2;\n' });
    git(root, 'merge', '-q', '--no-ff', '--no-edit', 'side');
    const merge = git(root, 'rev-parse', '--short', 'HEAD').stdout.trim();
    todo(root, '2026-10-01_1/01-a', { 'ai_completed.md': record({ commits: merge }) });
    expect(problems(run(root, 'doctor').stdout)).toEqual([
      `2026-10-01_1/01-a/ai_completed.md: commit ${merge} changed the hub src/wb/, but the record has no "## Placement" section — ${MISSING_ASK}`,
    ]);
  });

  test('a project in a sub-folder of the repository: hub paths and changed files are both relative to it', () => {
    const repo = tempDir();
    git(repo, 'init', '-q');
    const root = join(repo, 'app');
    write(root, '.novadev/novadev.json', '{}\n');
    run(root, 'deploy');
    setManifest(root, { hubs: ['src/wb/'], placementSince: null });
    write(root, 'src/wb/workbench.ts', 'x\n');
    write(repo, 'src/wb/workbench.ts', 'the repository\'s own, outside the project\n');
    commitAll(repo, 'base');
    const outside = commitFiles(repo, { 'src/wb/workbench.ts': 'changed outside the project\n' });
    const inside = commitFiles(repo, { 'app/src/wb/workbench.ts': 'changed\n' });
    todo(root, '2026-10-01_1/01-a', { 'ai_completed.md': record({ commits: outside }) });
    todo(root, '2026-10-01_1/02-b', { 'ai_completed.md': record({ slug: '02-b', commits: inside }) });
    expect(problems(run(root, 'doctor').stdout).map((line) => line.split(':')[0])).toEqual(['2026-10-01_1/02-b/ai_completed.md']);
  });
});

describe('sync and sync --check', () => {
  test('a problem for sync (exit 1) and a failure for --check; with the section both pass', () => {
    const root = hubProject();
    const hash = commitFiles(root, { 'src/wb/workbench.ts': 'export const workbench = 2;\n' });
    todo(root, '2026-10-01_1/01-a', { 'ai_completed.md': record({ commits: hash }) });
    const synced = run(root, 'sync');
    expect(synced.code).toBe(1);
    expect(problems(synced.stdout)).toEqual([
      `2026-10-01_1/01-a/ai_completed.md: commit ${hash} changed the hub src/wb/, but the record has no "## Placement" section — ${MISSING_ASK}`,
    ]);
    const check = run(root, 'sync', '--check');
    expect(check.code).toBe(1);
    expect(check.stdout).toContain('sync --check: ✗ 1 problem(s)');

    todo(root, '2026-10-01_1/01-a', { 'ai_completed.md': record({ commits: hash, body: SECTION }) });
    expect(run(root, 'sync').code).toBe(0);
    expect(run(root, 'sync', '--check').code).toBe(0);
  });

  test('one verdict for one tree: committing the record changes nothing — before it (a hook) and after it (CI) agree', () => {
    const root = hubProject();
    const hash = commitFiles(root, { 'src/wb/workbench.ts': 'export const workbench = 2;\n' });
    todo(root, '2026-10-01_1/01-a', { 'ai_completed.md': record({ commits: hash }) });
    const hook = run(root, 'sync', '--check');
    commitAll(root, 'the record');
    const ci = run(root, 'sync', '--check');
    expect([hook.code, ci.code]).toEqual([1, 1]);

    todo(root, '2026-10-01_1/01-a', { 'ai_completed.md': record({ commits: hash, body: SECTION }) });
    run(root, 'sync');
    const fixedHook = run(root, 'sync', '--check');
    commitAll(root, 'the section');
    expect([fixedHook.code, run(root, 'sync', '--check').code]).toEqual([0, 0]);
  });

  test('hub paths from the metrics command count at once — --check judges the snapshot sync is about to store', () => {
    const root = hubProject({ hubs: null, metrics: 'cat metrics-out.json' });
    metricsOutput(root, { hubs: [{ name: 'Workbench', measure: 10, path: 'src/wb/' }] });
    const hash = commitFiles(root, { 'src/wb/workbench.ts': 'export const workbench = 2;\n' });
    todo(root, '2026-10-01_1/01-a', { 'ai_completed.md': record({ commits: hash }) });
    const expected = `2026-10-01_1/01-a/ai_completed.md: commit ${hash} changed the hub Workbench (src/wb/), but the record has no "## Placement" section — ${MISSING_ASK}`;
    const check = run(root, 'sync', '--check');
    expect(check.code).toBe(1);
    expect(problems(check.stdout)).toEqual([expected]);
    expect(problems(run(root, 'sync').stdout)).toEqual([expected]);
    expect(problems(run(root, 'doctor').stdout)).toEqual([expected]);
  });

  test('the novadev.json list is only a fallback: doctor notes that it is not used while the snapshot names paths', () => {
    const root = hubProject({ metrics: 'cat metrics-out.json', hubs: ['src/kits/'] });
    metricsOutput(root, { hubs: [{ name: 'Workbench', measure: 10, path: 'src/wb/' }] });
    run(root, 'sync');
    const hash = commitFiles(root, { 'src/kits/registry.ts': 'export const registry = 2;\n' });
    todo(root, '2026-10-01_1/01-a', { 'ai_completed.md': record({ commits: hash }) });
    const result = run(root, 'doctor');
    expect(problems(result.stdout)).toEqual([]);
    expect(result.stdout).toContain('novadev.json: "hubs" is not used — the metrics snapshot names hub paths, and those come first');
  });

  test('a hub path that is not in the project is a NEXT ACTION for sync and a note for doctor', () => {
    const root = hubProject({ hubs: ['src/wb/', 'src/gone/'] });
    const synced = run(root, 'sync');
    expect(synced.code).toBe(0);
    expect(synced.stdout).toContain(
      '→ hub path src/gone/ (from "hubs" in novadev.json) is not in the project, so no change can match it — correct the path, or remove it from "hubs"',
    );
    expect(synced.stdout).not.toContain('src/wb/ (from');
    expect(run(root, 'doctor').stdout).toContain('· hub path src/gone/ (from "hubs" in novadev.json) is not in the project');

    const metered = hubProject({ hubs: null, metrics: 'cat metrics-out.json' });
    write(metered, 'metrics-out.json', JSON.stringify({ hubs: [{ name: 'Ghost', measure: 1, path: 'src/ghost/' }] }));
    expect(run(metered, 'sync').stdout).toContain(
      '→ hub path src/ghost/ (from the metrics snapshot) is not in the project, so no change can match it — correct the path, or remove it from what the metrics command prints',
    );
  });

  test('broken settings are problems; while "placementSince" cannot be read, no record is judged', () => {
    const root = hubProject({ hubs: 'src/wb/', placementSince: 'last week' });
    const hash = commitFiles(root, { 'src/wb/workbench.ts': 'export const workbench = 2;\n' });
    todo(root, '2026-10-01_1/01-a', { 'ai_completed.md': record({ commits: hash }) });
    expect(problems(run(root, 'sync').stdout)).toEqual([
      'novadev.json: "hubs" must be a list of paths inside the project, relative to its root and without "..", like ["src/editor/workbench/"] — or null for none',
      'novadev.json: "placementSince" must be a day like "2026-10-01" — records dated before it are not checked for a "## Placement" section — or null to check every record in todos/',
    ]);
    setManifest(root, { hubs: ['src/wb/'] });
    expect(problems(run(root, 'doctor').stdout)).toEqual([
      'novadev.json: "placementSince" must be a day like "2026-10-01" — records dated before it are not checked for a "## Placement" section — or null to check every record in todos/',
    ]);
    setManifest(root, { placementSince: '2026-10-01' });
    expect(problems(run(root, 'doctor').stdout)).toHaveLength(1);
    expect(problems(run(root, 'doctor').stdout)[0]).toStartWith('2026-10-01_1/01-a/ai_completed.md: commit');
  });

  test('the sync that archives a batch still shows its problem, as --check does; after that it is history', () => {
    const root = hubProject({ archiveGraceDays: 0 });
    const hash = commitFiles(root, { 'src/wb/workbench.ts': 'export const workbench = 2;\n' });
    todo(root, '2026-10-01_1/01-a', { 'ai_completed.md': record({ commits: hash }) });
    const expected = [
      `2026-10-01_1/01-a/ai_completed.md: commit ${hash} changed the hub src/wb/, but the record has no "## Placement" section — ${MISSING_ASK}`,
    ];
    expect(problems(run(root, 'sync', '--check').stdout)).toEqual(expected);
    const synced = run(root, 'sync');
    expect(synced.stdout).toContain('archived: 1 item(s)');
    expect(problems(synced.stdout)).toEqual(expected);
    expect(synced.code).toBe(1);
    expect(read(root, '.novadev/archive/2026/todos/2026-10-01_1/01-a/ai_completed.md')).toContain(hash);
    expect(problems(run(root, 'sync').stdout)).toEqual([]);
  });
});
