// `novadev test-result skip` (batch 2026-11-12_1, todo 02): the owner skips scenarios, or the rest of
// a round — recorded as skipped with who and why, real verdicts kept, the round closed and archived
// like a review, the gated todos marked NOT human-tested (ai_testskipped.md, never ai_confirmed.md).
import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { commitAll, completed, feature, git, project, read, run, todo, write } from './helpers.ts';

const TASK = 'FEAT-0001-planner';
const OWNER = 'human:filipp';

function scenario(n: number): string {
  return `## Scenario ${n} — Step ${n}\n\n**Priority:** normal\n**Steps:**\n1. Do ${n}.\n\n**Expect (pass):** ${n} works.\n**Watch for (fail):** ${n} breaks.\n`;
}

/** A project on main: FEAT-0001, todo 2026-11-12_1/01-a completed and gated on a 4-scenario round; scenario 1 passed. */
function round(): string {
  const root = project();
  feature(root, 'FEAT-0001', 'planner');
  todo(root, '2026-11-12_1/01-a', {
    'ai_completed.md': completed('01-a').replace('**Feature:** none — test fixture', '**Feature:** FEAT-0001'),
    'ai_needstest.md': `# ai_needstest — 01-a\n\n**Date:** 2026-11-12\n**Test:** ${TASK}\n**Feature:** FEAT-0001\n\n## Why a human is needed\nThe screen.\n`,
  });
  write(root, `.novadev/totest/${TASK}/test-plan.md`, `---\nid: ${TASK}\ncreated: 2026-11-01\nupdated: 2026-11-01\nstatus: awaiting-test\nrevision: 3\nlast-tested:\ntodos: 2026-11-12_1/01-a\nfeature: FEAT-0001\nscope: the planner\n---\n\n# Test plan — ${TASK}\n\n## Revisions\n\n- 2026-11-01 (rev 3) — third round.\n\n${[1, 2, 3, 4].map(scenario).join('\n')}\n## Out of scope\n\nNothing.\n`);
  write(root, `.novadev/totest/${TASK}/test-results/README.md`, 'guide\n');
  write(root, 'r1.json', JSON.stringify({ taskId: TASK, scenario: 1, text: 'pass — it worked' }));
  expect(run(root, 'test-result', 'write', 'r1.json').code).toBe(0);
  git(root, 'init', '-q', '-b', 'main');
  commitAll(root);
  return root;
}

function skip(root: string, payload: Record<string, unknown>): { code: number; json: Record<string, any> } {
  write(root, 'skip.json', JSON.stringify(payload));
  const out = run(root, 'test-result', 'skip', 'skip.json');
  return { code: out.code, json: JSON.parse(out.stdout) };
}

describe('novadev test-result skip', () => {
  test('"rest" skips every scenario without a result, keeps the real verdict, closes the round and marks the todo not human-tested', () => {
    const root = round();
    const out = skip(root, { taskId: TASK, scenarios: 'rest', by: OWNER, reason: 'Board on IRR-184: close the round, the result is not important.' });
    expect(out.code).toBe(0);
    expect(out.json).toMatchObject({ skippedNow: [2, 3, 4], skipped: [2, 3, 4], recorded: [{ scenario: 1, verdict: 'pass' }], closed: true, verdict: 'partly-skipped', todos: [{ todo: '2026-11-12_1/01-a', record: 'ai_testskipped.md' }] });

    const skipped = read(root, `.novadev/totest/${TASK}/test-results/skipped.md`);
    expect(skipped).toContain(`**By:** ${OWNER}`);
    expect(skipped).toContain('**Reason:** Board on IRR-184: close the round, the result is not important.');
    expect(skipped).toContain('- Scenario 3 — Step 3 — **Verdict:** skipped');
    expect(skipped).not.toContain('- Scenario 1 ');
    const plan = read(root, `.novadev/totest/${TASK}/test-plan.md`);
    expect(plan).toContain('status: reviewed');
    expect(plan).toContain('verdict: partly-skipped');
    expect(plan).toContain('skipped: 3');
    expect(plan).toContain(`skipped-by: ${OWNER}`);
    expect(plan).toMatch(/- 2026-11-01 \(rev 3\) — third round\.\n- \d{4}-\d{2}-\d{2} \(rev 3\) — closed without a full human test: 3 of 4 scenario\(s\) skipped by human:filipp; tested by a person: 1 pass\. Reason: Board on IRR-184/);

    const dir = join(root, '.novadev/todos/2026-11-12_1/01-a');
    expect(existsSync(join(dir, 'ai_needstest.md'))).toBe(false);
    expect(existsSync(join(dir, 'ai_confirmed.md'))).toBe(false);
    const record = read(dir, 'ai_testskipped.md');
    expect(record).toContain(`**Test:** ${TASK}`);
    expect(record).toContain('NOT tested by a human.');
    expect(record).toContain('- skipped: 2, 3, 4');
    expect(record).toContain('- tested by a person before the skip: 1 pass');
    expect(JSON.parse(run(root, 'todo', 'list', '--json').stdout).todos[0].state).toBe('completed');
    expect(run(root, 'totest').stdout).toContain(`✓ ${TASK}  — CLOSED (partly-skipped, 3 scenario(s) skipped by the owner), waiting for \`novadev sync\` to archive it`);

    // sync archives it like a reviewed round, and the feature's tests.md says who skipped what.
    expect(run(root, 'sync').code).toBe(0);
    expect(existsSync(join(root, '.novadev/totest', TASK))).toBe(false);
    const tests = read(root, '.novadev/knowledge/features/FEAT-0001-planner/tests.md');
    expect(tests).toMatch(new RegExp(`- \`archive/\\d{4}/totest/${TASK}/rev3-\\d{4}-\\d{2}-\\d{2}\` — partly-skipped · `));
    expect(tests).toContain(`  - skipped by the owner (${OWNER}): 3 scenario(s) not tested by a human — see test-results/skipped.md`);
    // The gate is closed cleanly: no record pair doctor objects to, no dangling test link.
    expect(run(root, 'doctor').stdout).not.toContain('2026-11-12_1/01-a');
    expect(run(root, 'links').stdout).not.toContain('2026-11-12_1/01-a');
  });

  test('named scenarios: a real verdict is never skipped, an unknown number or an agent as "by" is refused, and the round stays open until nothing is left', () => {
    const root = round();
    expect(skip(root, { taskId: TASK, scenarios: [1, 2], by: OWNER, reason: 'x' }).json.error).toBe('Scenario 1 (pass) already has a verdict a person recorded — a real result is kept, never skipped. Leave it out.');
    expect(skip(root, { taskId: TASK, scenarios: [9], by: OWNER, reason: 'x' }).json.error).toBe('The plan has no scenario 9 (it has 1, 2, 3, 4).');
    expect(skip(root, { taskId: TASK, scenarios: [2], by: 'claude-code/claude-opus-5-5', reason: 'x' }).json.error).toContain('Skipping a human test is the owner\'s call, never an agent\'s.');
    expect(skip(root, { taskId: TASK, scenarios: [2], by: OWNER }).json.error).toBe("The payload needs a 'reason'.");

    const part = skip(root, { taskId: TASK, scenarios: [2, 3], by: OWNER, reason: 'Not important.' });
    expect(part.json).toMatchObject({ skippedNow: [2, 3], closed: false, open: [4] });
    expect(existsSync(join(root, '.novadev/todos/2026-11-12_1/01-a/ai_needstest.md'))).toBe(true);
    expect(read(root, `.novadev/totest/${TASK}/test-plan.md`)).toContain('status: awaiting-test');

    write(root, 'r4.json', JSON.stringify({ taskId: TASK, scenario: 4, text: 'fail — the button did nothing' }));
    run(root, 'test-result', 'write', 'r4.json');
    const rest = skip(root, { taskId: TASK, scenarios: 'rest', by: OWNER, reason: 'Nothing left.' });
    expect(rest.json).toMatchObject({ skippedNow: [], skipped: [2, 3], closed: true, verdict: 'partly-skipped' });
    expect(rest.json.next[0]).toContain('review the recorded result(s) 4 (fail) and file follow-up todos');
    expect(skip(root, { taskId: TASK, scenarios: 'rest', by: OWNER, reason: 'again' }).json.error).toContain('is closed already (status: reviewed)');
  });

  test('a round nobody walked is closed as "skipped"', () => {
    const root = round();
    git(root, 'rm', '-q', `.novadev/totest/${TASK}/test-results/scenario-1.txt`);
    const out = skip(root, { taskId: TASK, by: OWNER, reason: 'The owner tested it by using it.' });
    expect(out.json).toMatchObject({ skipped: [1, 2, 3, 4], recorded: [], closed: true, verdict: 'skipped' });
  });
});
