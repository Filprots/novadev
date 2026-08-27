// `novadev totest` — the human-verification queue.
//
// One LIVING task per feature: `--new` refuses to create a second folder for a feature
// that already has one, and `--round` opens a fresh testing round on the existing task
// (rotating the last round's plan + results into history/). The plan itself is revised
// by an agent — stale scenarios rewritten or dropped — never accumulated.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  TEST_HISTORY_DIR,
  TEST_PLAN_FILE,
  TEST_RESULTS_DIR,
  TEST_TASK_RE,
  type TestTask,
  fail,
  featureIdsIn,
  listFeatures,
  listFiles,
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

  const all = listTestTasks(nd, opts.all);
  const tasks = opts.all ? all : all.filter((t) => t.status !== 'reviewed');
  if (tasks.length === 0) {
    console.log(all.length === 0 ? 'totest — no test tasks yet.' : 'totest — nothing waiting on you. ✓');
    return;
  }

  const ready = tasks.filter((t) => t.hasResults && t.status !== 'reviewed');
  const open = tasks.filter((t) => t.status !== 'reviewed');
  console.log(`totest — ${open.length} awaiting you, ${ready.length} ready for review`);
  for (const t of tasks) print(t);

  if (ready.length > 0) {
    console.log(
      `\n${ready.length} task(s) have results waiting — run \`/novadev-review-tests\` so an agent` +
        '\nreads them and closes the loop (ai_confirmed.md, or follow-up todos for the failures).',
    );
  }
  const untested = open.filter((t) => !t.hasResults);
  if (untested.length > 0) {
    console.log(
      `\n${untested.length} task(s) still need YOUR hands: open the ${TEST_PLAN_FILE}, walk the` +
        `\nscenarios, and write what happened into that task's ${TEST_RESULTS_DIR}/ folder.`,
    );
  }
}

function print(t: TestTask): void {
  const dormant = t.status === 'reviewed';
  const mark = dormant ? '✓' : t.hasResults ? '◆' : '○';
  const state = dormant ? 'reviewed' : t.hasResults ? 'READY FOR REVIEW' : 'awaiting your test';
  console.log(`  ${mark} ${t.id}  — ${state}`);
  const meta = [
    `${t.scenarios} scenario(s)`,
    t.revision ? `rev ${t.revision}` : '',
    t.lastTested ? `last tested ${t.lastTested}` : 'never tested',
    t.rounds.length ? `${t.rounds.length} past round(s)` : '',
  ].filter(Boolean);
  console.log(`      ${meta.join(' · ')}`);
  if (t.todoRefs.length) console.log(`      todos: ${t.todoRefs.join(', ')}`);
  if (t.hasResults) console.log(`      results: ${t.results.join(', ')}`);
  if (!existsSync(t.planPath)) console.log(`      ✗ missing ${TEST_PLAN_FILE}`);
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
 * Open a new testing round on an existing task: the previous round's plan snapshot and
 * results move into history/<stamp>/ so the human's inbox is empty for the new round and
 * the evidence of what was tested before survives in git.
 */
function newRound(nd: string, input: string): void {
  const { id } = resolveTaskName(nd, input);
  const task = listTestTasks(nd).find((t) => t.id === id);
  if (!task) fail(`totest/${id} does not exist — create it with \`novadev totest --new ${input}\``);

  const t = task!;
  const today = todayStamp();
  const moved: string[] = [];

  if (t.hasResults || existsSync(t.planPath)) {
    const stamp = t.lastTested || t.fm.updated || today;
    let dest = join(t.dir, TEST_HISTORY_DIR, stamp);
    for (let n = 2; existsSync(dest); n++) dest = join(t.dir, TEST_HISTORY_DIR, `${stamp}-${n}`);
    mkdirSync(dest, { recursive: true });

    if (existsSync(t.planPath)) {
      writeFileSync(join(dest, TEST_PLAN_FILE), readFileSync(t.planPath, 'utf8'));
      moved.push(`${TEST_PLAN_FILE} (snapshot)`);
    }
    for (const file of listFiles(join(t.dir, TEST_RESULTS_DIR))) {
      if (file === 'README.md') continue;
      renameSync(join(t.dir, TEST_RESULTS_DIR, file), join(dest, file));
      moved.push(file);
    }
    console.log(`archived the previous round → ${TEST_HISTORY_DIR}/${dest.split('/').pop()}/`);
    for (const f of moved) console.log(`  ${f}`);
  }

  writeFileSync(
    t.planPath,
    setFrontmatter(readFileSync(t.planPath, 'utf8'), {
      updated: today,
      status: 'awaiting-test',
      revision: String((t.revision || 0) + 1),
      todos: '',
    }),
  );
  console.log(
    `\ntotest/${id} reopened at revision ${(t.revision || 0) + 1}.\n` +
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
originating todo(s), and files follow-up todos for whatever failed. Your results then
move into \`../${TEST_HISTORY_DIR}/\` when the next round opens, so this folder is
always just the current round.
`;
}
