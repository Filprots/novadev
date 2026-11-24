// Testing is a tester agent's job (batch 2026-11-24_3, todo 01): an open round waits on a TESTER — an
// agent that did not build the work (/novadev-test) — never on the builder's NEXT ACTIONS, and on the
// human only for what the tester escalated (`novadev test-result escalate`, test-results/needs-human.md).
import { describe, expect, test } from 'bun:test';
import { SKILLS } from '../src/lib.ts';
import { completed, exists, feature, project, read, run, todo, write } from './helpers.ts';

const TASK = 'FEAT-0001-planner';
const TESTER = 'claude-code/claude-opus-5-5';
const REF = '2026-11-24_1/01-a';

function scenario(n: number): string {
  return `## Scenario ${n} — Step ${n}\n\n**Priority:** normal\n**Steps:**\n1. Do ${n}.\n\n**Expect (pass):** ${n} works.\n**Watch for (fail):** ${n} breaks.\n`;
}

/** FEAT-0001, todo 01-a completed and gated on a 3-scenario round nobody has run yet. */
function round(): string {
  const root = project();
  feature(root, 'FEAT-0001', 'planner', { status: 'in-progress' });
  todo(root, REF, {
    'ai_completed.md': completed('01-a').replace('**Feature:** none — test fixture', '**Feature:** FEAT-0001'),
    'ai_needstest.md': `# ai_needstest — 01-a\n\n**Date:** 2026-11-24\n**Test:** ${TASK}\n**Feature:** FEAT-0001\n**Built by:** ${TESTER}\n\n## Why a tester is needed\nThe screen.\n`,
  });
  write(root, `.novadev/totest/${TASK}/test-plan.md`, `---\nid: ${TASK}\ncreated: 2026-11-24\nupdated: 2026-11-24\nstatus: awaiting-test\nrevision: 2\nlast-tested:\ntodos: ${REF}\nfeature: FEAT-0001\nscope: the planner\n---\n\n# Test plan — ${TASK}\n\n## Revisions\n\n- 2026-11-24 (rev 2) — second round.\n\n${[1, 2, 3].map(scenario).join('\n')}\n## Out of scope\n\nNothing.\n`);
  write(root, `.novadev/totest/${TASK}/test-results/README.md`, 'guide\n');
  return root;
}

function cli(root: string, command: string, payload: Record<string, unknown>): { code: number; json: Record<string, any> } {
  write(root, `${command}.json`, JSON.stringify(payload));
  const out = run(root, 'test-result', command, `${command}.json`);
  return { code: out.code, json: JSON.parse(out.stdout) };
}

function section(stdout: string, heading: string): string {
  const at = stdout.indexOf(heading);
  if (at === -1) return '';
  return stdout.slice(at).split('\n\n')[0]!;
}

describe('an open round waits on a tester, not on the builder or the human', () => {
  test('nobody has run it: sync lists it under WAITING ON A TESTER — not a NEXT ACTION, not the human\'s', () => {
    const root = round();
    const sync = run(root, 'sync');
    expect(sync.code).toBe(0);
    expect(section(sync.stdout, 'WAITING ON A TESTER')).toContain(`◎ totest/${TASK} — 3 scenario(s) to test for ${REF}`);
    expect(sync.stdout).toContain('runs `/novadev-test`');
    expect(sync.stdout).not.toContain('WAITING ON THE HUMAN');
    expect(sync.stdout).not.toContain('NEXT ACTIONS');
    expect(sync.stdout).toContain("sync: clean — everything left is a tester's to do.");

    const totest = run(root, 'totest').stdout;
    expect(totest).toContain('1 open round(s): 1 for a tester, 0 ask(s) waiting on a person');
    expect(totest).toContain(`○ ${TASK}  — for a tester: 3 scenario(s) to test`);
    expect(run(root, 'status').stdout).toContain('1 open round(s): 1 for a tester, 0 ask(s) waiting on YOU');
  });

  test('the tester records each result with who tested; once all are in, the round is the tester\'s to close', () => {
    const root = round();
    const one = cli(root, 'write', { taskId: TASK, scenario: 1, text: 'pass — the driver saw the plan.', by: TESTER });
    expect(one.code).toBe(0);
    expect(read(root, `.novadev/totest/${TASK}/test-results/scenario-1.txt`)).toBe(`## Scenario 1\n\npass — the driver saw the plan.\n\n**Tested by:** ${TESTER}\n`);
    expect(section(run(root, 'sync').stdout, 'WAITING ON A TESTER')).toContain('2 scenario(s) to test');

    for (const n of [2, 3]) expect(cli(root, 'write', { taskId: TASK, scenario: n, text: n === 3 ? 'fail — it broke.' : 'pass', by: TESTER }).code).toBe(0);
    const sync = run(root, 'sync').stdout;
    expect(section(sync, 'WAITING ON A TESTER')).toContain(`totest/${TASK} — every scenario has a result for ${REF}: review the round, close the gate, file follow-ups`);
    expect(sync).not.toContain('REVIEW totest/');
    const data = JSON.parse(run(root, 'totest', '--json').stdout).tasks[0];
    expect(data).toMatchObject({ id: TASK, tester: 'close', readyForReview: true, untested: [], needsHuman: [] });
  });

  test('a review names who tested; a malformed actor is refused', () => {
    const root = round();
    const review = cli(root, 'review', { taskId: TASK, verdict: 'passed', summary: 'All three ran.', by: 'human:filipp' });
    expect(review.code).toBe(0);
    expect(read(root, `.novadev/totest/${TASK}/test-results/review.md`)).toContain('**Verdict:** passed\n**Tested by:** human:filipp\n');
    const bad = cli(root, 'write', { taskId: TASK, scenario: 1, text: 'pass', by: 'the tester' });
    expect(bad.code).toBe(1);
    expect(bad.json.error).toContain("'by' must be an actor");
  });
});

describe('novadev test-result escalate — the only testing that waits on the human', () => {
  test('writes the ask to needs-human.md; sync lists it for the human and the rest for the tester', () => {
    const root = round();
    const out = cli(root, 'escalate', { taskId: TASK, scenarios: [2], by: TESTER, ask: 'Plug the tablet in over USB and accept the debug prompt once.\nThen say done.', tried: 'The emulator does not reproduce the pen input.' });
    expect(out.code).toBe(0);
    expect(out.json).toMatchObject({ taskId: TASK, escalated: [2], written: `${TASK}/test-results/needs-human.md` });
    const file = read(root, `.novadev/totest/${TASK}/test-results/needs-human.md`);
    expect(file).toContain(`**By:** ${TESTER}\n**Scenarios:** 2\n- Scenario 2 — Step 2\n\n### Ask\n\nPlug the tablet in over USB`);
    expect(file).toContain('### Tried\n\nThe emulator does not reproduce the pen input.');

    const sync = run(root, 'sync').stdout;
    expect(section(sync, 'WAITING ON THE HUMAN')).toContain(`⧗ totest/${TASK} scenario 2 — the tester (${TESTER}) cannot run it itself and asks you: Plug the tablet in over USB and accept the debug prompt once. — \`/novadev-what-to-test\``);
    expect(section(sync, 'WAITING ON A TESTER')).toContain(`totest/${TASK} — 2 scenario(s) to test for ${REF}; scenario 2 escalated to the human`);
    // An ask is not a result: the round is not ready for review.
    const data = JSON.parse(run(root, 'totest', '--json').stdout).tasks[0];
    expect(data).toMatchObject({ results: [], readyForReview: false, tester: 'test', untested: [1, 3], needsHuman: [{ scenarios: [2], by: TESTER }] });
    const tasks = JSON.parse(run(root, 'test-result', 'tasks').stdout).tasks[0];
    expect(tasks.needsHuman[0].ask).toBe('Plug the tablet in over USB and accept the debug prompt once.\nThen say done.');
  });

  test('when only the escalated scenario is left the round waits on the human alone; its result ends the ask', () => {
    const root = round();
    cli(root, 'escalate', { taskId: TASK, scenarios: [2], by: TESTER, ask: 'Walk it on the iPhone.', tried: 'No simulator here.' });
    for (const n of [1, 3]) cli(root, 'write', { taskId: TASK, scenario: n, text: 'pass', by: TESTER });
    let sync = run(root, 'sync').stdout;
    expect(sync).not.toContain('WAITING ON A TESTER');
    expect(sync).toContain('WAITING ON THE HUMAN (1)');
    expect(run(root, 'totest').stdout).toContain(`⧗ ${TASK}  — waiting on a person (escalated)`);

    expect(cli(root, 'write', { taskId: TASK, scenario: 2, text: 'pass — opened logged in.', by: 'human:filipp' }).code).toBe(0);
    sync = run(root, 'sync').stdout;
    expect(sync).not.toContain('WAITING ON THE HUMAN');
    expect(section(sync, 'WAITING ON A TESTER')).toContain('every scenario has a result');
  });

  test('the owner skipping the escalated scenario ends the ask too', () => {
    const root = round();
    cli(root, 'escalate', { taskId: TASK, scenarios: [3], by: TESTER, ask: 'Pay with a real card.', tried: 'The sandbox has no 3-D Secure.' });
    expect(cli(root, 'skip', { taskId: TASK, scenarios: [3], by: 'human:filipp', reason: 'Not worth a real payment.' }).code).toBe(0);
    expect(run(root, 'sync').stdout).not.toContain('WAITING ON THE HUMAN');
  });

  test('refuses a person as `by`, a scenario that already has a result, and one the plan does not have', () => {
    const root = round();
    cli(root, 'write', { taskId: TASK, scenario: 1, text: 'fail — could not reach it', by: TESTER });
    const human = cli(root, 'escalate', { taskId: TASK, scenarios: [2], by: 'human:filipp', ask: 'x', tried: 'y' });
    expect(human.code).toBe(1);
    expect(human.json.error).toContain('an agent, never a person');
    const done = cli(root, 'escalate', { taskId: TASK, scenarios: [1], by: TESTER, ask: 'x', tried: 'y' });
    expect(done.json.error).toContain('Scenario 1 (fail) already has a result');
    const unknown = cli(root, 'escalate', { taskId: TASK, scenarios: [9], by: TESTER, ask: 'x', tried: 'y' });
    expect(unknown.json.error).toContain('The plan has no scenario 9 (it has 1, 2, 3)');
    const noTried = cli(root, 'escalate', { taskId: TASK, scenarios: [2], by: TESTER, ask: 'x' });
    expect(noTried.json.error).toContain("needs a 'tried'");
    expect(exists(root, `.novadev/totest/${TASK}/test-results/needs-human.md`)).toBe(false);
  });
});

describe('the tester takes the gated todo\'s lock, and ships its own playbook', () => {
  test('`novadev work start` takes the lock of a todo gated on testing', () => {
    const root = round();
    const started = run(root, 'work', 'start', REF, '--agent', 'claude-code/claude-sonnet-5-5');
    expect(started.code).toBe(0);
    expect(JSON.parse(started.stdout)).toMatchObject({ ref: REF, taken: true });
  });

  test('novadev-test is a deployed skill', () => {
    expect(SKILLS.map((s) => s.slug)).toContain('novadev-test');
    const root = project();
    expect(run(root, 'deploy').code).toBe(0);
    expect(read(root, '.novadev/skills/novadev-test.md')).toContain('# novadev-test — be the tester of a round somebody else built');
    expect(read(root, '.claude/skills/novadev-test/SKILL.md')).toContain('name: novadev-test');
    expect(read(root, 'CLAUDE.md')).toContain('**Testing is an agent\'s job, not the human\'s.**');
    expect(read(root, '.novadev/totest/README.md')).toContain('**A TESTER runs the round, not you.**');
  });
});
