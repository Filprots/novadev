// `novadev sync` with the metrics hook, driven through the real CLI on fixture trees.
import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { todayStamp } from '../src/lib.ts';
import {
  CLI,
  cleanEnv,
  commitAll,
  completed,
  exists,
  git,
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
const DEBT_ACTION = 'it grew: say why in a "## Debt" section of this round\'s record, or reduce it';
const HUB_ACTION =
  'a hub grew: name it in a "## Debt" section of this round\'s record and say why the change belongs there, or move it to a smaller unit';

/** The NEXT ACTIONS lines of a sync, without the arrow. */
function actions(stdout: string): string[] {
  const block = stdout.split('NEXT ACTIONS')[1]?.split('\n\n')[0] ?? '';
  return block
    .split('\n')
    .filter((line) => line.startsWith('  → '))
    .map((line) => line.slice(4));
}

/** True while a process with this id exists. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Wait (up to `ms`) for a condition, checking every 25 ms. */
async function until(condition: () => boolean, ms = 3000): Promise<boolean> {
  for (const end = Date.now() + ms; Date.now() < end; await Bun.sleep(25)) {
    if (condition()) return true;
  }
  return condition();
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
    expect(result.stdout).toContain('derived: regenerated 2 file(s)');
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

  test('without git: growth is listed once as NEXT ACTIONS, shrinking only reported, and the next pass settles', () => {
    const root = metricsProject(BASE);
    run(root, 'sync');
    metricsOutput(root, GROWN);

    const second = run(root, 'sync');
    expect(second.code).toBe(0);
    expect(second.stdout).toContain('metrics: snapshot updated — .novadev/metrics/latest.json');
    expect(second.stdout).toContain('  ↑ known debt 230 → 238 (+8)');
    expect(second.stdout).toContain('  ↑ hub Workbench 11,019 → 11,140 (+121)');
    expect(second.stdout).toContain('  ↓ hub Stage3D 3,304 → 3,280 (-24)');
    expect(second.stdout).not.toContain('since the last commit');
    expect(actions(second.stdout)).toEqual([
      `known debt 230 → 238 (+8) — ${DEBT_ACTION}`,
      `hub Workbench 11,019 → 11,140 (+121) — ${HUB_ACTION}`,
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

  test('--check writes nothing, and fails while the snapshot is stale — like any derived file', () => {
    const root = metricsProject(BASE, { debtBudget: { maxKnown: 230 } });
    run(root, 'sync');
    metricsOutput(root, { ...GROWN, debt: { known: 225, new: 0 } });
    const files = [SNAPSHOT, '.novadev/novadev.json', '.novadev/wiki/architecture.md'];
    const before = files.map((f) => read(root, f));

    const check = run(root, 'sync', '--check');
    expect(check.code).toBe(1);
    expect(check.stdout).toContain(
      'metrics: changed since the stored snapshot — `novadev sync` stores the new one in .novadev/metrics/latest.json',
    );
    expect(check.stdout).toContain('↓ known debt 230 → 225 (-5)');
    // The snapshot, and the wiki block judged against the numbers sync would store.
    expect(check.stdout).toContain('derived: 2 file(s) are stale');
    expect(check.stdout).toContain('sync --check: ✗ 2 stale derived file(s)');
    expect(files.map((f) => read(root, f))).toEqual(before);

    expect(run(root, 'sync').code).toBe(0);
    expect(run(root, 'sync', '--check').code).toBe(0);
  });

  test('--check on a project with no snapshot yet stores none, and fails', () => {
    const root = metricsProject(BASE);
    const result = run(root, 'sync', '--check');
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('no snapshot is stored yet — `novadev sync` stores the first one');
    expect(exists(root, SNAPSHOT)).toBe(false);
  });

  test('a snapshot that cannot be read is written again when the command works', () => {
    const root = metricsProject(BASE);
    run(root, 'sync');
    write(root, SNAPSHOT, '{\n<<<<<<< HEAD\n}\n');
    const result = run(root, 'sync');
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('metrics: snapshot written again — .novadev/metrics/latest.json could not be read');
    expect(readJson(root, SNAPSHOT).debt).toEqual({ known: 230, new: 0 });
    expect(result.stdout).toContain('sync: clean. ✓');
  });

  test('hub paths printed with backslashes are stored with forward slashes', () => {
    const root = metricsProject({ hubs: [{ name: 'Workbench', measure: 1, path: '.\\src\\wb\\' }] });
    run(root, 'sync');
    expect(readJson(root, SNAPSHOT).hubs[0].path).toBe('src/wb/');
  });
});

describe('growth is listed until this round explains it (with git)', () => {
  function committedProject(): string {
    const root = metricsProject(BASE);
    run(root, 'sync');
    todo(root, '2026-09-30_1/01-old', {
      'ai_completed.md': completed('01-old', '\n## Debt\nWorkbench grew in an earlier round; the debt too.\n'),
    });
    commitAll(root, 'base');
    metricsOutput(root, GROWN);
    return root;
  }

  test('a growth item stays on the list on every sync of the round, compared with the last commit', () => {
    const root = committedProject();
    const first = run(root, 'sync');
    expect(first.stdout).toContain('metrics: snapshot updated');
    expect(first.stdout).toContain('  since the last commit:\n  ↑ known debt 230 → 238 (+8)');

    const second = run(root, 'sync');
    expect(second.stdout).toContain('metrics: no change since the last snapshot');
    expect(second.stdout).toContain('  ↑ hub Workbench 11,019 → 11,140 (+121)');
    expect(actions(second.stdout)).toEqual([
      `known debt 230 → 238 (+8) — ${DEBT_ACTION}`,
      `hub Workbench 11,019 → 11,140 (+121) — ${HUB_ACTION}`,
    ]);
  });

  test('a record changed in this round explains it: the hub by name, the debt by the section', () => {
    const root = committedProject();
    run(root, 'sync');
    todo(root, '2026-10-01_1/01-kits', {
      'ai_completed.md': completed('01-kits', '\n## Debt\nThe kit registry lives in the workbench for now; todo 19 moves it.\n'),
    });
    const result = run(root, 'sync');
    expect(result.stdout).toContain('  ↑ known debt 230 → 238 (+8) — explained in 2026-10-01_1/01-kits');
    expect(result.stdout).toContain('  ↑ hub Workbench 11,019 → 11,140 (+121) — explained in 2026-10-01_1/01-kits');
    expect(actions(result.stdout)).toEqual([]);
  });

  test('a record that only mentions the debt does not explain a hub', () => {
    const root = committedProject();
    todo(root, '2026-10-01_1/01-kits', {
      'ai_completed.md': completed('01-kits', '\n## Debt\nEight new findings from the kit registry.\n'),
    });
    const result = run(root, 'sync');
    expect(actions(result.stdout)).toEqual([`hub Workbench 11,019 → 11,140 (+121) — ${HUB_ACTION}`]);
  });

  test('an older record, committed before, does not explain this round', () => {
    const root = committedProject();
    const result = run(root, 'sync');
    expect(result.stdout).not.toContain('explained in 2026-09-30_1/01-old');
    expect(actions(result.stdout)).toHaveLength(2);
  });

  test("an old record edited after its commit (a **Commits:** line) does not explain this round's growth", () => {
    const root = committedProject();
    const old = read(root, '.novadev/todos/2026-09-30_1/01-old/ai_completed.md');
    todo(root, '2026-09-30_1/01-old', { 'ai_completed.md': old.replace('**Feature:**', `**Commits:** ${git(root, 'rev-parse', '--short', 'HEAD').stdout.trim()}\n**Feature:**`) });
    const result = run(root, 'sync');
    expect(result.stdout).not.toContain('explained in 2026-09-30_1/01-old');
    expect(actions(result.stdout)).toHaveLength(2);
  });

  test('a line this round adds to an old record explains what it names', () => {
    const root = committedProject();
    const old = read(root, '.novadev/todos/2026-09-30_1/01-old/ai_completed.md');
    todo(root, '2026-09-30_1/01-old', {
      'ai_completed.md': `${old}This round the Workbench grew again: the kit registry moved in.\n`,
    });
    const result = run(root, 'sync');
    expect(result.stdout).toContain('  ↑ hub Workbench 11,019 → 11,140 (+121) — explained in 2026-09-30_1/01-old');
    expect(result.stdout).toContain('  ↑ known debt 230 → 238 (+8) — explained in 2026-09-30_1/01-old');
  });

  test('a section that only says there is no new debt explains nothing', () => {
    const root = committedProject();
    todo(root, '2026-10-01_1/01-kits', { 'ai_completed.md': completed('01-kits', '\n## Debt\nNo new debt was added in this round.\n') });
    expect(actions(run(root, 'sync').stdout)).toEqual([
      `known debt 230 → 238 (+8) — ${DEBT_ACTION}`,
      `hub Workbench 11,019 → 11,140 (+121) — ${HUB_ACTION}`,
    ]);
  });

  test('once the round is committed, the list is clean', () => {
    const root = committedProject();
    run(root, 'sync');
    commitAll(root, 'round');
    const result = run(root, 'sync');
    expect(result.stdout).toContain('metrics: no change since the last snapshot');
    expect(result.stdout).not.toContain('since the last commit');
    expect(result.stdout).toContain('sync: clean. ✓');
  });
});

describe('a missing or failing command is a warning, never a failure', () => {
  const cases: [string, string, Record<string, unknown>, string][] = [
    ['a non-zero exit', 'echo boom >&2; exit 4', {}, 'exited with 4 — boom'],
    ['output that is not JSON', 'echo compiling', {}, 'its output is not JSON (it starts with "compiling")'],
    ['a JSON shape novadev cannot read', 'echo \'{"debt":{"known":"many"}}\'', {}, '"debt.known" must be a whole number'],
    ['a program that does not exist', 'no-such-tool-for-novadev-tests', {}, 'exited with 127'],
    ['a command that hangs', 'sleep 5', { metricsTimeoutSeconds: 0.3 }, 'did not finish within 0.3 s'],
    ['a timeout too small to round', 'sleep 5', { metricsTimeoutSeconds: 0.0001 }, 'did not finish within 0.0001 s'],
    ['a command novadev cannot even start', 'cat metrics-out.json\u0000', {}, 'could not run'],
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
        expect(result.stderr).toBe('');
        expect(result.stdout).toContain('metrics: ⚠ the command failed — ');
        expect(result.stdout).toContain(message);
        expect(result.stdout).toContain('the snapshot was not updated');
      }
      expect(read(root, SNAPSHOT)).toBe(stored);
    });
  }

  test('a timed-out command is stopped with everything it started', () => {
    const root = metricsProject(BASE);
    setManifest(root, { metrics: "sh -c 'sleep 30 & echo $! > child.pid; wait'", metricsTimeoutSeconds: 0.5 });
    const result = run(root, 'sync');
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('did not finish within 0.5 s');
    const pid = Number(read(root, 'child.pid'));
    const stopped = !alive(pid);
    if (!stopped) process.kill(pid, 'SIGKILL');
    expect(stopped).toBe(true);
  });

  test('a huge timeout does not fire at once', () => {
    const root = metricsProject(BASE, { metricsTimeoutSeconds: 1e10 });
    const result = run(root, 'sync');
    expect(result.stdout).toContain('metrics: first snapshot stored');
  });

  test('stopping novadev while the command runs stops the command too', async () => {
    const root = metricsProject(BASE);
    setManifest(root, { metrics: "sh -c 'sleep 30 & echo $! > child.pid; wait'" });
    const sync = Bun.spawn({ cmd: [process.execPath, CLI, 'sync'], cwd: root, env: cleanEnv(), stdout: 'pipe', stderr: 'pipe' });
    const pidFile = join(root, 'child.pid');
    expect(await until(() => existsSync(pidFile) && readFileSync(pidFile, 'utf8').trim() !== '')).toBe(true);
    const pid = Number(readFileSync(pidFile, 'utf8'));
    sync.kill('SIGINT');
    expect(await sync.exited).toBe(130);
    // novadev exited through its handler, which stops the command; killed by the signal itself,
    // it would also show 130, and leave the command running.
    expect(sync.signalCode).toBeNull();
    const stopped = await until(() => !alive(pid));
    if (!stopped) process.kill(pid, 'SIGKILL');
    expect(stopped).toBe(true);
  });

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

  test('output that stops printing "debt" is a warning: the snapshot keeps its count, the budget still applies', () => {
    const root = metricsProject(GROWN, { debtBudget: { maxKnown: 230 } });
    run(root, 'sync');
    const stored = read(root, SNAPSHOT);
    metricsOutput(root, { hubs: GROWN.hubs });
    const check = run(root, 'sync', '--check');
    expect(check.code).toBe(1);
    expect(check.stdout).toContain('metrics: ⚠ the command no longer prints "debt" — the stored snapshot has known debt 238');
    expect(check.stdout).toContain('✗ known debt 238 is over the budget 230 (stored snapshot)');
    const plain = run(root, 'sync');
    expect(plain.code).toBe(0);
    expect(plain.stdout).toContain('if the project stopped counting debt on purpose');
    expect(read(root, SNAPSHOT)).toBe(stored);
  });

  test('with a debt budget, output that lost "debt" keeps the last commit\'s count when no snapshot is stored', () => {
    const root = metricsProject(GROWN, { debtBudget: { maxKnown: 230 } });
    run(root, 'sync');
    commitAll(root, 'base');
    rmSync(join(root, SNAPSHOT)); // the README's advice for a merge conflict
    metricsOutput(root, { hubs: GROWN.hubs });
    const plain = run(root, 'sync');
    expect(plain.stdout).toContain(
      'metrics: ⚠ the command no longer prints "debt" — the last commit\'s snapshot has known debt 238',
    );
    expect(plain.stdout).toContain("no snapshot is stored; the checks below use the last commit's");
    expect(plain.stdout).toContain("✗ known debt 238 is over the budget 230 (the last commit's snapshot)");
    expect(exists(root, SNAPSHOT)).toBe(false);
    expect(run(root, 'sync', '--check').code).toBe(1);
  });

  test('a stored snapshot without "debt" does not hide the last commit\'s count from the budget', () => {
    const root = metricsProject(GROWN, { debtBudget: { maxKnown: 230 } });
    run(root, 'sync');
    commitAll(root, 'base');
    write(root, SNAPSHOT, JSON.stringify({ updated: '2026-10-01', hubs: [] }));
    for (const command of ['cat metrics-out.json', 'exit 1']) {
      setManifest(root, { metrics: command });
      metricsOutput(root, { hubs: [] });
      const result = run(root, 'sync', '--check');
      expect(result.code).toBe(1);
      expect(result.stdout).toContain('the stored snapshot has no "debt" count; the checks below use the last commit\'s');
      expect(result.stdout).toContain("✗ known debt 238 is over the budget 230 (the last commit's snapshot)");
    }
  });

  test('without a debt budget, deleting the snapshot starts again: output with no "debt" is stored', () => {
    const root = metricsProject(GROWN);
    run(root, 'sync');
    commitAll(root, 'base');
    rmSync(join(root, SNAPSHOT));
    metricsOutput(root, { hubs: GROWN.hubs });
    expect(run(root, 'sync').stdout).toContain('metrics: first snapshot stored');
    expect(readJson(root, SNAPSHOT).debt).toBeUndefined();
  });

  test('a failing command with no stored snapshot checks the budget against the last commit\'s', () => {
    const root = metricsProject(GROWN, { debtBudget: { maxKnown: 238 } });
    run(root, 'sync');
    commitAll(root, 'base');
    rmSync(join(root, SNAPSHOT));
    setManifest(root, { metrics: 'exit 1', debtBudget: { maxKnown: 230 } });
    const result = run(root, 'sync', '--check');
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("no snapshot is stored; the checks below use the last commit's");
    expect(result.stdout).toContain("✗ known debt 238 is over the budget 230 (the last commit's snapshot)");
  });

  test('a conflicted snapshot with a failing command: a NEXT ACTION for sync, a failure for --check', () => {
    const root = metricsProject(BASE);
    run(root, 'sync');
    write(root, SNAPSHOT, '{\n<<<<<<< HEAD\n  "updated": "2026-10-01",\n=======\n  "updated": "2026-10-02",\n>>>>>>> other\n  "hubs": []\n}\n');
    const page = read(root, '.novadev/wiki/architecture.md');
    setManifest(root, { metrics: 'exit 1' });

    const plain = run(root, 'sync');
    expect(plain.code).toBe(0);
    expect(plain.stdout).toContain('the stored latest.json cannot be read either (not valid JSON)');
    expect(actions(plain.stdout)).toEqual([
      'metrics/latest.json cannot be read (not valid JSON) — if it holds merge-conflict markers, keep one side; or delete it, and `novadev sync` writes it again once the metrics command works',
    ]);
    expect(read(root, '.novadev/wiki/architecture.md')).toBe(page);

    const check = run(root, 'sync', '--check');
    expect(check.code).toBe(1);
    expect(check.stdout).toContain('sync --check: ✗ metrics/latest.json cannot be read');
  });

  test('a process the command leaves behind does not cost the output, and is stopped', () => {
    const root = metricsProject(BASE, { metricsTimeoutSeconds: 1 });
    setManifest(root, { metrics: '(sleep 30 & echo $! > left.pid); cat metrics-out.json; sleep 0.3' });
    const started = Date.now();
    const result = run(root, 'sync');
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('metrics: first snapshot stored');
    // The command took 0.3 s; the process it left holds the output open, so sync waits the 2 s
    // drain, then reads the output and stops that process — it never waits for the 30 s.
    expect(Date.now() - started).toBeLessThan(10_000);
    const pid = Number(read(root, 'left.pid'));
    const stopped = !alive(pid);
    if (!stopped) process.kill(pid, 'SIGKILL');
    expect(stopped).toBe(true);
  });

  test('a folder where the snapshot belongs is a PROBLEM, never a crash, and stays as it is', () => {
    const root = metricsProject(BASE);
    mkdirSync(join(root, SNAPSHOT), { recursive: true });
    for (const args of [['sync'], ['sync', '--check']]) {
      const result = run(root, ...args);
      expect(result.stderr).toBe('');
      expect(result.code).toBe(1);
      expect(result.stdout).toContain(
        'metrics: ⚠ the snapshot cannot be stored — .novadev/metrics/latest.json is a folder, not a file',
      );
      expect(result.stdout).toContain('✗ metrics/latest.json: a folder, not a file — novadev keeps its snapshot in a plain file of that name; move it away');
    }
    expect(statSync(join(root, SNAPSHOT)).isDirectory()).toBe(true);
    expect(read(root, '.novadev/wiki/architecture.md')).not.toContain('novadev:budgets');
  });

  test('a file where the metrics folder belongs is a PROBLEM, never a crash', () => {
    const root = metricsProject(BASE);
    write(root, '.novadev/metrics', 'a file');
    const result = run(root, 'sync');
    expect(result.stderr).toBe('');
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('metrics: ⚠ the snapshot cannot be stored — .novadev/metrics is a file, not a folder');
    expect(result.stdout).toContain('✗ metrics: a file, not a folder');
    expect(read(root, '.novadev/metrics')).toBe('a file');
  });
});

describe('the debt budget', () => {
  test('within budget: reported, clean', () => {
    const root = metricsProject(BASE, { debtBudget: { maxKnown: 230 } });
    const result = run(root, 'sync');
    expect(result.stdout).toContain('debt budget: known debt 230 of 230 ✓');
    expect(result.stdout).not.toContain('under it');
    expect(result.stdout).toContain('sync: clean. ✓');
    expect(read(root, '.novadev/wiki/architecture.md')).toContain('**Known debt:** 230 (budget 230)');
  });

  test('under budget: a NEXT ACTION to lower it, so the gain is kept — following it settles', () => {
    const root = metricsProject(BASE, { debtBudget: { maxKnown: 240 } });
    const result = run(root, 'sync');
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('debt budget: known debt 230 of 240 ✓');
    expect(actions(result.stdout)).toEqual([
      'known debt 230 is under the budget 240 — lower "maxKnown" to 230 in novadev.json, so the gain is kept',
    ]);
    // Not a gate failure: a loose budget is the project's choice until someone lowers it.
    expect(run(root, 'sync', '--check').code).toBe(0);

    setManifest(root, { debtBudget: { ...readJson(root, '.novadev/novadev.json').debtBudget, maxKnown: 230 } });
    expect(run(root, 'sync').stdout).toContain('sync: clean. ✓');
  });

  test('under budget on stored numbers only (the command failed): no NEXT ACTION to lower it', () => {
    const root = metricsProject(BASE, { debtBudget: { maxKnown: 230 } });
    run(root, 'sync');
    setManifest(root, { metrics: 'exit 1', debtBudget: { maxKnown: 240 } });
    const result = run(root, 'sync');
    expect(result.stdout).toContain('debt budget: known debt 230 of 240 ✓ (stored snapshot)');
    expect(result.stdout).not.toContain('lower "maxKnown"');
  });

  test('over budget: a NEXT ACTION for sync, a failure for sync --check', () => {
    const root = metricsProject(BASE, { debtBudget: { maxKnown: 230 } });
    run(root, 'sync');
    metricsOutput(root, GROWN);

    const check = run(root, 'sync', '--check');
    expect(check.code).toBe(1);
    expect(check.stdout).toContain('✗ known debt 238 is over the budget 230');
    expect(check.stdout).toContain('known debt is over the budget');

    const plain = run(root, 'sync');
    expect(plain.code).toBe(0);
    expect(actions(plain.stdout)).toContain(
      'known debt 238 is over the budget 230 — reduce it, or raise the budget in this round\'s record: add a "## Debt" section with "**Raise:** 230 → 238" and the reason',
    );
    // Without git the growth line goes once the snapshot moved on; the budget line stays until it is resolved.
    const again = run(root, 'sync');
    expect(actions(again.stdout)).toEqual([expect.stringContaining('known debt 238 is over the budget 230')]);
    const recheck = run(root, 'sync', '--check');
    expect(recheck.code).toBe(1);
    expect(recheck.stdout).toContain('sync --check: ✗ known debt is over the budget');
  });

  test('a record raises it: --check fails until sync has written the raise, and sync writes it once', () => {
    const root = metricsProject(GROWN, { debtBudget: { maxKnown: 230 } });
    run(root, 'sync');
    todo(root, '2026-10-01_1/01-kits', { 'ai_completed.md': completed('01-kits', DEBT) });
    const manifestBefore = read(root, '.novadev/novadev.json');
    const pageBefore = read(root, '.novadev/wiki/architecture.md');

    // The budget is derived from the records: --check judges it as sync would write it, and fails
    // while sync has not — committed unwritten, the raise would no longer count.
    const check = run(root, 'sync', '--check');
    expect(check.code).toBe(1);
    expect(check.stdout).toContain(
      'debt budget: 2026-10-01_1/01-kits raises it 230 → 238 — not written yet: `novadev sync` writes it to novadev.json',
    );
    expect(check.stdout).toContain('debt budget: known debt 238 of 238 ✓');
    expect(check.stdout).not.toContain('known debt is over the budget');
    expect(check.stdout).toContain('  ✗ wiki/architecture.md: budgets block out of date');
    expect(check.stdout).toContain(
      'sync --check: ✗ 1 stale derived file(s); the raise in 2026-10-01_1/01-kits is not written to novadev.json yet — run `novadev sync`, then commit novadev.json with the record',
    );
    expect(read(root, '.novadev/novadev.json')).toBe(manifestBefore);
    expect(read(root, '.novadev/wiki/architecture.md')).toBe(pageBefore);

    const plain = run(root, 'sync');
    expect(plain.code).toBe(0);
    expect(plain.stdout).toContain('debt budget raised 230 → 238 by 2026-10-01_1/01-kits');
    const budget = readJson(root, '.novadev/novadev.json').debtBudget;
    expect(budget).toEqual({
      maxKnown: 238,
      raises: [{ by: '2026-10-01_1/01-kits', from: 230, to: 238, on: todayStamp() }],
    });
    // Every other setting survives the rewrite; the wiki block shows the new budget.
    expect(readJson(root, '.novadev/novadev.json').metrics).toBe('cat metrics-out.json');
    expect(read(root, '.novadev/wiki/architecture.md')).toContain('**Known debt:** 238 (budget 238)');

    const again = run(root, 'sync');
    expect(again.stdout).not.toContain('raised');
    expect(readJson(root, '.novadev/novadev.json').debtBudget.raises).toHaveLength(1);
    expect(run(root, 'sync', '--check').code).toBe(0);
  });

  test('the hook and CI agree: --check refuses an unwritten raise, and after sync and a commit both pass', () => {
    const root = metricsProject(BASE, { debtBudget: { maxKnown: 230 } });
    run(root, 'sync');
    commitAll(root, 'before the round');
    metricsOutput(root, GROWN);
    todo(root, '2026-10-01_1/01-kits', { 'ai_completed.md': completed('01-kits', DEBT) });

    const hook = run(root, 'sync', '--check');
    expect(hook.code).toBe(1);
    expect(hook.stdout).toContain('the raise in 2026-10-01_1/01-kits is not written to novadev.json yet');

    expect(run(root, 'sync').stdout).toContain('debt budget raised 230 → 238 by 2026-10-01_1/01-kits');
    expect(run(root, 'sync', '--check').code).toBe(0); // the hook, again
    commitAll(root, 'round 1');
    expect(run(root, 'sync', '--check').code).toBe(0); // CI, on the commit

    // The close-out adds the commit to the record afterwards: nothing changes.
    const record = read(root, '.novadev/todos/2026-10-01_1/01-kits/ai_completed.md');
    todo(root, '2026-10-01_1/01-kits', { 'ai_completed.md': record.replace('**Feature:**', '**Commits:** abc1234\n**Feature:**') });
    expect(run(root, 'sync', '--check').code).toBe(0);
    expect(readJson(root, '.novadev/novadev.json').debtBudget.maxKnown).toBe(238);
  });

  test('a raise committed without being written no longer counts, and the NEXT ACTION says so', () => {
    const root = metricsProject(BASE, { debtBudget: { maxKnown: 230 } });
    run(root, 'sync');
    commitAll(root, 'before the round');
    metricsOutput(root, GROWN);
    todo(root, '2026-10-01_1/01-kits', { 'ai_completed.md': completed('01-kits', DEBT) });
    commitAll(root, 'round 1, committed past the hook');
    const result = run(root, 'sync');
    expect(readJson(root, '.novadev/novadev.json').debtBudget.maxKnown).toBe(230);
    expect(actions(result.stdout)).toContain(
      'known debt 238 is over the budget 230 — reduce it, or raise the budget in this round\'s record: add a "## Debt" section with "**Raise:** 230 → 238" and the reason (the raise in 2026-10-01_1/01-kits does not count: it was committed in an earlier round)',
    );
  });

  test('a raise stops at the measured debt: one record cannot switch the gate off', () => {
    const root = metricsProject(GROWN, { debtBudget: { maxKnown: 230 } });
    todo(root, '2026-10-01_1/01-kits', { 'ai_completed.md': completed('01-kits', DEBT.replace('238', '100000')) });
    const result = run(root, 'sync');
    expect(result.stdout).toContain(
      'debt budget raised 230 → 238 by 2026-10-01_1/01-kits (it asks for 100,000, above the measured debt — a raise stops there)',
    );
    expect(readJson(root, '.novadev/novadev.json').debtBudget).toEqual({
      maxKnown: 238,
      raises: [{ by: '2026-10-01_1/01-kits', from: 230, to: 100000, applied: 238, on: todayStamp() }],
    });
    // Later growth needs a raise of its own.
    metricsOutput(root, { ...GROWN, debt: { known: 250 } });
    expect(run(root, 'sync', '--check').stdout).toContain('✗ known debt 250 is over the budget 238');
  });

  test('a raise written against another budget is not applied, and says why', () => {
    const root = metricsProject(GROWN, { debtBudget: { maxKnown: 225 } });
    todo(root, '2026-10-01_1/01-kits', { 'ai_completed.md': completed('01-kits', DEBT) });
    const result = run(root, 'sync');
    expect(result.stdout).toContain(
      'debt budget: 2026-10-01_1/01-kits raises it from 230, but the budget is 225 — not applied; if it is still needed, make it "**Raise:** 225 → <the new budget>"',
    );
    expect(readJson(root, '.novadev/novadev.json').debtBudget).toEqual({ maxKnown: 225 });
    expect(result.stdout).toContain('✗ known debt 238 is over the budget 225');
  });

  test('with git, a raise written before the debt grew waits for the rest of the round, then applies', () => {
    const root = metricsProject(BASE, { debtBudget: { maxKnown: 230 } });
    run(root, 'sync');
    commitAll(root, 'before the round');
    todo(root, '2026-10-01_1/01-kits', { 'ai_completed.md': completed('01-kits', DEBT) });
    const early = run(root, 'sync');
    expect(early.stdout).toContain(
      'debt budget: 2026-10-01_1/01-kits asks for 238, but known debt is within the budget — not needed now; it still counts until it is committed',
    );
    expect(readJson(root, '.novadev/novadev.json').debtBudget).toEqual({ maxKnown: 230 });

    metricsOutput(root, GROWN);
    const later = run(root, 'sync');
    expect(later.stdout).toContain('debt budget raised 230 → 238 by 2026-10-01_1/01-kits');
    expect(readJson(root, '.novadev/novadev.json').debtBudget.maxKnown).toBe(238);

    // The next round grows again: the raise that applied in its own round is not mentioned.
    commitAll(root, 'round 1');
    metricsOutput(root, { ...GROWN, debt: { known: 240, new: 0 } });
    expect(actions(run(root, 'sync').stdout)).toContain(
      'known debt 240 is over the budget 238 — reduce it, or raise the budget in this round\'s record: add a "## Debt" section with "**Raise:** 238 → 240" and the reason',
    );
  });

  test("with git, a raise from an earlier round never lifts a later round's growth", () => {
    const root = metricsProject(BASE, { debtBudget: { maxKnown: 230 } });
    run(root, 'sync');
    commitAll(root, 'before round 1');
    todo(root, '2026-10-01_1/01-kits', {
      'ai_completed.md': completed('01-kits', DEBT.replace('230 → 238', '230 → 100000')),
    });
    run(root, 'sync');
    commitAll(root, 'round 1: the raise was not needed');

    todo(root, '2026-10-01_1/02-next', { 'ai_completed.md': completed('02-next') });
    metricsOutput(root, { ...GROWN, debt: { known: 5000 } });
    const plain = run(root, 'sync');
    expect(plain.stdout).not.toContain('2026-10-01_1/01-kits asks');
    expect(actions(plain.stdout)).toContain(
      'known debt 5,000 is over the budget 230 — reduce it, or raise the budget in this round\'s record: add a "## Debt" section with "**Raise:** 230 → 5000" and the reason (the raise in 2026-10-01_1/01-kits does not count: it was committed in an earlier round)',
    );
    commitAll(root, 'round 2');
    expect(run(root, 'sync', '--check').code).toBe(1);
    expect(readJson(root, '.novadev/novadev.json').debtBudget).toEqual({ maxKnown: 230 });
  });

  test('without git, a raise that is not needed is used up at once — it never applies later', () => {
    const root = metricsProject(BASE, { debtBudget: { maxKnown: 230 } });
    todo(root, '2026-10-01_1/01-kits', { 'ai_completed.md': completed('01-kits', DEBT) });
    const early = run(root, 'sync');
    expect(early.stdout).toContain(
      'debt budget: 2026-10-01_1/01-kits asks for 238, but known debt is within the budget — not needed, so not applied; without git, sync cannot tell one round from the next, so this raise is used up now and it does not count later',
    );
    expect(readJson(root, '.novadev/novadev.json').debtBudget).toEqual({
      maxKnown: 230,
      raises: [{ by: '2026-10-01_1/01-kits', from: 230, to: 238, applied: 230, on: todayStamp() }],
    });

    metricsOutput(root, GROWN);
    const later = run(root, 'sync');
    expect(readJson(root, '.novadev/novadev.json').debtBudget.maxKnown).toBe(230);
    expect(actions(later.stdout)).toContain(
      `known debt 238 is over the budget 230 — 2026-10-01_1/01-kits asked for 230 → 238 on ${todayStamp()}, while known debt was within the budget; without git, sync cannot tell one round from the next, so that raise was used up then: reduce the debt, or raise the budget in another record, with the reason`,
    );
  });

  test('a raise that falls short: the NEXT ACTION says to change its line, and following it settles', () => {
    const root = metricsProject(GROWN, { debtBudget: { maxKnown: 230 } });
    todo(root, '2026-10-01_1/01-kits', { 'ai_completed.md': completed('01-kits', DEBT.replace('230 → 238', '230 → 235')) });
    const short = run(root, 'sync');
    expect(short.stdout).toContain('debt budget raised 230 → 235 by 2026-10-01_1/01-kits');
    expect(actions(short.stdout)).toEqual([
      'known debt 238 is over the budget 235 — reduce it, or change the raise line in 2026-10-01_1/01-kits/ai_completed.md to "**Raise:** 235 → 238" and say why — keep one raise line',
    ]);
    // Do exactly what it says.
    todo(root, '2026-10-01_1/01-kits', { 'ai_completed.md': completed('01-kits', DEBT.replace('230 → 238', '235 → 238')) });
    const fixed = run(root, 'sync');
    expect(fixed.code).toBe(0);
    expect(fixed.stdout).toContain('debt budget raised 235 → 238 by 2026-10-01_1/01-kits');
    expect(fixed.stdout).toContain('sync: clean. ✓');
  });

  test('a raise from another budget, or one sync cannot read: the NEXT ACTION names that line', () => {
    const stale = metricsProject(GROWN, { debtBudget: { maxKnown: 225 } });
    todo(stale, '2026-10-01_1/01-kits', { 'ai_completed.md': completed('01-kits', DEBT) });
    expect(actions(run(stale, 'sync').stdout)).toEqual([
      'known debt 238 is over the budget 225 — reduce it, or change the raise line in 2026-10-01_1/01-kits/ai_completed.md to "**Raise:** 225 → 238" and say why — keep one raise line',
    ]);

    const unreadable = metricsProject(GROWN, { debtBudget: { maxKnown: 230 } });
    todo(unreadable, '2026-10-01_1/01-kits', { 'ai_completed.md': completed('01-kits', DEBT.replace('230 → 238', '230 → 1 238')) });
    const result = run(unreadable, 'sync');
    expect(result.code).toBe(1);
    expect(actions(result.stdout)).toEqual([
      'known debt 238 is over the budget 230 — reduce it, or fix the raise line in 2026-10-01_1/01-kits/ai_completed.md (see PROBLEMS) so it reads "**Raise:** 230 → 238"',
    ]);
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

  test('the raise a record already made is never asked for again — sync says why instead', () => {
    const root = metricsProject(GROWN, { debtBudget: { maxKnown: 230 } });
    todo(root, '2026-10-01_1/01-kits', { 'ai_completed.md': completed('01-kits', DEBT) });
    run(root, 'sync');
    const manifest = readJson(root, '.novadev/novadev.json');
    setManifest(root, { debtBudget: { ...manifest.debtBudget, maxKnown: 230 } });

    const result = run(root, 'sync');
    expect(actions(result.stdout)).toEqual([
      `known debt 238 is over the budget 230 — 2026-10-01_1/01-kits already raised it 230 → 238 on ${todayStamp()}, and the budget was lowered after that, so that raise does not count again: reduce the debt, or raise the budget in another record, with the reason`,
    ]);
  });

  test('a raise edited to new numbers is a new request, and counts', () => {
    const root = metricsProject(GROWN, { debtBudget: { maxKnown: 230 } });
    todo(root, '2026-10-01_1/01-kits', { 'ai_completed.md': completed('01-kits', DEBT) });
    run(root, 'sync');
    const manifest = readJson(root, '.novadev/novadev.json');
    setManifest(root, { debtBudget: { ...manifest.debtBudget, maxKnown: 232 } });
    todo(root, '2026-10-01_1/01-kits', {
      'ai_completed.md': completed('01-kits', '\n## Debt\n**Raise:** 232 → 238\nStill needed: the registry is not split yet.\n'),
    });
    const result = run(root, 'sync');
    expect(result.stdout).toContain('debt budget raised 232 → 238 by 2026-10-01_1/01-kits');
    expect(readJson(root, '.novadev/novadev.json').debtBudget.raises).toHaveLength(2);
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

  test('a budget the metrics cannot check is a NEXT ACTION for sync, and a failure for --check', () => {
    const root = metricsProject({ hubs: [] }, { debtBudget: { maxKnown: 1 } });
    const plain = run(root, 'sync');
    expect(plain.code).toBe(0);
    expect(plain.stdout).toContain('debt budget: not checked — the metrics have no "debt" count');
    expect(actions(plain.stdout)).toEqual([
      'the debt budget cannot be checked: the metrics have no "debt" count — make the metrics command print "debt", or set "debtBudget" to null in novadev.json',
    ]);
    const check = run(root, 'sync', '--check');
    expect(check.code).toBe(1);
    expect(check.stdout).toContain('sync --check: ✗ the debt budget cannot be checked');

    // Nothing measured at all: no command and no snapshot, or a command that fails before any
    // snapshot is stored.
    const none = project({ debtBudget: { maxKnown: 1 } });
    const off = run(none, 'sync');
    expect(actions(off.stdout)).toEqual([
      'the debt budget cannot be checked: no "metrics" command is set, and no snapshot is stored — set a "metrics" command that prints "debt", or set "debtBudget" to null in novadev.json',
    ]);
    expect(run(none, 'sync', '--check').code).toBe(1);
    setManifest(none, { metrics: 'exit 3' });
    expect(actions(run(none, 'sync').stdout)).toEqual([
      'the debt budget cannot be checked: the metrics command gave no numbers, and no snapshot is stored — make the metrics command work, or set "debtBudget" to null in novadev.json',
    ]);

    // Turned off, there is nothing to check.
    setManifest(root, { debtBudget: null });
    expect(run(root, 'sync', '--check').code).toBe(0);
  });
});
