// `novadev features`: the search the playbook runs before building anything, and `--hubs`, which
// lists the features that lean on each hub. Fixture registries only.
import { describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { featuresByHub, onlyHubPaths } from '../src/feature-hubs.ts';
import { type Feature, comparablePath, featureStatusMark, pathWithin, pathsOverlap } from '../src/lib.ts';
import { exists, feature, metricsOutput, project, read, run, setManifest, write } from './helpers.ts';

/** A feature as listFeatures gives it, with only what the grouping reads filled in. */
function feat(id: string, touches: string[], status = 'shipped'): Feature {
  return {
    id,
    file: `${id}-x`,
    dir: '',
    path: '',
    workPath: '',
    testsPath: '',
    title: id,
    status,
    area: '',
    tags: [],
    touches,
    refs: {},
    fm: {},
    text: '',
  };
}

/** The groups as plain data: hub path → [feature id, paths on hubs, paths, holders]. */
function shape(groups: ReturnType<typeof featuresByHub>): [string, [string, number, number, string[]][]][] {
  return groups.map((group) => [
    group.path,
    group.features.map((entry) => [entry.feature.id, entry.onHubs, entry.touched, entry.holders]),
  ]);
}

const FOOTER = [
  "← only hub paths: every path in the feature's `touches:` is on a hub. A search by folder",
  '  finds it only together with all the other features on that hub. When its code moves off',
  '  the hub, add the new path to its `touches:`, and remove the hub path once none of its',
  '  code is left there.',
];

/**
 * A project with two hub paths in novadev.json — a folder and a file, both in the project — and
 * five features: on a hub and elsewhere, only on hubs, holding both hubs, on both hubs, elsewhere.
 */
function hubRegistry(manifest: Record<string, unknown> = {}): string {
  const root = project({ hubs: ['src/wb/', 'src/stage.ts'], ...manifest });
  write(root, 'src/wb/a.ts', 'a\n');
  write(root, 'src/stage.ts', 'stage\n');
  feature(root, 'FEAT-0001', 'alpha', { title: 'Alpha', touches: 'src/wb/a.ts, src/own/' });
  feature(root, 'FEAT-0002', 'beta', { title: 'Beta', status: 'in-progress', touches: 'src/wb/' });
  feature(root, 'FEAT-0003', 'gamma', { title: 'Gamma', status: 'planned', area: 'history', touches: 'src/' });
  feature(root, 'FEAT-0004', 'delta', { title: 'Delta', status: 'deprecated', touches: 'src/stage.ts, src/wb/b.ts' });
  feature(root, 'FEAT-0005', 'epsilon', { title: 'Epsilon', touches: 'src/other/' });
  return root;
}

describe('the paths', () => {
  test('pathWithin: the path itself or inside it, as a file or a folder, with or without "./" and "/"', () => {
    expect(pathWithin('src/wb/a.ts', 'src/wb/')).toBe(true);
    expect(pathWithin('src/wb', 'src/wb/')).toBe(true);
    expect(pathWithin('./src/wb/', 'src/wb')).toBe(true);
    expect(pathWithin('src/wb/deep/a.ts', './src/wb')).toBe(true);
    expect(pathWithin('src/wb2/a.ts', 'src/wb')).toBe(false);
    expect(pathWithin('src/', 'src/wb/')).toBe(false);
    expect(pathWithin('src/wb.tsx', 'src/wb.ts')).toBe(false);
    expect(pathWithin('', 'src/')).toBe(false);
    expect(pathWithin('src/', '')).toBe(false);
    expect(pathWithin('./', 'src/')).toBe(false);
    expect(comparablePath('./src/wb//')).toBe('src/wb');
  });

  test('pathsOverlap: equal, or one inside the other — either way round', () => {
    expect(pathsOverlap('src/wb/', 'src/wb')).toBe(true);
    expect(pathsOverlap('src/wb/a.ts', 'src/wb/')).toBe(true);
    expect(pathsOverlap('src/', 'src/wb/a.ts')).toBe(true);
    expect(pathsOverlap('./src', 'src/wb')).toBe(true);
    expect(pathsOverlap('src/wb2', 'src/wb')).toBe(false);
    expect(pathsOverlap('lib/src/wb', 'src/wb')).toBe(false);
    expect(pathsOverlap('', 'src')).toBe(false);
  });

  test('a status mark for each status, and "?" for any other — never a property of every object', () => {
    expect(['planned', 'in-progress', 'shipped', 'deprecated', 'done', '', 'constructor', 'toString'].map(featureStatusMark)).toEqual([
      '○', '◐', '●', '⊘', '?', '?', '?', '?',
    ]);
  });
});

describe('features by hub', () => {
  test('a feature is under every hub its touches overlap; the hub with the most features first, ties in path order', () => {
    const hubs = [{ path: 'src/d/' }, { path: 'src/c.ts' }, { path: 'src/b/' }, { path: 'src/a/' }];
    const groups = featuresByHub(
      [
        feat('FEAT-0001', ['src/a/x.ts']),
        feat('FEAT-0002', ['src/b/', 'src/a/']),
        feat('FEAT-0003', ['src/other/']),
        feat('FEAT-0004', ['src/c.ts', 'docs/']),
      ],
      hubs,
    );
    expect(shape(groups)).toEqual([
      ['src/a/', [['FEAT-0001', 1, 1, []], ['FEAT-0002', 2, 2, []]]],
      ['src/b/', [['FEAT-0002', 2, 2, []]]],
      ['src/c.ts', [['FEAT-0004', 1, 2, []]]],
      ['src/d/', []],
    ]);
  });

  test('the same matching as --touching: under a hub exactly the features `--touching <hub>` would list', () => {
    const hubs = ['src/wb/', 'src/wb', './src/stage.ts', 'src/editor/', 'lib/'].map((path) => ({ path }));
    const paths = ['src/wb/a.ts', './src/wb/', 'src/wb2/x.ts', 'src/', 'src/stage.ts', 'src/stage.tsx', 'src/editor/wb/', 'lib', 'lib2/x', 'docs/'];
    const features = paths.flatMap((a, i) => paths.slice(i).map((b, j) => feat(`FEAT-${String(i * 20 + j).padStart(4, '0')}`, [a, b])));
    const groups = featuresByHub(features, hubs);
    for (const group of groups) {
      const touching = features.filter((f) => f.touches.some((t) => pathsOverlap(t, group.path)));
      expect(group.features.map((entry) => entry.feature)).toEqual(touching);
    }
    // "src/wb/" and "src/wb" are one hub path: one group, not two.
    expect(groups.map((group) => group.path).sort()).toEqual(['./src/stage.ts', 'lib/', 'src/editor/', 'src/wb/']);
  });

  test('the count: paths on any hub — the hub path or inside it — each path once', () => {
    const [group] = featuresByHub(
      [feat('FEAT-0001', ['src/a/x.ts', './src/a/x.ts', 'src/a/x.ts/', 'src/b/', 'src/own/'])],
      [{ path: 'src/a/' }, { path: 'src/b/' }],
    );
    expect(shape([group!])).toEqual([['src/a/', [['FEAT-0001', 2, 3, []]]]]);
  });

  test('only hub paths: every path is on a hub, on one hub or on several; a feature with no paths is never listed', () => {
    const groups = featuresByHub(
      [
        feat('FEAT-0001', ['src/a/']),
        feat('FEAT-0002', ['src/a/', 'src/b/y.ts']),
        feat('FEAT-0003', ['src/a/', 'src/own/']),
        feat('FEAT-0004', []),
      ],
      [{ path: 'src/a/' }, { path: 'src/b/' }],
    );
    const entries = groups.flatMap((group) => group.features.map((entry) => [group.path, entry.feature.id, onlyHubPaths(entry)]));
    expect(entries).toEqual([
      ['src/a/', 'FEAT-0001', true],
      ['src/a/', 'FEAT-0002', true],
      ['src/a/', 'FEAT-0003', false],
      ['src/b/', 'FEAT-0002', true],
    ]);
    expect(onlyHubPaths({ feature: feat('FEAT-0009', []), touched: 0, onHubs: 0, holders: [] })).toBe(false);
  });

  test('a path that holds the hub lists the feature, is not on the hub, and is named as the reason — unless a path is in the hub', () => {
    const groups = featuresByHub(
      [feat('FEAT-0001', ['src/editor/', 'src/history/']), feat('FEAT-0002', ['src/editor/', 'src/editor/wb/x.ts'])],
      [{ path: 'src/editor/wb/' }],
    );
    expect(shape(groups)).toEqual([
      ['src/editor/wb/', [['FEAT-0001', 0, 2, ['src/editor/']], ['FEAT-0002', 1, 2, []]]],
    ]);
  });

  test('nested hubs: a path that is one hub and holds another is on a hub for both', () => {
    const groups = featuresByHub([feat('FEAT-0001', ['src/editor/'])], [{ path: 'src/editor/' }, { path: 'src/editor/wb/' }]);
    expect(shape(groups)).toEqual([
      ['src/editor/', [['FEAT-0001', 1, 1, []]]],
      ['src/editor/wb/', [['FEAT-0001', 1, 1, ['src/editor/']]]],
    ]);
    expect(groups.every((group) => onlyHubPaths(group.features[0]!))).toBe(true);
  });

  test('hubs that share a path are one group with every name', () => {
    const groups = featuresByHub(
      [],
      [{ path: 'src/wb/', name: 'Workbench' }, { path: './src/wb', name: 'Workbench verbs' }, { path: 'src/wb/' }, { path: 'src/wb/', name: 'Workbench' }],
    );
    expect(groups.map((group) => [group.path, group.names])).toEqual([['src/wb/', ['Workbench', 'Workbench verbs']]]);
  });
});

describe('novadev features --hubs', () => {
  test('one line per feature under each hub, a marker for features with only hub paths, and what the marker means', () => {
    const result = run(hubRegistry(), 'features', '--hubs');
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout.trimEnd().split('\n')).toEqual([
      'features --hubs — 2 hub paths (from "hubs" in novadev.json); features that touch them: 4 of 5',
      '',
      'src/wb/ — 4 features',
      '  ● FEAT-0001  [shipped]  Alpha  (hub paths: 1 of 2)',
      '  ◐ FEAT-0002  [in-progress]  Beta  (hub paths: 1 of 1)  ← only hub paths',
      '  ○ FEAT-0003  [planned]  Gamma  (hub paths: 0 of 1; its path src/ holds this hub)',
      '  ⊘ FEAT-0004  [deprecated]  Delta  (hub paths: 2 of 2)  ← only hub paths',
      '',
      'src/stage.ts — 2 features',
      '  ○ FEAT-0003  [planned]  Gamma  (hub paths: 0 of 1; its path src/ holds this hub)',
      '  ⊘ FEAT-0004  [deprecated]  Delta  (hub paths: 2 of 2)  ← only hub paths',
      '',
      ...FOOTER,
    ]);
  });

  test('no feature with only hub paths: no marker, and no footer', () => {
    const root = project({ hubs: ['src/wb/'] });
    write(root, 'src/wb/a.ts', 'a\n');
    feature(root, 'FEAT-0001', 'alpha', { title: 'Alpha', touches: 'src/wb/, src/own/' });
    expect(run(root, 'features', '--hubs').stdout.trimEnd().split('\n')).toEqual([
      'features --hubs — 1 hub path (from "hubs" in novadev.json); features that touch it: 1 of 1',
      '',
      'src/wb/ — 1 feature',
      '  ● FEAT-0001  [shipped]  Alpha  (hub paths: 1 of 2)',
    ]);
  });

  test('a hub no feature touches is listed last; a hub path that is not in the project says so', () => {
    const root = hubRegistry({ hubs: ['lib/empty/', 'src/wb/', 'lib/gone/'] });
    write(root, 'lib/empty/.keep', '');
    feature(root, 'FEAT-0006', 'zeta', { title: 'Zeta', touches: 'lib/gone/x.ts' });
    const lines = run(root, 'features', '--hubs').stdout.split('\n');
    expect(lines.filter((line) => /^(src|lib)\//.test(line))).toEqual([
      'src/wb/ — 4 features',
      'lib/gone/ — 1 feature — this path is not in the project',
      'lib/empty/ — no feature touches it',
    ]);
  });

  test('hub paths from the metrics snapshot come first, with their names; what is left out is said', () => {
    const root = hubRegistry({ hubs: ['src/listed/'], metrics: 'cat metrics-out.json' });
    metricsOutput(root, {
      hubs: [
        { name: 'Workbench', measure: 11019, path: 'src/wb/' },
        { name: 'Stage3D', measure: 3304 },
      ],
    });
    run(root, 'sync');
    expect(exists(root, '.novadev/metrics/latest.json')).toBe(true);
    const lines = run(root, 'features', '--hubs').stdout.split('\n');
    expect(lines.slice(0, 5)).toEqual([
      'features --hubs — 1 hub path (from the metrics snapshot); features that touch it: 4 of 5',
      '  · 1 hub in the metrics snapshot has no "path", so it is not listed: Stage3D',
      '  · "hubs" in novadev.json is not used: the metrics snapshot names hub paths, and those come first',
      '',
      'Workbench (src/wb/) — 4 features',
    ]);
  });

  test('it reads the stored snapshot and never runs the metrics command', () => {
    const root = hubRegistry({ hubs: null, metrics: 'cat metrics-out.json' });
    metricsOutput(root, { hubs: [{ name: 'Workbench', measure: 1, path: 'src/wb/' }] });
    run(root, 'sync');
    setManifest(root, { metrics: 'touch ran.txt && cat metrics-out.json' });
    const result = run(root, 'features', '--hubs');
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Workbench (src/wb/) — 4 features');
    expect(exists(root, 'ran.txt')).toBe(false);
  });

  test('the other options narrow the features; with --touching only the hubs that overlap that path are listed', () => {
    const root = hubRegistry();
    const status = run(root, 'features', '--hubs', '--status', 'in-progress').stdout.trimEnd().split('\n');
    expect(status).toEqual([
      'features --hubs — 2 hub paths (from "hubs" in novadev.json); features that touch them: 1 of 1 (status=in-progress)',
      '',
      'src/wb/ — 1 feature',
      '  ◐ FEAT-0002  [in-progress]  Beta  (hub paths: 1 of 1)  ← only hub paths',
      '',
      'src/stage.ts — no matching feature touches it',
      '',
      ...FOOTER,
    ]);

    const one = run(root, 'features', '--hubs', '--touching', 'src/stage.ts').stdout.trimEnd().split('\n');
    expect(one.slice(0, 3)).toEqual([
      'features --hubs — 1 hub path (from "hubs" in novadev.json); features that touch it: 2 of 2 (touching=src/stage.ts)',
      '',
      'src/stage.ts — 2 features',
    ]);
    expect(one.filter((line) => line.startsWith('src/'))).toEqual(['src/stage.ts — 2 features']);

    expect(run(root, 'features', '--hubs', '--area', 'history', 'gamma').stdout.split('\n')[0]).toBe(
      'features --hubs — 2 hub paths (from "hubs" in novadev.json); features that touch them: 1 of 1 ("gamma", area=history)',
    );
  });

  test('nothing matches: the options are named, and so is a path no hub overlaps', () => {
    const root = hubRegistry();
    expect(run(root, 'features', '--hubs', 'nothing-like-this').stdout.trimEnd()).toBe(
      'features --hubs — 2 hub paths (from "hubs" in novadev.json); no feature matches ("nothing-like-this")',
    );
    expect(run(root, 'features', '--hubs', '--touching', 'docs/').stdout.trimEnd()).toBe(
      'features --hubs — none of the 2 hub paths (from "hubs" in novadev.json) overlaps docs/',
    );
    setManifest(root, { hubs: ['src/wb/'] });
    expect(run(root, 'features', '--hubs', '--touching', 'docs/').stdout.trimEnd()).toBe(
      'features --hubs — the hub path (from "hubs" in novadev.json) does not overlap docs/',
    );
    // Two spellings of one folder are one hub path.
    setManifest(root, { hubs: ['src/wb/', 'src/wb'] });
    expect(run(root, 'features', '--hubs', '--touching', 'docs/').stdout.trimEnd()).toBe(
      'features --hubs — the hub path (from "hubs" in novadev.json) does not overlap docs/',
    );
  });

  test('no hub paths: it says how to set them, and exits with 1', () => {
    const result = run(hubRegistry({ hubs: null }), 'features', '--hubs');
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr.trimEnd().split('\n')).toEqual([
      'novadev: no hub paths are set, so `novadev features --hubs` has nothing to list.',
      '  Set them in one of two ways:',
      '  - a "metrics" command in .novadev/novadev.json that prints a "path" for each hub',
      '    (.novadev/metrics/README.md), then `novadev sync`',
      '  - or a "hubs" list in .novadev/novadev.json: "hubs": ["src/editor/workbench/", "src/editor/stage3d.ts"]',
    ]);
  });

  test('no hub paths: a broken setting, an unreadable snapshot, a snapshot without paths, or no snapshot yet is named', () => {
    const reason = (root: string) => run(root, 'features', '--hubs').stderr.split('\n')[1];

    expect(reason(hubRegistry({ hubs: 'src/wb/' }))).toBe(
      '  novadev.json: "hubs" must be a list of paths inside the project, relative to its root and without "..", like ["src/editor/workbench/"] — or null for none',
    );

    const invalid = hubRegistry({ hubs: null });
    write(invalid, '.novadev/metrics/latest.json', '{ broken');
    expect(reason(invalid)).toBe('  the metrics snapshot (.novadev/metrics/latest.json) cannot be read: not valid JSON — `novadev sync` writes it again');

    const folder = hubRegistry({ hubs: null });
    write(folder, '.novadev/metrics/latest.json/.keep', '');
    expect(reason(folder)).toBe(
      '  the metrics snapshot (.novadev/metrics/latest.json) cannot be read: a folder, not a file — `novadev sync` writes it again',
    );

    const pathless = hubRegistry({ hubs: null });
    write(pathless, '.novadev/metrics/latest.json', JSON.stringify({ updated: '2026-10-01', hubs: [{ name: 'A', measure: 1, over: [] }, { name: 'B', measure: 2, over: [] }] }));
    expect(reason(pathless)).toBe('  the metrics snapshot names 2 hubs, but none with a "path"');

    expect(reason(hubRegistry({ hubs: null, metrics: 'cat metrics-out.json' }))).toBe(
      '  a "metrics" command is set, but no snapshot is stored yet — run `novadev sync`',
    );
  });

  test('an empty or a missing registry: the same answer as without --hubs', () => {
    const root = project({ hubs: ['src/'] });
    for (const args of [['features'], ['features', '--hubs']]) {
      expect(run(root, ...args).stdout.trim()).toBe('features — registry is empty.');
    }
    rmSync(join(root, '.novadev/features/INDEX.md'));
    for (const args of [['features'], ['features', '--hubs']]) {
      expect(run(root, ...args).stdout.trim()).toBe(
        'features — registry MISSING. An agent must create it: skills/novadev-work.md (phase 9)',
      );
    }
  });

  test('--hubs with --new is refused, and nothing is written', () => {
    const root = hubRegistry();
    const result = run(root, 'features', '--new', 'kits', '--hubs');
    expect(result.code).toBe(1);
    expect(result.stderr.trim()).toBe('novadev: --hubs and --new do not go together: --new makes a feature, --hubs lists them by hub');
    expect(exists(root, '.novadev/features/FEAT-0006-kits')).toBe(false);
  });
});

describe('novadev features — the search', () => {
  test('every feature, with its mark, status, area, title, tags, paths and folder', () => {
    const root = project();
    feature(root, 'FEAT-0001', 'alpha', { title: 'Alpha', tags: 'one, two', touches: 'src/a/' });
    feature(root, 'FEAT-0002', 'beta', { title: 'Beta', status: 'odd', area: '' });
    expect(run(root, 'features').stdout.trimEnd().split('\n')).toEqual([
      'features — 2 entries',
      '  ● FEAT-0001  [shipped]  editor  Alpha',
      '      tags: one, two',
      '      touches: src/a/',
      '      folder: FEAT-0001-alpha/',
      '  ? FEAT-0002  [odd]  —  Beta',
      '      folder: FEAT-0002-beta/',
    ]);
  });

  test('--touching marks each overlapping path and points to the playbook that ships with novadev', () => {
    const root = hubRegistry();
    run(root, 'deploy');
    const lines = run(root, 'features', '--touching', 'src/wb/').stdout.trimEnd().split('\n');
    expect(lines[0]).toBe('features — 4 of 5 match (touching=src/wb/)');
    expect(lines).toContain('      touches: src/wb/a.ts  ← overlap, src/own/');
    expect(lines).toContain('      touches: src/  ← overlap');
    expect(lines.slice(-2)).toEqual([
      'These features already claim code overlapping "src/wb/" — read them before',
      'changing that surface (skills/novadev-work.md, loop phase 2).',
    ]);
    expect(exists(root, '.novadev/skills/novadev-work.md')).toBe(true);
    expect(read(root, '.novadev/skills/novadev-work.md')).toContain('`novadev features --touching <path>`');
  });

  test('a query, --status and --area filter; no match says so', () => {
    const root = hubRegistry();
    expect(run(root, 'features', '--status', 'planned').stdout.split('\n')[0]).toBe('features — 1 of 5 match (status=planned)');
    expect(run(root, 'features', '--area', 'HISTORY').stdout.split('\n')[0]).toBe('features — 1 of 5 match (area=HISTORY)');
    expect(run(root, 'features', 'epsilon').stdout.split('\n')[0]).toBe('features — 1 of 5 match ("epsilon")');
    expect(run(root, 'features', 'nothing-like-this').stdout.trimEnd().split('\n')).toEqual([
      'features — 0 of 5 match ("nothing-like-this")',
      '  (no match — nothing in the registry covers this yet)',
    ]);
  });

  test('a bad option is refused', () => {
    const root = hubRegistry();
    expect(run(root, 'features', '--status', 'done').stderr.trim()).toBe(
      'novadev: unknown status "done" — one of: planned, in-progress, shipped, deprecated',
    );
    expect(run(root, 'features', '--hub').stderr.trim()).toBe('novadev: unknown option "--hub"');
    expect(run(root, 'features', '--touching').stderr.trim()).toBe('novadev: --touching needs a value');
  });

  test('--new scaffolds the next feature folder', () => {
    const root = hubRegistry();
    const result = run(root, 'features', '--new', 'kits', '--title', 'Kit registry', '--touches', 'src/kits/');
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('created features/FEAT-0006-kits/feature.md');
    const doc = read(root, '.novadev/features/FEAT-0006-kits/feature.md');
    expect(doc).toContain('title: Kit registry');
    expect(doc).toContain('touches: src/kits/');
  });
});
