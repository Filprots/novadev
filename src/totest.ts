// `novadev totest` — the human-verification queue.
//
// One LIVING task per feature: `--new` refuses to create a second folder for a feature
// that already has one, and `--round` opens a fresh testing round on the existing task
// (rotating the last round's plan + results into history/). The plan itself is revised
// by an agent — stale scenarios rewritten or dropped — never accumulated.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  TEST_PLAN_FILE,
  TEST_RESULTS_DIR,
  TEST_TASK_RE,
  type TestRound,
  type TestTask,
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
  if (tasks.length === 0) {
    console.log('totest — nothing waiting on you. ✓');
    if (opts.all && rounds.length > 0) printRounds(rounds);
    else if (rounds.length > 0) {
      console.log(`  (${rounds.length} completed round(s) in the archive — \`novadev totest --all\`)`);
    }
    return;
  }

  const ready = tasks.filter((t) => t.hasResults);
  console.log(`totest — ${tasks.length} awaiting you, ${ready.length} ready for review`);
  for (const t of tasks) print(t);
  if (opts.all && rounds.length > 0) printRounds(rounds);

  if (ready.length > 0) {
    console.log(
      `\n${ready.length} task(s) have results waiting — run \`/novadev-review-tests\` so an agent` +
        '\nreads them and closes the loop (ai_confirmed.md, or follow-up todos for the failures).',
    );
  }
  const untested = tasks.filter((t) => !t.hasResults);
  if (untested.length > 0) {
    console.log(
      `\n${untested.length} task(s) still need YOUR hands: open the ${TEST_PLAN_FILE}, walk the` +
        `\nscenarios, and write what happened into that task's ${TEST_RESULTS_DIR}/ folder.`,
    );
  }
}

function print(t: TestTask): void {
  console.log(`  ${t.hasResults ? '◆' : '○'} ${t.id}  — ${t.hasResults ? 'READY FOR REVIEW' : 'awaiting your test'}`);
  const meta = [
    `${t.scenarios} scenario(s)`,
    `rev ${t.revision || 1}`,
    t.lastTested ? `last tested ${t.lastTested}` : 'never tested',
  ].filter(Boolean);
  console.log(`      ${meta.join(' · ')}`);
  if (t.todoRefs.length) console.log(`      todos: ${t.todoRefs.join(', ')}`);
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
  console.log(`  ${TEST_RESULTS_DIR}/README.md   (how the human records what happened)`);
  console.log(`\nNow add ai_needstest.md to each originating todo with:  **Test:** ${id}`);
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
          '  Run `/novadev-review-tests` to close that round first — starting a new one now\n' +
          '  would bury testing the human already did.',
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
      '"## Revisions" so the human knows what is different since they last tested.',
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

**Why this needs a human:** <what could NOT be verified automatically, and why —
rendering, real device/browser, a third-party service, visual or perceptual
judgement, timing and "feel", anything behind a login the agent cannot hold>

**Already verified automatically:** <tests/build/typecheck that DID pass, so the
human does not redo machine work>

**Setup:** <exact preconditions — branch, build command, URL, account, seed data,
device/browser matrix>

## Revisions

- ${o.today} (rev 1) — first plan.

## Scenario 1 — <short name>

**Priority:** critical
**Steps:**
1. <one concrete action per line — no "verify it works" hand-waving>
2. <…>

**Expect (pass):** <the observable good outcome — what should be on screen/in the
response, in enough detail that "looks fine" is not a judgement call>
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

Walk the scenarios in \`../${TEST_PLAN_FILE}\` and write down what actually happened.
Anything you add here counts as results, which is what flips this task to
**ready for review**: a \`results.md\`, screenshots, screen recordings, logs, exports.

Check \`## Revisions\` at the top of the plan first — if you have tested this feature
before, that line tells you what changed since, so you know which scenarios are new or
have different expectations this time.

A simple \`results.md\` is enough — per scenario:

\`\`\`markdown
## Scenario 1 — <name>
**Verdict:** pass | fail | partial | skipped
**What I saw:** <what actually happened, in your words>
**Evidence:** <screenshot filename, if any>
**Environment:** <browser/device/OS, if it matters>
\`\`\`

Then add anything the plan did not ask about but you noticed anyway — that
off-script observation is usually the most valuable thing in the folder, so write
it down even when it feels unrelated.

When you are done, run \`/novadev-review-tests\`: an agent reads this folder, judges
each scenario against its expected outcome, writes \`ai_confirmed.md\` on the
originating todo(s), and files follow-up todos for whatever failed. This whole round —
the plan you walked and the results you wrote — is then archived to
\`archive/<year>/totest/${id}/rev<N>-<date>/\`, and the feature's \`tests.md\` links to
it. So this folder is always just the round in front of you.
`;
}
