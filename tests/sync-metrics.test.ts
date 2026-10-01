// `novadev sync` with the metrics hook, driven through the real CLI on fixture trees.
import { describe, expect, test } from 'bun:test';
import { todayStamp } from '../src/lib.ts';
import {
  completed,
  exists,
  metricsOutput,
  metricsProject,
  project,
  read,
  readJson,
  run,
  setManifest,
  todo,
  write,
} from './helpers.ts';

const BASE = {
  debt: { known: 230, new: 0 },
  hubs: [
    { name: 'Workbench', measure: 11019, over: ['loc'], path: 'src/wb/' },
    { name: 'Stage3D', measure: 3304 },
  ],
};
const GROWN = {
  debt: { known: 238, new: 0 },
  hubs: [
    { name: 'Workbench', measure: 11140, over: ['loc'], path: 'src/wb/' },
    { name: 'Stage3D', measure: 3280 },
  ],
};
const SNAPSHOT = '.novadev/metrics/latest.json';
const DEBT = '\n## Debt\n**Raise:** 230 → 238\nThe kit registry adds eight findings; todo 19 removes them again.\n';

/** The NEXT ACTIONS lines of a sync, without the arrow. */
function actions(stdout: string): string[] {
  const block = stdout.split('NEXT ACTIONS')[1]?.split('\n\n')[0] ?? '';
  return block
    .split('\n')
    .filter((line) => line.startsWith('  → '))
    .map((line) => line.slice(4));
}

describe('sync with metrics off', () => {
  test('prints nothing about metrics and writes no snapshot — absent or null', () => {
    for (const manifest of [{}, { metrics: null, debtBudget: null }]) {
      const root = project(manifest);
      const result = run(root, 'sync');
      expect(result.code).toBe(0);
      expect(result.stdout).not.toContain('metrics');
      expect(result.stdout).toContain('sync: clean. ✓');
      expect(exists(root, SNAPSHOT)).toBe(false);
    }
  });
});

describe('sync takes snapshots', () => {
  test('the first run stores the snapshot and adds the wiki block, and is clean', () => {
    const root = metricsProject(BASE);
    const result = run(root, 'sync');
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('metrics: running `cat metrics-out.json` …');
    expect(result.stdout).toContain('metrics: first snapshot stored — .novadev/metrics/latest.json');
    expect(result.stdout).toContain('sync: clean. ✓');
    expect(readJson(root, SNAPSHOT)).toEqual({
      updated: todayStamp(),
      debt: { known: 230, new: 0 },
      hubs: [
        { name: 'Stage3D', measure: 3304, over: [] },
        { name: 'Workbench', measure: 11019, over: ['loc'], path: 'src/wb/' },
      ],
    });
    expect(read(root, '.novadev/wiki/architecture.md')).toContain('| Workbench | 11,019 | loc | `src/wb/` |');
  });

  test('growth becomes NEXT ACTIONS, shrinking does not, and the next pass settles', () => {
    const root = metricsProject(BASE);
    run(root, 'sync');
    metricsOutput(root, GROWN);

    const second = run(root, 'sync');
    expect(second.code).toBe(0);
    expect(second.stdout).toContain('metrics: snapshot updated — .novadev/metrics/latest.json');
    expect(second.stdout).toContain('  ↑ known debt 230 → 238 (+8)');
    expect(second.stdout).toContain('  ↑ hub Workbench 11,019 → 11,140 (+121)');
    expect(second.stdout).toContain('  ↓ hub Stage3D 3,304 → 3,280 (-24)');
    expect(actions(second.stdout)).toEqual([
      "known debt 230 → 238 (+8) — it grew: explain why in this round's record, or reduce it",
      'hub Workbench 11,019 → 11,140 (+121) — a hub grew: explain in the record why the change belongs there, or move it to a smaller unit',
    ]);
    expect(second.stdout).not.toContain('sync: clean');
    expect(readJson(root, SNAPSHOT).debt).toEqual({ known: 238, new: 0 });
    expect(read(root, '.novadev/wiki/architecture.md')).toContain('| Workbench | 11,140 |');

    const third = run(root, 'sync');
    expect(third.stdout).toContain('metrics: no change since the last snapshot');
    expect(third.stdout).toContain('sync: clean. ✓');
  });

  test('an unchanged snapshot is not rewritten — its date stays the day the numbers changed', () => {
    const root = metricsProject(BASE);
    run(root, 'sync');
    const old = read(root, SNAPSHOT).replace(todayStamp(), '2026-01-02');
    write(root, SNAPSHOT, old);
    const result = run(root, 'sync');
    expect(result.stdout).toContain('no change since the last snapshot');
    expect(read(root, SNAPSHOT)).toBe(old);
  });

  test('--check compares and checks, but writes nothing', () => {
    const root = metricsProject(BASE, { debtBudget: { maxKnown: 230 } });
    run(root, 'sync');
    metricsOutput(root, { ...GROWN, debt: { known: 225, new: 0 } });
    const files = [SNAPSHOT, '.novadev/novadev.json', '.novadev/wiki/architecture.md'];
    const before = files.map((f) => read(root, f));

    const result = run(root, 'sync', '--check');
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(
      'metrics: changed since the stored snapshot — `novadev sync` stores the new one in .novadev/metrics/latest.json',
    );
    expect(result.stdout).toContain('↓ known debt 230 → 225 (-5)');
    expect(files.map((f) => read(root, f))).toEqual(before);
  });

  test('--check on a project with no snapshot yet stores none', () => {
    const root = metricsProject(BASE);
    const result = run(root, 'sync', '--check');
    expect(result.stdout).toContain('no snapshot is stored yet — `novadev sync` stores the first one');
    expect(exists(root, SNAPSHOT)).toBe(false);
  });
});

describe('a missing or failing command is a warning, never a failure', () => {
  const cases: [string, string, Record<string, unknown>, string][] = [
    ['a non-zero exit', 'echo boom >&2; exit 4', {}, 'exited with 4 — boom'],
    ['output that is not JSON', 'echo compiling', {}, 'its output is not JSON (it starts with "compiling")'],
    ['a JSON shape novadev cannot read', 'echo \'{"debt":{"known":"many"}}\'', {}, '"debt.known" must be a whole number'],
    ['a program that does not exist', 'no-such-tool-for-novadev-tests', {}, 'exited with 127'],
    ['a command that hangs', 'sleep 5', { metricsTimeoutSeconds: 0.3 }, 'did not finish within 0.3 s'],
  ];
  for (const [name, command, extra, message] of cases) {
    test(name, () => {
      const root = metricsProject(BASE);
      run(root, 'sync');
      const stored = read(root, SNAPSHOT);
      setManifest(root, { metrics: command, ...extra });
      for (const args of [['sync'], ['sync', '--check']]) {
        const result = run(root, ...args);
        expect(result.code).toBe(0);
        expect(result.stdout).toContain('metrics: ⚠ the command failed — ');
        expect(result.stdout).toContain(message);
        expect(result.stdout).toContain('the snapshot was not updated');
      }
      expect(read(root, SNAPSHOT)).toBe(stored);
    });
  }

  test('no command, but a stored snapshot or a budget: warned once, not failed', () => {
    const root = metricsProject(BASE, { debtBudget: { maxKnown: 300 } });
    run(root, 'sync');
    setManifest(root, { metrics: null });
    const result = run(root, 'sync');
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('metrics: ⚠ no "metrics" command is set in novadev.json');
    expect(result.stdout).toContain('debt budget: known debt 230 of 300 ✓ (stored snapshot)');
  });

  test('a setting with the wrong type is a PROBLEM', () => {
    const root = project({ metrics: 42 });
    const result = run(root, 'sync');
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('✗ novadev.json: "metrics" must be a shell command');
  });
});

describe('the debt budget', () => {
  test('within budget: reported, clean', () => {
    const root = metricsProject(BASE, { debtBudget: { maxKnown: 230 } });
    const result = run(root, 'sync');
    expect(result.stdout).toContain('debt budget: known debt 230 of 230 ✓');
    expect(result.stdout).toContain('sync: clean. ✓');
    expect(read(root, '.novadev/wiki/architecture.md')).toContain('**Known debt:** 230 (budget 230)');
  });

  test('over budget: a NEXT ACTION for sync, a failure for sync --check', () => {
    const root = metricsProject(BASE, { debtBudget: { maxKnown: 230 } });
    run(root, 'sync');
    metricsOutput(root, GROWN);

    const check = run(root, 'sync', '--check');
    expect(check.code).toBe(1);
    expect(check.stdout).toContain('✗ known debt 238 is over the budget 230');

    const plain = run(root, 'sync');
    expect(plain.code).toBe(0);
    expect(actions(plain.stdout)).toContain(
      'known debt 238 is over the budget 230 — reduce it, or raise the budget in this round\'s record: add a "## Debt" section with "**Raise:** 230 → 238" and the reason',
    );
    // The growth line goes once the snapshot moved on; the budget line stays until it is resolved.
    const again = run(root, 'sync');
    expect(actions(again.stdout)).toEqual([expect.stringContaining('known debt 238 is over the budget 230')]);
    expect(run(root, 'sync', '--check').code).toBe(1);
  });

  test('a record raises it: --check accepts the raise, sync writes it once', () => {
    const root = metricsProject(GROWN, { debtBudget: { maxKnown: 230 } });
    todo(root, '2026-10-01_1/01-kits', { 'ai_completed.md': completed('01-kits', DEBT) });
    const manifestBefore = read(root, '.novadev/novadev.json');

    const check = run(root, 'sync', '--check');
    expect(check.code).toBe(0);
    expect(check.stdout).toContain(
      'debt budget: 2026-10-01_1/01-kits raises it 230 → 238 — `novadev sync` writes that to novadev.json',
    );
    expect(check.stdout).toContain('debt budget: known debt 238 of 238 ✓');
    expect(read(root, '.novadev/novadev.json')).toBe(manifestBefore);

    const plain = run(root, 'sync');
    expect(plain.code).toBe(0);
    expect(plain.stdout).toContain('debt budget raised 230 → 238 by 2026-10-01_1/01-kits');
    const budget = readJson(root, '.novadev/novadev.json').debtBudget;
    expect(budget).toEqual({
      maxKnown: 238,
      raises: [{ by: '2026-10-01_1/01-kits', from: 230, to: 238, on: todayStamp() }],
    });
    // Every other setting survives the rewrite.
    expect(readJson(root, '.novadev/novadev.json').metrics).toBe('cat metrics-out.json');

    const again = run(root, 'sync');
    expect(again.stdout).not.toContain('raised');
    expect(readJson(root, '.novadev/novadev.json').debtBudget.raises).toHaveLength(1);
  });

  test('an old raise never loosens a budget someone lowered later', () => {
    const root = metricsProject(GROWN, { debtBudget: { maxKnown: 230 } });
    todo(root, '2026-10-01_1/01-kits', { 'ai_completed.md': completed('01-kits', DEBT) });
    run(root, 'sync');
    const manifest = readJson(root, '.novadev/novadev.json');
    setManifest(root, { debtBudget: { ...manifest.debtBudget, maxKnown: 200 } });

    const result = run(root, 'sync');
    expect(readJson(root, '.novadev/novadev.json').debtBudget.maxKnown).toBe(200);
    expect(result.stdout).toContain('✗ known debt 238 is over the budget 200');
    expect(run(root, 'sync', '--check').code).toBe(1);
  });

  test('switching the budget off and on again does not bring back archived raises', () => {
    const root = metricsProject(GROWN, { debtBudget: { maxKnown: 200 } });
    write(
      root,
      '.novadev/archive/2026/todos/2026-09-01_1/01-old/ai_completed.md',
      completed('01-old', DEBT.replace('230 → 238', '200 → 300')),
    );
    write(root, '.novadev/archive/2026/todos/2026-09-01_1/01-old/prompt.md', '# old\n');
    const result = run(root, 'sync');
    expect(result.stdout).not.toContain('raised');
    expect(readJson(root, '.novadev/novadev.json').debtBudget).toEqual({ maxKnown: 200 });
    expect(result.stdout).toContain('✗ known debt 238 is over the budget 200');
  });

  test('a raise without a reason is a PROBLEM and is not applied', () => {
    const root = metricsProject(GROWN, { debtBudget: { maxKnown: 230 } });
    todo(root, '2026-10-01_1/01-kits', {
      'ai_completed.md': completed('01-kits', '\n## Debt\n**Raise:** 230 → 238\n'),
    });
    const result = run(root, 'sync');
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('PROBLEMS (1):');
    expect(result.stdout).toContain('gives no reason');
    expect(readJson(root, '.novadev/novadev.json').debtBudget).toEqual({ maxKnown: 230 });
    expect(run(root, 'sync', '--check').code).toBe(1);
  });

  test('when the command fails, the budget is checked against the stored snapshot', () => {
    const root = metricsProject(GROWN, { debtBudget: { maxKnown: 300 } });
    run(root, 'sync');
    setManifest(root, { metrics: 'exit 1', debtBudget: { maxKnown: 230 } });
    const result = run(root, 'sync', '--check');
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('✗ known debt 238 is over the budget 230 (stored snapshot)');
  });

  test('metrics without a debt count cannot check a budget, and say so', () => {
    const root = metricsProject({ hubs: [] }, { debtBudget: { maxKnown: 1 } });
    const result = run(root, 'sync', '--check');
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('debt budget: not checked — the metrics have no "debt" count');
  });
});
