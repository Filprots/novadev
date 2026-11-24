// `novadev totest` — the testing queue. A TESTER — an agent that did not build the work — walks
// it (/novadev-test): builds the tools it needs, runs every scenario, records the results and
// closes the round. A person is waited on only for the scenarios the tester escalated.
//
// One LIVING task per feature: `--new` refuses to create a second folder for a feature
// that already has one, and `--round` opens a fresh testing round on the existing task,
// reviving the plan from the newest archived round. The plan itself is revised by the
// builder — stale scenarios rewritten or dropped — never accumulated.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type RoundState, askLines, roundJson, roundState } from './test-queue.ts';
import {
  TEST_PLAN_FILE,
  TEST_RESULTS_DIR,
  TEST_TASK_RE,
  type TestRound,
  fail,
  featureIdsIn,
  listFeatures,
  listTestRounds,
  listTestTasks,
  novadevDir,
  requireProjectRoot,
  setFrontmatter,
  todayStamp,
  totestDir,
} from './lib.ts';

export function totest(args: string[]): void {
  const root = requireProjectRoot();
  const nd = novadevDir(root);

  const opts = parseArgs(args);
  if (opts.new) return scaffold(nd, opts);
  if (opts.round) return newRound(nd, opts.round);

  const tasks = listTestTasks(nd);
  const rounds = listTestRounds(nd);
  if (opts.json) {
    // The queue as data (a chat bot answering "what is waiting for me to test?"); the plan's scenarios: `test-result tasks`.
    console.log(JSON.stringify({
      tasks: tasks.map((t) => ({ ...roundJson(roundState(t)), status: t.status, scope: (t.fm['scope'] ?? '').trim() })),
      ...(opts.all ? { rounds: rounds.map((r) => ({ task: r.taskId, round: r.round, verdict: r.verdict || null, year: r.year })) } : {}),
    }, null, 2));
    return;
  }
  if (tasks.length === 0) {
    console.log('totest — no open test round. ✓');
    if (opts.all && rounds.length > 0) printRounds(rounds);
    else if (rounds.length > 0) {
      console.log(`  (${rounds.length} completed round(s) in the archive — \`novadev totest --all\``);
    }
    return;
  }

  // A round closed (reviewed, or skipped by the owner) waits only for `novadev sync` to archive it.
  const states = tasks.map(roundState);
  const closed = tasks.filter((t) => t.status === 'reviewed');
  const forTester = states.filter((r) => r.tester !== null);
  const asks = states.flatMap(askLines);
  console.log(`totest — ${tasks.length - closed.length} open round(s): ${forTester.length} for a tester, ${asks.length} ask(s) waiting on a person`);
  for (const r of states) print(r);
  if (opts.all && rounds.length > 0) printRounds(rounds);

  if (forTester.length > 0) {
    console.log(
      `\n${forTester.length} round(s) wait on a TESTER: an agent that did not build the work runs` +
        '\n`/novadev-test` — it builds the tools it needs, runs every scenario, records the results' +
        '\nand closes the round (ai_confirmed.md, or follow-up todos for the failures).',
    );
  }
  if (asks.length > 0) {
    console.log(
      `\n${asks.length} ask(s) need a PERSON — scenarios the tester could not run itself:` +
        `\n${asks.map((a) => `  ⧗ ${a}`).join('\n')}` +
        '\n`/novadev-what-to-test` walks one with them and records what they found.',
    );
  }
  if (closed.length > 0) console.log(`\n${closed.length} round(s) are closed — \`novadev sync\` archives them.`);
}

function print(r: RoundState): void {
  const t = r.task;
  if (t.status === 'reviewed') {
    const skipped = Number(t.fm.skipped ?? '') || 0;
    console.log(`  ✓ ${t.id}  — CLOSED (${(t.fm.verdict ?? '').trim() || 'reviewed'}${skipped > 0 ? `, ${skipped} scenario(s) skipped by the owner` : ''}), waiting for \`novadev sync\` to archive it`);
    return;
  }
  const state =
    r.tester === 'test' ? `for a tester: ${r.untested.length || t.scenarios} scenario(s) to test`
      : r.tester === 'close' ? 'for a tester: every scenario has a result — review and close'
        : 'waiting on a person (escalated)';
  console.log(`  ${r.tester === 'close' ? '◆' : r.tester === null ? '⧗' : '○'} ${t.id}  — ${state}`);
  const meta = [
    `${t.scenarios} scenario(s)`,
    `rev ${t.revision || 1}`,
    t.lastTested ? `last tested ${t.lastTested}` : 'never tested',
  ].filter(Boolean);
  console.log(`      ${meta.join(' · ')}`);
  if (t.todoRefs.length) console.log(`      todos: ${t.todoRefs.join(', ')}`);
  for (const a of r.asks) console.log(`      needs a person: scenario ${a.open.join(', ')} (test-results/needs-human.md)`);
  if (t.hasResults) console.log(`      results: ${t.results.join(', ')}`);
  if (!existsSync(t.planPath)) console.log(`      ✗ missing ${TEST_PLAN_FILE}`);
  if (t.legacyRounds.length) {
    console.log(`      ⚠ ${t.legacyRounds.length} pre-0.6.0 history/ round(s) — run \`novadev migrate-repo\``);
  }
}

function printRounds(rounds: TestRound[]): void {
  console.log(`\ncompleted rounds — ${rounds.length} in the archive`);
  for (const r of rounds) {
    console.log(`  ✓ ${r.taskId} ${r.round}  — ${r.verdict || 'verdict not recorded'}`);
    console.log(`      archive/${r.year}/totest/${r.taskId}/${r.round}`);
  }
}

type Options = {
  new?: string;
  round?: string;
  all?: boolean;
  json?: boolean;
  todos?: string;
  feature?: string;
  scope?: string;
};

function parseArgs(args: string[]): Options {
  const opts: Options = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const value = () => {
      const v = args[++i];
      if (v === undefined) fail(`${a} needs a value`);
      return v;
    };
    switch (a) {
      case '--new':
        opts.new = value();
        break;
      case '--round':
        opts.round = value();
        break;
      case '--all':
        opts.all = true;
        break;
      case '--json':
        opts.json = true;
        break;
      case '--todo':
      case '--todos':
        opts.todos = value();
        break;
      case '--feature':
        opts.feature = value();
        break;
      case '--scope':
        opts.scope = value();
        break;
      default:
        fail(
          `unknown option "${a}"\n` +
            'usage: novadev totest [--all]\n' +
            '       novadev totest --new <FEAT-NNNN | slug> [--todos <ref,…>] [--scope "…"]\n' +
            '       novadev totest --round <task-id>',
        );
    }
  }
  return opts;
}

/**
 * Accepts a bare feature id (`FEAT-0007` → resolved to that feature's task name), a full
 * task folder name (`FEAT-0007-magic-link`), or a plain slug for featureless work.
 */
function resolveTaskName(nd: string, input: string, featureOpt?: string): { id: string; feature: string } {
  const wanted = input.match(/^FEAT-\d{4}$/)?.[0] ?? featureOpt?.match(/^FEAT-\d{4}$/)?.[0] ?? '';
  if (input.match(/^FEAT-\d{4}$/) && wanted) {
    const feature = listFeatures(nd).find((f) => f.id === wanted);
    if (!feature) fail(`${wanted} is not in features/ — register the feature first`);
    return { id: feature!.file.replace(/\.md$/, ''), feature: wanted };
  }
  if (!TEST_TASK_RE.test(input)) {
    fail(`"${input}" must be a FEAT-NNNN id, a FEAT-NNNN-<slug> task name, or a kebab-case slug`);
  }
  return { id: input, feature: wanted || featureIdsIn(input)[0] || '' };
}

function scaffold(nd: string, opts: Options): void {
  const { id, feature } = resolveTaskName(nd, opts.new!, opts.feature);
  const dir = join(totestDir(nd), id);

  if (existsSync(dir)) {
    fail(
      `totest/${id} already exists — there is ONE living test task per feature.\n` +
        `  Revise its ${TEST_PLAN_FILE} for the new work (rewrite or drop scenarios the change\n` +
        `  invalidated), then open a round with:  novadev totest --round ${id}`,
    );
  }
  // A different folder already covering this feature is the same mistake under another name.
  if (feature) {
    const clash = listTestTasks(nd).find((t) => t.id !== id && t.featureIds.includes(feature));
    if (clash) {
      fail(
        `totest/${clash.id} already covers ${feature} — revise that plan instead of adding a second task.`,
      );
    }
  }

  const today = todayStamp();
  mkdirSync(join(dir, TEST_RESULTS_DIR), { recursive: true });
  writeFileSync(
    join(dir, TEST_PLAN_FILE),
    testPlanSkeleton({ id, today, feature, todos: opts.todos, scope: opts.scope }),
  );
  writeFileSync(join(dir, TEST_RESULTS_DIR, 'README.md'), resultsGuide(id));

  console.log(`created totest/${id}/`);
  console.log(`  ${TEST_PLAN_FILE}            (write the scenarios — steps, pass, fail)`);
  console.log(`  ${TEST_RESULTS_DIR}/README.md   (how the tester records what happened)`);
  console.log(`\nNow add ai_needstest.md to each originating todo with:  **Test:** ${id}`);
  console.log('Then hand the round to a tester: an agent that did not build it runs `/novadev-test`.');
}

/**
 * Open a new testing round. The task folder lives in totest/ only while a round is
 * open, so this either reopens one that is already there, or brings the plan back from
 * the newest archived round and revives it as the starting point for the new one.
 */
function newRound(nd: string, input: string): void {
  const { id } = resolveTaskName(nd, input);
  const today = todayStamp();
  const open = listTestTasks(nd).find((t) => t.id === id);
  const archived = listTestRounds(nd, id);
  const latest = archived[archived.length - 1];

  if (!open && !latest) {
    fail(`no test task or archived round named "${id}" — create it with \`novadev totest --new ${input}\``);
  }

  const dir = join(totestDir(nd), id);
  let revision: number;

  if (open) {
    revision = (open.revision || 0) + 1;
    if (open.hasResults) {
      fail(
        `totest/${id} still holds unreviewed results (${open.results.join(', ')}).\n` +
          '  Its tester closes that round first (`/novadev-test`) — starting a new one now\n' +
          '  would bury testing already done.',
      );
    }
    console.log(`totest/${id} is already open — reopening it at revision ${revision}.`);
  } else {
    // Revive from the archive: the last plan is the honest starting point for revision.
    revision = (latest!.revision || 0) + 1;
    mkdirSync(join(dir, TEST_RESULTS_DIR), { recursive: true });
    const previousPlan = join(latest!.dir, TEST_PLAN_FILE);
    writeFileSync(
      join(dir, TEST_PLAN_FILE),
      existsSync(previousPlan)
        ? readFileSync(previousPlan, 'utf8')
        : testPlanSkeleton({ id, today, feature: featureIdsIn(id)[0] }),
    );
    writeFileSync(join(dir, TEST_RESULTS_DIR, 'README.md'), resultsGuide(id));
    console.log(
      `revived totest/${id} from archive/${latest!.year}/totest/${id}/${latest!.round}` +
        ` (rev ${latest!.revision} — ${latest!.verdict || 'verdict not recorded'}).`,
    );
  }

  const planPath = join(dir, TEST_PLAN_FILE);
  writeFileSync(
    planPath,
    setFrontmatter(readFileSync(planPath, 'utf8'), {
      id,
      updated: today,
      status: 'awaiting-test',
      revision: String(revision),
      todos: '',
      verdict: '',
    }),
  );
  console.log(
    `\ntotest/${id} is open at revision ${revision}.\n` +
      `Now REVISE ${TEST_PLAN_FILE} for what changed: rewrite scenarios whose expectations moved,\n` +
      'delete ones the change made irrelevant, add ones for the new behaviour, and log it under\n' +
      '"## Revisions" so the tester knows what is different since the last round.',
  );
}

/** The canonical test plan. Kept here so the CLI and the playbooks cannot drift. */
export function testPlanSkeleton(o: {
  id: string;
  today: string;
  feature?: string;
  todos?: string;
  scope?: string;
}): string {
  return `---
id: ${o.id}
created: ${o.today}
updated: ${o.today}
status: awaiting-test
revision: 1
last-tested:
todos: ${o.todos ?? ''}
feature: ${o.feature ?? ''}
scope: ${o.scope ?? ''}
---

# Test plan — ${o.id}

<!-- LIVING document: one per feature. When new work changes this feature, REVISE the
     scenarios below (rewrite what moved, delete what no longer applies) and log it under
     "## Revisions" — never leave a scenario describing behaviour that no longer exists. -->

**Why this needs a tester:** <what your own tests in the todo could NOT show — the
real app end to end, a browser or a device, a service, timing, what is on the screen>

**Already verified automatically:** <tests/build/typecheck that DID pass, so the
tester does not redo machine work>

**Setup:** <exact preconditions — branch, build/start command, URL, account, seed data,
device/browser matrix>

**Tools:** <what the tester drives it with: the project's test harness, scripts, fixtures,
a browser driver — and what is MISSING, which the tester builds before it runs the plan>

## Revisions

- ${o.today} (rev 1) — first plan.

## Scenario 1 — <short name>

**Priority:** critical
**Steps:**
1. <one concrete action per line — no "verify it works" hand-waving>
2. <…>

**Expect (pass):** <the observable good outcome — what should be on screen/in the
response/in the output, in enough detail that "looks fine" is not a judgement call>
**Watch for (fail):** <the specific bad outcomes that mean broken: the wrong state,
the visual glitch, the slow path, the error copy>

## Scenario 2 — <short name>

**Priority:** normal
**Steps:**
1. <…>

**Expect (pass):** <…>
**Watch for (fail):** <…>

## Out of scope

<what this round deliberately does NOT cover, so nobody assumes it was checked>
`;
}

function resultsGuide(id: string): string {
  return `# How to record results — ${id}

<!-- Seeded by novadev. Leave this file; add your own files next to it. -->

A TESTER — an agent that did not build this work — runs the scenarios in
\`../${TEST_PLAN_FILE}\` (\`/novadev-test\`) and records what actually happened, one
scenario at a time, with \`novadev test-result write\` — never by hand: the command appends,
so a second run never erases the first. Evidence goes beside it: logs, screenshots, the
output of the tools it built.

Check \`## Revisions\` at the top of the plan first — it says what changed since the last
round, so you know which scenarios are new or have different expectations this time.

A scenario the tester cannot run itself — a real device, a login only a person holds, a
judgement of how something feels — is escalated with \`novadev test-result escalate\`: the
smallest thing a person must do, in \`needs-human.md\` here. That is the only part of a
round that waits on a person. They answer through \`/novadev-what-to-test\`, or give the
tester what it was missing so it can run the scenario itself.

Per scenario, a result reads:

\`\`\`markdown
## Scenario 1 — <name>
pass | fail | partial — <what actually happened>
**Tested by:** <actor>
\`\`\`

Write down what the plan did not ask about but you noticed anyway — that off-script
observation is usually the most valuable thing in the folder.

When every scenario has a result (or is skipped by the owner), the tester reviews the
round: judges each scenario against its expected outcome, writes \`ai_confirmed.md\` on the
originating todo(s), files follow-up todos for whatever failed, and closes the plan. The
round — plan and results — is then archived to \`archive/<year>/totest/${id}/rev<N>-<date>/\`,
and the feature's \`tests.md\` links to it. So this folder is always just the round in
front of you.
`;
}
