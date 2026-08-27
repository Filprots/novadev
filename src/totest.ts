// `novadev totest` — the human-verification queue; `--new` scaffolds a test task.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  TEST_PLAN_FILE,
  TEST_RESULTS_DIR,
  type TestTask,
  fail,
  listTestTasks,
  novadevDir,
  requireProjectRoot,
  todayStamp,
  totestDir,
} from './lib.ts';

export function totest(args: string[]): void {
  const root = requireProjectRoot();
  const nd = novadevDir(root);

  const opts = parseArgs(args);
  if (opts.new) {
    scaffold(nd, opts);
    return;
  }

  const tasks = listTestTasks(nd, opts.all).filter((t) => opts.all || t.status !== 'reviewed');
  if (tasks.length === 0) {
    console.log(
      opts.all ? 'totest — no test tasks.' : 'totest — nothing waiting on you. ✓',
    );
    return;
  }

  const ready = tasks.filter((t) => t.hasResults && t.status !== 'reviewed');
  console.log(`totest — ${tasks.length} test task(s), ${ready.length} ready for review`);
  for (const t of tasks) print(t);

  if (ready.length > 0) {
    console.log(
      `\n${ready.length} task(s) have results waiting — run \`/novadev-review-tests\` so an agent` +
        '\nreads them and closes the loop (ai_confirmed.md, or follow-up todos for the failures).',
    );
  }
  const untested = tasks.filter((t) => !t.hasResults && t.status !== 'reviewed');
  if (untested.length > 0) {
    console.log(
      `\n${untested.length} task(s) still need YOUR hands: open the test-plan.md, walk the` +
        `\nscenarios, and write what happened into that task's ${TEST_RESULTS_DIR}/ folder.`,
    );
  }
}

function print(t: TestTask): void {
  const mark = t.status === 'reviewed' ? '✓' : t.hasResults ? '◆' : '○';
  const state = t.status === 'reviewed' ? 'reviewed' : t.hasResults ? 'READY FOR REVIEW' : 'awaiting your test';
  console.log(`  ${mark} ${t.id}  — ${state}${t.archived ? ' · archived' : ''}`);
  const meta = [
    `${t.scenarios} scenario(s)`,
    t.todoRef ? `todo: ${t.todoRef}` : '',
    t.featureIds.length ? `feature: ${t.featureIds.join(', ')}` : '',
  ].filter(Boolean);
  console.log(`      ${meta.join(' · ')}`);
  if (t.hasResults) console.log(`      results: ${t.results.join(', ')}`);
  if (!existsSync(t.planPath)) console.log(`      ✗ missing ${TEST_PLAN_FILE}`);
}

type Options = { new?: string; all?: boolean; todo?: string; feature?: string; scope?: string };

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
      case '--all':
        opts.all = true;
        break;
      case '--todo':
        opts.todo = value();
        break;
      case '--feature':
        opts.feature = value();
        break;
      case '--scope':
        opts.scope = value();
        break;
      default:
        fail(`unknown option "${a}"\nusage: novadev totest [--all] [--new <slug> [--todo <ref>] [--feature FEAT-NNNN] [--scope "..."]]`);
    }
  }
  return opts;
}

function scaffold(nd: string, opts: Options): void {
  const slug = opts.new!.replace(/^\d{4}-\d{2}-\d{2}_/, '');
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    fail(`test task slug "${slug}" must be lowercase kebab-case`);
  }
  const today = todayStamp();
  const id = `${today}_${slug}`;
  const dir = join(totestDir(nd), id);
  if (existsSync(dir)) fail(`totest/${id} already exists`);

  mkdirSync(join(dir, TEST_RESULTS_DIR), { recursive: true });
  writeFileSync(
    join(dir, TEST_PLAN_FILE),
    testPlanSkeleton({ id, today, todo: opts.todo, feature: opts.feature, scope: opts.scope }),
  );
  writeFileSync(join(dir, TEST_RESULTS_DIR, 'README.md'), resultsGuide(id));

  console.log(`created totest/${id}/`);
  console.log(`  ${TEST_PLAN_FILE}         (write the scenarios — steps, pass, fail)`);
  console.log(`  ${TEST_RESULTS_DIR}/README.md  (how the human records what happened)`);
  console.log(`\nNow add ai_needstest.md to the originating todo pointing at "${id}".`);
}

/** The canonical test plan. Kept here so the CLI and the playbooks cannot drift. */
export function testPlanSkeleton(o: {
  id: string;
  today: string;
  todo?: string;
  feature?: string;
  scope?: string;
}): string {
  return `---
id: ${o.id}
created: ${o.today}
status: awaiting-test
todo: ${o.todo ?? ''}
feature: ${o.feature ?? ''}
scope: ${o.scope ?? ''}
---

# Test plan — ${o.id}

**Why this needs a human:** <what could NOT be verified automatically, and why —
rendering, real device/browser, a third-party service, visual or perceptual
judgement, timing and "feel", anything behind a login the agent cannot hold>

**Already verified automatically:** <tests/build/typecheck that DID pass, so the
human does not redo machine work>

**Setup:** <exact preconditions — branch, build command, URL, account, seed data,
device/browser matrix>

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
original todo, and files follow-up todos for whatever failed.
`;
}
