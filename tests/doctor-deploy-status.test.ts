// `novadev deploy`, `novadev doctor` and `novadev status` around the metrics folder and settings.
import { describe, expect, test } from 'bun:test';
import { NOVADEV_VERSION, todayStamp } from '../src/lib.ts';
import { exists, project, read, readJson, run, setManifest, tempDir, write } from './helpers.ts';

/** A deployed project with a complete wiki: what doctor calls healthy. */
function deployed(): string {
  const root = project();
  const result = run(root, 'deploy');
  expect(result.code).toBe(0);
  return root;
}

describe('deploy', () => {
  test('a first deploy creates metrics/ with its README and shows both settings, off', () => {
    const root = tempDir();
    expect(run(root, 'deploy').code).toBe(0);
    expect(read(root, '.novadev/metrics/README.md')).toContain('# metrics — the project\'s own numbers');
    expect(readJson(root, '.novadev/novadev.json')).toEqual({
      novadev: true,
      version: NOVADEV_VERSION,
      deployedAt: todayStamp(),
      metrics: null,
      debtBudget: null,
    });
  });

  test('a re-deploy keeps every setting — and does not bring back settings someone deleted', () => {
    const root = tempDir();
    run(root, 'deploy');
    const budget = { maxKnown: 238, raises: [{ by: '2026-10-01_1/01-a', from: 230, to: 238, on: '2026-10-01' }] };
    setManifest(root, { metrics: 'bun scripts/metrics.ts', debtBudget: budget, archiveGraceDays: 5 });
    run(root, 'deploy');
    expect(readJson(root, '.novadev/novadev.json')).toMatchObject({
      metrics: 'bun scripts/metrics.ts',
      debtBudget: budget,
      archiveGraceDays: 5,
    });

    const manifest = readJson(root, '.novadev/novadev.json');
    delete manifest.metrics;
    delete manifest.debtBudget;
    write(root, '.novadev/novadev.json', JSON.stringify(manifest, null, 2) + '\n');
    run(root, 'deploy');
    const after = readJson(root, '.novadev/novadev.json');
    expect('metrics' in after).toBe(false);
    expect('debtBudget' in after).toBe(false);
  });
});

describe('doctor', () => {
  test('a deployed project with metrics/ is healthy — the folder is novadev\'s', () => {
    const root = deployed();
    expect(exists(root, '.novadev/metrics/README.md')).toBe(true);
    const result = run(root, 'doctor');
    expect(result.stdout.trim()).toBe('doctor: structure is healthy.');
    expect(result.code).toBe(0);
  });

  test('a folder novadev does not know is still only a note', () => {
    const root = deployed();
    write(root, '.novadev/drafts/x.md', 'x');
    const result = run(root, 'doctor');
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('.novadev/drafts/: not a novadev folder (tolerated)');
    expect(result.stdout).not.toContain('.novadev/metrics/');
  });

  test('a malformed snapshot, a bad setting, and a stale budgets block are problems', () => {
    const root = deployed();
    setManifest(root, { metrics: 'cat metrics-out.json', debtBudget: { maxKnown: 'lots' } });
    write(root, '.novadev/metrics/latest.json', '{ broken');
    const broken = run(root, 'doctor');
    expect(broken.code).toBe(1);
    expect(broken.stdout).toContain('✗ metrics/latest.json: not valid JSON');
    expect(broken.stdout).toContain('✗ novadev.json: "debtBudget.maxKnown" must be a whole number');

    setManifest(root, { debtBudget: { maxKnown: 230 } });
    write(root, '.novadev/metrics/latest.json', '{"updated":"2026-10-01","debt":{"known":230},"hubs":[]}');
    const stale = run(root, 'doctor');
    expect(stale.code).toBe(1);
    expect(stale.stdout).toContain('✗ wiki/architecture.md: budgets block missing — run `novadev sync`');

    write(root, 'metrics-out.json', '{"debt":{"known":230},"hubs":[]}');
    expect(run(root, 'sync').code).toBe(0);
    expect(run(root, 'doctor').stdout.trim()).toBe('doctor: structure is healthy.');
  });

  test('never runs the metrics command', () => {
    const root = deployed();
    setManifest(root, { metrics: 'touch doctor-ran' });
    run(root, 'doctor');
    expect(exists(root, 'doctor-ran')).toBe(false);
  });
});

describe('status', () => {
  test('one line about metrics: off, waiting for a first snapshot, or the numbers', () => {
    const root = project();
    expect(run(root, 'status').stdout).toContain('metrics — off (no "metrics" command in novadev.json)');

    setManifest(root, { metrics: 'cat metrics-out.json', debtBudget: { maxKnown: 240 } });
    expect(run(root, 'status').stdout).toContain('metrics — on, no snapshot yet');

    write(
      root,
      'metrics-out.json',
      '{"debt":{"known":238,"new":1},"hubs":[{"name":"A","measure":5},{"name":"B","measure":6}]}',
    );
    run(root, 'sync');
    expect(run(root, 'status').stdout).toContain(
      `metrics — known debt 238 of 240, 1 new, 2 hub(s), as of ${todayStamp()}`,
    );
  });
});
