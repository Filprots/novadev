// Who an open test round waits on. A TESTER — an agent that did not build the work — runs the plan,
// builds the tools it needs, records the results and closes the round (/novadev-test). A PERSON is
// waited on only for the asks the tester escalated (`novadev test-result escalate`). `novadev sync`,
// `novadev status` and `novadev totest` all read this, so the three never disagree.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TEST_RESULTS_DIR, type TestTask, listTestTasks } from './lib.ts';
import { type Escalation, escalations, readSkipped, recordedVerdicts, scenariosIn } from './test-results.ts';

export type RoundState = {
  readonly task: TestTask;
  /** The asks with scenarios still open: the human's part. */
  readonly asks: readonly Escalation[];
  /** Scenarios with no result, not skipped and not escalated: the tester's to run. */
  readonly untested: readonly number[];
  /**
   * What the tester has to do now: `test` (scenarios to run), `close` (every scenario has a result or
   * is skipped — review and close the round), or null (only the human's asks are left, or it is closed).
   */
  readonly tester: 'test' | 'close' | null;
};

export function roundState(task: TestTask): RoundState {
  const resultsDir = join(task.dir, TEST_RESULTS_DIR);
  const plan = existsSync(task.planPath) ? scenariosIn(readFileSync(task.planPath, 'utf8')) : [];
  const verdicts = recordedVerdicts(resultsDir);
  const skipped = readSkipped(resultsDir);
  const asks = escalations(resultsDir).filter((e) => e.open.length > 0);
  const escalated = new Set(asks.flatMap((e) => e.open));
  const untested = plan.map((s) => s.scenario).filter((n) => !verdicts.has(n) && !skipped.has(n) && !escalated.has(n));
  if (task.status === 'reviewed') return { task, asks: [], untested: [], tester: null };
  // A plan the reader cannot split into scenarios: results decide, as before.
  const tester = plan.length === 0 ? (task.hasResults ? 'close' : 'test') : untested.length > 0 ? 'test' : asks.length > 0 ? null : 'close';
  return { task, asks, untested, tester };
}

export function testQueue(nd: string): RoundState[] {
  return listTestTasks(nd).map(roundState);
}

/** One line per open ask, for WAITING ON THE HUMAN. */
export function askLines(state: RoundState): string[] {
  return state.asks.map((e) => {
    const first = e.ask.split('\n').map((l) => l.trim()).find((l) => l !== '') ?? '(no ask written)';
    return `totest/${state.task.id} scenario ${e.open.join(', ')} — the tester${e.by ? ` (${e.by})` : ''} cannot run ${e.open.length === 1 ? 'it' : 'them'} itself and asks you: ${first} — \`/novadev-what-to-test\` walks it with you (test-results/needs-human.md)`;
  });
}

/** The line for WAITING ON A TESTER, or null when the round waits on nobody but the human. */
export function testerLine(state: RoundState): string | null {
  const t = state.task;
  const gated = t.todoRefs.length ? ` for ${t.todoRefs.join(', ')}` : '';
  if (state.tester === 'test') {
    const n = state.untested.length || t.scenarios;
    const asked = state.asks.length > 0 ? `; scenario ${state.asks.flatMap((a) => a.open).join(', ')} escalated to the human` : '';
    return `totest/${t.id} — ${n} scenario(s) to test${gated}${asked}`;
  }
  if (state.tester === 'close') return `totest/${t.id} — every scenario has a result${gated}: review the round, close the gate, file follow-ups`;
  return null;
}

/** One open test round as data: who it waits on (`tester`: test | close | null) and the human's open asks. */
export function roundJson(r: RoundState): Record<string, unknown> {
  const t = r.task;
  return {
    id: t.id, features: t.featureIds, scenarios: t.scenarios, revision: t.revision || 1, lastTested: t.lastTested || null,
    readyForReview: r.tester === 'close', results: t.results, todos: t.todoRefs,
    tester: r.tester, untested: r.untested, needsHuman: r.asks.map((a) => ({ scenarios: a.open, ask: a.ask, by: a.by, date: a.date })),
  };
}
