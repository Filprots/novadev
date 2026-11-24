// `novadev test-result write`: one scenario's verdict into test-results/scenario-<N>.txt — for any scenario
// number a plan has (todo 2026-11-24_1/02: a plan with scenarios 460–465 could not be recorded; the
// command stopped at 99), and read back by everything that reads the round.
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { recordedVerdicts } from '../src/test-results.ts';
import { feature, project, read, run, write } from './helpers.ts';

const TASK = 'FEAT-0001-planner';

function scenario(n: number): string {
  return `## Scenario ${n} — Step ${n}\n\n**Priority:** normal\n**Steps:**\n1. Do ${n}.\n\n**Expect (pass):** ${n} works.\n**Watch for (fail):** ${n} breaks.\n`;
}

/** A test task whose plan numbers its scenarios 99, 100, 460 and 465. */
function task(): string {
  const root = project();
  feature(root, 'FEAT-0001', 'planner');
  write(root, `.novadev/totest/${TASK}/test-plan.md`, `---\nid: ${TASK}\ncreated: 2026-11-01\nupdated: 2026-11-01\nstatus: awaiting-test\nrevision: 1\nlast-tested:\ntodos:\nfeature: FEAT-0001\nscope: the planner\n---\n\n# Test plan\n\n${[99, 100, 460, 465].map(scenario).join('\n')}`);
  return root;
}

function record(root: string, value: Record<string, unknown>): { code: number; json: Record<string, any> } {
  write(root, 'r.json', JSON.stringify({ taskId: TASK, ...value }));
  const out = run(root, 'test-result', 'write', 'r.json');
  return { code: out.code, json: JSON.parse(out.stdout) };
}

describe('novadev test-result write', () => {
  test('records a scenario numbered above 99, and the round reads it back', () => {
    const root = task();
    for (const n of [99, 100, 460, 465]) {
      const out = record(root, { scenario: n, title: `Step ${n}`, text: 'pass — it worked' });
      expect([n, out.code, out.json.written]).toEqual([n, 0, `${TASK}/test-results/scenario-${n}.txt`]);
    }
    expect(read(root, `.novadev/totest/${TASK}/test-results/scenario-460.txt`)).toBe('## Scenario 460 — Step 460\n\npass — it worked\n');
    expect([...recordedVerdicts(join(root, `.novadev/totest/${TASK}/test-results`))]).toEqual([[100, 'pass'], [460, 'pass'], [465, 'pass'], [99, 'pass']]);
    // a second walk of the same scenario is appended, as for any other number
    expect(record(root, { scenario: 460, text: 'fail — the second time it broke' }).code).toBe(0);
    expect(read(root, `.novadev/totest/${TASK}/test-results/scenario-460.txt`)).toBe('## Scenario 460 — Step 460\n\npass — it worked\n\nfail — the second time it broke\n');
    // … and a skip sees them as tested: a real result above 99 is kept, never skipped
    write(root, 'skip.json', JSON.stringify({ taskId: TASK, scenarios: [465], by: 'human:filipp', reason: 'Close the round.' }));
    expect(JSON.parse(run(root, 'test-result', 'skip', 'skip.json').stdout).error).toBe('Scenario 465 (pass) already has a verdict a person recorded — a real result is kept, never skipped. Leave it out.');
  });

  test('a number that is no scenario number is still refused', () => {
    const root = task();
    for (const bad of [0, -3, 4.5, 'two', 1e21]) {
      const out = record(root, { scenario: bad, text: 'pass' });
      expect(out.code).toBe(1);
      expect(out.json.error).toBe(`Scenario number must be a whole number from 1 up, got '${Number(bad)}'.`);
    }
  });
});
