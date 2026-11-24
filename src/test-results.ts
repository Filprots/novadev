// The MECHANICS of recording what a test round found into `.novadev/totest/<task>/test-results/`.
// The TESTER — an agent that did not build the work (/novadev-test) — records most of it; a person
// records only what the tester escalated to them, or testing they did of their own accord.
//
// Two shapes:
// - `writeResult` — one scenario at a time: the tester's run, or the /novadev-what-to-test walk of
//   an escalated scenario. Appends to `scenario-<N>.txt`.
// - `writeReview` — a whole round in one go (/novadev-test-review, or a tester's summary): a
//   verdict, per-scenario notes, change requests, screenshots. Appends a dated block to `review.md`.
// Both carry who tested (`by`) when the caller names them: `**Tested by:**`.
//
// `escalate` is not a result either: the tester's ask to a person for the scenarios it cannot run
// itself, in needs-human.md. It is the only part of a round that waits on a human.
//
// The rule worth putting in code rather than in prose is the first one: a second pass APPENDS.
// Replacing would quietly erase the first walk, and a skill writing the file by hand would replace.
//
// A third shape is not a result at all: `skipScenarios` — the owner decided some scenarios (or the
// rest of a round) will not be tested by a human. It lives in code because closing a round touches
// the plan, the round's results and every gated todo at once, and because the one thing it must
// never do — write `ai_confirmed.md` for a test nobody ran — is easy to get wrong by hand.
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { humanActor } from './knowledge-log.ts';
import {
  ESCALATIONS_FILE,
  RECORD_CONFIRMED,
  RECORD_NEEDSTEST,
  RECORD_TESTSKIPPED,
  TEST_PLAN_FILE,
  TEST_RESULTS_DIR,
  csvList,
  listFiles,
  readField,
  readFrontmatter,
  setFrontmatter,
  todayStamp,
  totestDir,
} from './lib.ts';
import { ACTOR_FORMAT, actorKind } from './okf.ts';
import { numbered } from './todo-filing.ts';

const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MAX_RESULT_BYTES = 64 * 1024;
export const REVIEW_FILE = 'review.md';

export type WrittenResult = { readonly written: string; readonly attachments: readonly string[] };

/** `.novadev/totest/<taskId>`, refusing anything that could escape the queue. */
export function taskDir(nd: string, taskId: string): string {
  if (!TASK_ID.test(taskId)) throw new Error(`Unsafe task id '${taskId}'.`);
  const dir = join(totestDir(nd), taskId);
  if (!existsSync(dir)) throw new Error(`No task '${taskId}' in the testing queue.`);
  return dir;
}

/**
 * Append one scenario's verdict, and copy in the screenshots that show it.
 *
 * The images matter as much as the words: when a screenshot contradicts the sentence beside it, the
 * screenshot wins — that is the rule this queue is reviewed under. They are named IN the result
 * file, because a reviewer reads the text and must know an image exists.
 */
export function writeResult(
  nd: string,
  input: {
    readonly taskId: string;
    readonly scenario: number;
    readonly title?: string;
    readonly text: string;
    readonly attachments?: readonly string[];
    /** Who tested: the tester's actor, or `human:<id>` for a person. */
    readonly by?: string;
  },
): WrittenResult {
  const { taskId, scenario } = input;
  // Any number a plan can give a scenario: a long-lived feature's plan numbers them in the hundreds.
  if (!Number.isSafeInteger(scenario) || scenario < 1) {
    throw new Error(`Scenario number must be a whole number from 1 up, got '${scenario}'.`);
  }
  // The verdict stays the first line of the text (recordedVerdicts reads it); who tested follows it.
  const body = requireBody(input.text) + testedBy(nd, input.by, '\n\n');
  const dir = join(taskDir(nd, taskId), TEST_RESULTS_DIR);
  mkdirSync(dir, { recursive: true });
  const file = `scenario-${scenario}.txt`;
  const title = (input.title ?? '').trim();
  const heading = `## Scenario ${scenario}${title !== '' ? ` — ${title}` : ''}`;
  // The images are copied FIRST: their real names go into the text that is about to be written.
  const attachments = copyEvidence(dir, `scenario-${scenario}`, input.attachments ?? []);
  const shown = attachments.length > 0 ? `\n\nAttached: ${attachments.join(', ')}\n` : '';
  const path = join(dir, file);
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : '';
  // APPEND, never replace — a second walk of the same scenario must not erase the first.
  const next =
    existing.trim() === ''
      ? `${heading}\n\n${body}\n${shown}`
      : `${existing.trimEnd()}\n\n${body}\n${shown}`;
  writeFileSync(path, next);
  return { written: `${taskId}/${TEST_RESULTS_DIR}/${file}`, attachments };
}

export type ReviewScenario = {
  readonly scenario?: number;
  readonly title?: string;
  readonly verdict?: string;
  readonly text: string;
  readonly attachments?: readonly string[];
};

export type ReviewInput = {
  readonly taskId: string;
  readonly verdict: string;
  readonly summary?: string;
  readonly scenarios?: readonly ReviewScenario[];
  readonly notes?: string;
  readonly environment?: string;
  readonly attachments?: readonly string[];
  /** Who tested: the tester's actor, or `human:<id>` for a person. */
  readonly by?: string;
};

/**
 * Append one whole round of human testing to `review.md`.
 *
 * A person testing rarely walks one scenario and stops — they run the feature, form an opinion, and
 * report the lot in one message with a couple of screenshots. This writes that as ONE dated block
 * carrying the overall verdict, the per-scenario notes they gave, whatever they want changed, and
 * every file they attached — so the round can be reviewed without them having been asked to shape
 * their report into anything.
 */
export function writeReview(nd: string, input: ReviewInput): WrittenResult {
  const dir = join(taskDir(nd, input.taskId), TEST_RESULTS_DIR);
  mkdirSync(dir, { recursive: true });
  const verdict = input.verdict.trim();
  if (verdict === '') throw new Error('A review needs a verdict.');
  const scenarios = input.scenarios ?? [];
  if (scenarios.length === 0 && (input.summary ?? '').trim() === '' && (input.notes ?? '').trim() === '') {
    throw new Error('Refusing to write an empty review — it needs a summary, a scenario, or notes.');
  }

  const today = todayStamp();
  const revision = planRevision(nd, input.taskId);
  const lines: string[] = [`## Review — ${today}${revision ? ` (rev ${revision})` : ''}`, ''];
  lines.push(`**Verdict:** ${verdict}`);
  const tester = testedBy(nd, input.by, '');
  if (tester !== '') lines.push(tester);
  if ((input.environment ?? '').trim() !== '') lines.push(`**Environment:** ${input.environment!.trim()}`);
  lines.push('');
  if ((input.summary ?? '').trim() !== '') lines.push(requireBody(input.summary!), '');

  const all: string[] = [];
  for (const entry of scenarios) {
    const name = [
      entry.scenario !== undefined ? `Scenario ${entry.scenario}` : 'Observation',
      (entry.title ?? '').trim(),
    ]
      .filter((part) => part !== '')
      .join(' — ');
    lines.push(`### ${name}`, '');
    if ((entry.verdict ?? '').trim() !== '') lines.push(`**Verdict:** ${entry.verdict!.trim()}`, '');
    lines.push(requireBody(entry.text));
    const prefix = entry.scenario !== undefined ? `scenario-${entry.scenario}` : 'review';
    const files = copyEvidence(dir, prefix, entry.attachments ?? []);
    if (files.length > 0) lines.push('', `Attached: ${files.join(', ')}`);
    lines.push('');
    all.push(...files);
  }

  if ((input.notes ?? '').trim() !== '') {
    lines.push('### Notes and change requests', '', requireBody(input.notes!), '');
  }
  const loose = copyEvidence(dir, 'review', input.attachments ?? []);
  if (loose.length > 0) lines.push(`Attached: ${loose.join(', ')}`, '');
  all.push(...loose);

  const path = join(dir, REVIEW_FILE);
  const block = lines.join('\n').trimEnd() + '\n';
  // APPEND: a feature is often tested twice in a day, and the second round must not erase the first.
  if (existsSync(path) && readFileSync(path, 'utf8').trim() !== '') {
    appendFileSync(path, `\n---\n\n${block}`);
  } else {
    writeFileSync(path, `# Test results — ${input.taskId}\n\n${block}`);
  }
  return { written: `${input.taskId}/${TEST_RESULTS_DIR}/${REVIEW_FILE}`, attachments: all };
}

/**
 * `**Tested by:** <actor>` (after `lead`), or '' when nobody was named. `human` is the person in git's
 * user.name (`human:<id>`); a malformed actor is refused.
 */
function testedBy(nd: string, by: string | undefined, lead: string): string {
  let who = (by ?? '').trim();
  if (who === '') return '';
  if (who === 'human') {
    const human = humanActor(dirname(nd));
    if (human === null) throw new Error('"by": "human" needs git\'s user.name — set it, or write human:<id>.');
    who = human;
  }
  if (actorKind(who) === null) throw new Error(`'by' must be an actor — ${ACTOR_FORMAT} — got '${who}'.`);
  return `${lead}**Tested by:** ${who}`;
}

function requireBody(text: string): string {
  const body = text.trim();
  if (body === '') throw new Error('Refusing to write an empty result.');
  if (Buffer.byteLength(body, 'utf8') > MAX_RESULT_BYTES) {
    throw new Error('That result text is too large to record.');
  }
  return body;
}

/** The revision the plan is currently at, for the review's heading. Absent plan → no revision. */
function planRevision(nd: string, taskId: string): string {
  const plan = join(totestDir(nd), taskId, TEST_PLAN_FILE);
  if (!existsSync(plan)) return '';
  return (readFrontmatter(plan)?.revision ?? '').trim();
}

/**
 * Copy evidence files into a task's test-results/, prefixed so the folder stays readable, and never
 * overwriting an image already there.
 */
function copyEvidence(dir: string, prefix: string, paths: readonly string[]): readonly string[] {
  if (paths.length === 0) return [];
  mkdirSync(dir, { recursive: true });
  const written: string[] = [];
  for (const from of paths) {
    if (!existsSync(from)) continue; // a path that did not travel is not fatal; the caller reports it
    const original = `${prefix}-${from.split('/').pop()!}`;
    let name = original;
    for (let n = 2; existsSync(join(dir, name)); n += 1) name = numbered(original, n);
    copyFileSync(from, join(dir, name));
    written.push(name);
  }
  return written;
}

// ---------------------------------------------------------------------------
// Skipping scenarios — the owner's decision that a human will not test them
// ---------------------------------------------------------------------------

export const SKIPPED_FILE = 'skipped.md';

/** `## Scenario 2 — Expired magic link is refused` → `{ scenario: 2, title, priority }`. */
export function scenariosIn(plan: string): { scenario: number; title: string; priority: string }[] {
  const out: { scenario: number; title: string; priority: string }[] = [];
  const blocks = plan.split(/^##\s+/m).slice(1);
  for (const block of blocks) {
    const head = block.split('\n', 1)[0] ?? '';
    const m = head.match(/^Scenario\s+(\d+)\s*(?:[—:-]\s*(.*))?$/i);
    if (!m) continue;
    out.push({
      scenario: Number(m[1]),
      title: (m[2] ?? '').trim(),
      priority: (block.match(/^\*\*Priority:\*\*\s*(.*)$/mi)?.[1] ?? '').trim(),
    });
  }
  return out;
}

/**
 * The verdicts a round's results already hold, per scenario: a `## Scenario N` / `### Scenario N`
 * block in any file of test-results/ (scenario-N.txt, review.md, a hand-written results.md), its
 * `**Verdict:**` line, or the first word of its text ("pass — …"). `recorded` when the block says
 * no verdict a reader can name. The newest block of a scenario wins.
 */
export function recordedVerdicts(resultsDir: string): Map<number, string> {
  const out = new Map<number, string>();
  for (const file of listFiles(resultsDir)) {
    if (file === 'README.md' || file === SKIPPED_FILE || file === ESCALATIONS_FILE || !(file.endsWith('.md') || file.endsWith('.txt'))) continue;
    const text = readFileSync(join(resultsDir, file), 'utf8').replace(/\r\n?/g, '\n');
    const parts = text.split(/^#{2,3}\s+(?=Scenario\s+\d+)/m).slice(1);
    for (const part of parts) {
      const number = Number(/^Scenario\s+(\d+)/.exec(part)?.[1]);
      if (!Number.isInteger(number)) continue;
      const body = part.split('\n').slice(1).join('\n').split(/^#{1,3}\s/m)[0] ?? '';
      const field = /^\*\*Verdict:\*\*\s*(.+)$/m.exec(body)?.[1];
      const first = body.split('\n').map((l) => l.trim()).find((l) => l !== '') ?? '';
      const word = /^(pass(?:ed)?|fail(?:ed)?|partial|skip(?:ped)?)\b/i.exec(field ?? first)?.[1];
      out.set(number, (word ?? field ?? 'recorded').trim().toLowerCase());
    }
  }
  return out;
}

export type SkipInput = {
  readonly taskId: string;
  /** Scenario numbers, or 'rest': every scenario of the plan without a recorded verdict. */
  readonly scenarios: readonly number[] | 'rest';
  /** Who decided: a person (`human:<id>`, or `human` for git's user.name). */
  readonly by: string;
  readonly reason: string;
};

/**
 * Record scenarios as `skipped` — who decided and why — in the round's test-results/skipped.md, and
 * when no scenario of the plan is left without a verdict, CLOSE the round the way a review does: the
 * plan `reviewed`, with its verdict (`skipped`, or `partly-skipped` when some were really tested),
 * how many were skipped and by whom; every gated todo's `ai_needstest.md` replaced by
 * `ai_testskipped.md` — never `ai_confirmed.md`. `novadev sync` then archives the round and lists it
 * in the feature's tests.md as skipped by the owner.
 */
export function skipScenarios(nd: string, root: string, input: SkipInput): Record<string, unknown> {
  const dir = taskDir(nd, input.taskId);
  const planPath = join(dir, TEST_PLAN_FILE);
  if (!existsSync(planPath)) throw new Error(`totest/${input.taskId} has no ${TEST_PLAN_FILE}.`);
  const fm = readFrontmatter(planPath) ?? {};
  if ((fm.status ?? '').trim() === 'reviewed') throw new Error(`totest/${input.taskId} is closed already (status: reviewed) — \`novadev sync\` archives it.`);
  const by = skipActor(root, input.by);
  const reason = requireBody(input.reason);
  const plan = scenariosIn(readFileSync(planPath, 'utf8'));
  if (plan.length === 0) throw new Error(`totest/${input.taskId}/${TEST_PLAN_FILE} has no "## Scenario" sections.`);
  const resultsDir = join(dir, TEST_RESULTS_DIR);
  const verdicts = recordedVerdicts(resultsDir);
  const isSkip = (v: string | undefined) => v !== undefined && v.startsWith('skip');
  const real = (n: number) => verdicts.has(n) && !isSkip(verdicts.get(n));
  const already = readSkipped(resultsDir);

  let chosen: number[];
  if (input.scenarios === 'rest') {
    chosen = plan.map((s) => s.scenario).filter((n) => !real(n) && !already.has(n));
  } else {
    const known = new Set(plan.map((s) => s.scenario));
    const unknown = input.scenarios.filter((n) => !known.has(n));
    if (unknown.length > 0) throw new Error(`The plan has no scenario ${unknown.join(', ')} (it has ${plan.map((s) => s.scenario).join(', ')}).`);
    const tested = input.scenarios.filter(real);
    if (tested.length > 0) {
      throw new Error(`Scenario ${tested.map((n) => `${n} (${verdicts.get(n)})`).join(', ')} already has a verdict a person recorded — a real result is kept, never skipped. Leave it out.`);
    }
    chosen = [...new Set(input.scenarios)].filter((n) => !already.has(n)).sort((a, b) => a - b);
  }

  const today = todayStamp();
  const revision = (fm.revision ?? '').trim();
  if (chosen.length > 0) {
    const title = (n: number) => plan.find((s) => s.scenario === n)?.title ?? '';
    const block = [
      `## Skipped — ${today}${revision ? ` (rev ${revision})` : ''}`,
      '',
      `**By:** ${by}`,
      `**Reason:** ${reason.replace(/\s*\n\s*/g, ' ')}`,
      '',
      ...chosen.map((n) => `- Scenario ${n}${title(n) ? ` — ${title(n)}` : ''} — **Verdict:** skipped`),
    ].join('\n');
    mkdirSync(resultsDir, { recursive: true });
    const path = join(resultsDir, SKIPPED_FILE);
    if (existsSync(path) && readFileSync(path, 'utf8').trim() !== '') appendFileSync(path, `\n---\n\n${block}\n`);
    else writeFileSync(path, `# Skipped scenarios — ${input.taskId}\n\n<!-- Written by \`novadev test-result skip\`: scenarios the owner decided a person will not test. Not a result. -->\n\n${block}\n`);
  }

  const skipped = new Set([...already, ...chosen, ...plan.map((s) => s.scenario).filter((n) => isSkip(verdicts.get(n)))]);
  const recorded = plan.filter((s) => real(s.scenario)).map((s) => ({ scenario: s.scenario, verdict: verdicts.get(s.scenario)! }));
  const open = plan.map((s) => s.scenario).filter((n) => !real(n) && !skipped.has(n));
  const answer: Record<string, unknown> = {
    taskId: input.taskId,
    skippedNow: chosen,
    skipped: [...skipped].sort((a, b) => a - b),
    recorded,
    ...(chosen.length > 0 ? { written: `${input.taskId}/${TEST_RESULTS_DIR}/${SKIPPED_FILE}` } : {}),
  };
  if (open.length > 0) {
    return { ...answer, closed: false, open, next: `scenario(s) ${open.join(', ')} still have no result — the round stays open (skip them too, or let a person walk them).` };
  }

  // Close the round, like a review.
  const verdict = recorded.length === 0 ? 'skipped' : 'partly-skipped';
  const todos = csvList(fm.todos ?? fm.todo);
  const gated: { todo: string; record?: string; note?: string }[] = [];
  for (const ref of todos) {
    const [batch, todo] = ref.split('/');
    const todoDir = batch && todo ? join(nd, 'todos', batch, todo) : '';
    const needstest = join(todoDir, RECORD_NEEDSTEST);
    if (todoDir === '' || !existsSync(todoDir)) {
      gated.push({ todo: ref, note: 'no such todo folder in todos/ — nothing marked' });
      continue;
    }
    if (existsSync(join(todoDir, RECORD_CONFIRMED))) {
      gated.push({ todo: ref, note: `it has ${RECORD_CONFIRMED} already — left as it is` });
      continue;
    }
    const gate = existsSync(needstest) ? readFileSync(needstest, 'utf8') : '';
    const test = gate === '' ? null : readField(gate, 'Test');
    if (gate !== '' && test !== null && test.trim() !== input.taskId) {
      gated.push({ todo: ref, note: `its ${RECORD_NEEDSTEST} waits on ${test.trim()}, not this task — left as it is` });
      continue;
    }
    const feature = gate === '' ? null : readField(gate, 'Feature');
    writeFileSync(join(todoDir, RECORD_TESTSKIPPED), testSkippedRecord({ todo, taskId: input.taskId, revision, today, by, reason, feature, skipped: [...skipped], recorded }));
    if (gate !== '') rmSync(needstest);
    gated.push({ todo: ref, record: RECORD_TESTSKIPPED });
  }
  const planText = readFileSync(planPath, 'utf8');
  const tested = recorded.length > 0 ? `; tested by a person: ${recorded.map((r) => `${r.scenario} ${r.verdict}`).join(', ')}` : '';
  const line = `- ${today}${revision ? ` (rev ${revision})` : ''} — closed without a full human test: ${skipped.size} of ${plan.length} scenario(s) skipped by ${by}${tested}. Reason: ${reason.replace(/\s*\n\s*/g, ' ')}`;
  writeFileSync(
    planPath,
    setFrontmatter(addRevisionLine(planText, line), { status: 'reviewed', verdict, 'last-tested': today, skipped: String(skipped.size), 'skipped-by': by }),
  );
  const failures = recorded.filter((r) => !r.verdict.startsWith('pass'));
  return {
    ...answer,
    closed: true,
    verdict,
    todos: gated,
    next: [
      ...(failures.length > 0 ? [`review the recorded result(s) ${failures.map((f) => `${f.scenario} (${f.verdict})`).join(', ')} and file follow-up todos for what failed (/novadev-work, phase 6)`] : []),
      '`novadev sync` archives the round and lists it in the feature\'s tests.md as skipped by the owner',
    ],
  };
}

/** The scenarios a round's skipped.md already marks. */
export function readSkipped(resultsDir: string): Set<number> {
  const path = join(resultsDir, SKIPPED_FILE);
  if (!existsSync(path)) return new Set();
  return new Set([...readFileSync(path, 'utf8').matchAll(/^- Scenario (\d+)\b.*\*\*Verdict:\*\* skipped\s*$/gm)].map((m) => Number(m[1])));
}

/** Who decided: a person. An agent relays the owner's decision; it never makes it. */
function skipActor(root: string, raw: string): string {
  const by = raw.trim();
  if (by === 'human') {
    const human = humanActor(root);
    if (human === null) throw new Error('"by": "human" needs git\'s user.name — set it, or write human:<id>.');
    return human;
  }
  if (actorKind(by) !== 'human') throw new Error('"by" must be the person who decided to skip — human:<id>, or "human" for git\'s user.name. Skipping a human test is the owner\'s call, never an agent\'s.');
  return by;
}

function addRevisionLine(plan: string, line: string): string {
  const lines = plan.split('\n');
  const at = lines.findIndex((l) => /^##\s+Revisions\s*$/.test(l));
  if (at === -1) return `${plan.trimEnd()}\n\n## Revisions\n\n${line}\n`;
  let end = at + 1;
  for (let i = at + 1; i < lines.length && !/^#{1,2}\s/.test(lines[i]!); i++) if (lines[i]!.trim() !== '') end = i + 1;
  if (end === at + 1) end = at + 2;
  lines.splice(end, 0, line);
  return lines.join('\n');
}

function testSkippedRecord(o: {
  todo: string;
  taskId: string;
  revision: string;
  today: string;
  by: string;
  reason: string;
  feature: string | null;
  skipped: number[];
  recorded: { scenario: number; verdict: string }[];
}): string {
  return [
    `# ai_testskipped — ${o.todo}`,
    '',
    `**Date:** ${o.today}`,
    `**Test:** ${o.taskId}`,
    `**Skipped by:** ${o.by}`,
    ...(o.feature !== null ? [`**Feature:** ${o.feature.trim()}`] : []),
    '',
    `NOT tested by a human. The round${o.revision ? ` (rev ${o.revision})` : ''} of ${o.taskId} was closed without a full human test, on ${o.by}'s decision. This is not a confirmation: nothing here says a person verified this work. Written by \`novadev test-result skip\`.`,
    '',
    '## Reason',
    '',
    o.reason,
    '',
    '## Scenarios',
    '',
    `- skipped: ${[...o.skipped].sort((a, b) => a - b).join(', ') || 'none'}`,
    `- tested by a person before the skip: ${o.recorded.length > 0 ? o.recorded.map((r) => `${r.scenario} ${r.verdict}`).join(', ') : 'none'}`,
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Escalating — the tester's ask to a person, for what it cannot run itself
// ---------------------------------------------------------------------------

export type EscalateInput = {
  readonly taskId: string;
  readonly scenarios: readonly number[];
  /** The tester: an agent's actor. A person does not escalate to themselves. */
  readonly by: string;
  /** The smallest thing the person must do — the step only they can take, or the input only they have. */
  readonly ask: string;
  /** What the tester built and tried, and why it still cannot run these scenarios. */
  readonly tried: string;
};

export type Escalation = {
  readonly date: string;
  readonly by: string;
  readonly scenarios: readonly number[];
  readonly ask: string;
  /** The scenarios of this ask that still have no result and are not skipped. */
  readonly open: readonly number[];
};

/**
 * Hand scenarios the tester cannot run itself to a person: a dated block in test-results/needs-human.md
 * — who asks, which scenarios, the ask, and what was tried. A scenario that already has a verdict is
 * refused (there is nothing left to ask), and so is a person as `by`. The ask stays open until each
 * of its scenarios has a result (the person's, or the tester's once the person did their part) or is
 * skipped by the owner.
 */
export function escalate(nd: string, input: EscalateInput): Record<string, unknown> {
  const dir = taskDir(nd, input.taskId);
  const planPath = join(dir, TEST_PLAN_FILE);
  if (!existsSync(planPath)) throw new Error(`totest/${input.taskId} has no ${TEST_PLAN_FILE}.`);
  const fm = readFrontmatter(planPath) ?? {};
  if ((fm.status ?? '').trim() === 'reviewed') throw new Error(`totest/${input.taskId} is closed already (status: reviewed).`);
  const by = input.by.trim();
  const kind = actorKind(by);
  if (kind === null) throw new Error(`'by' must be the tester's actor — ${ACTOR_FORMAT} — got '${by}'.`);
  if (kind === 'human') throw new Error("'by' is the tester that escalates — an agent, never a person. A person who tests records a result (`novadev test-result write`).");
  const ask = requireBody(input.ask);
  const tried = requireBody(input.tried);
  const plan = scenariosIn(readFileSync(planPath, 'utf8'));
  const known = new Set(plan.map((s) => s.scenario));
  const unknown = input.scenarios.filter((n) => !known.has(n));
  if (unknown.length > 0) throw new Error(`The plan has no scenario ${unknown.join(', ')} (it has ${plan.map((s) => s.scenario).join(', ') || 'none'}).`);
  const resultsDir = join(dir, TEST_RESULTS_DIR);
  const verdicts = recordedVerdicts(resultsDir);
  const skipped = readSkipped(resultsDir);
  const done = input.scenarios.filter((n) => verdicts.has(n) || skipped.has(n));
  if (done.length > 0) {
    throw new Error(`Scenario ${done.map((n) => `${n} (${skipped.has(n) ? 'skipped' : verdicts.get(n)})`).join(', ')} already has a result — there is nothing to ask a person for. Leave it out.`);
  }
  const chosen = [...new Set(input.scenarios)].sort((a, b) => a - b);
  const revision = (fm.revision ?? '').trim();
  const title = (n: number) => plan.find((s) => s.scenario === n)?.title ?? '';
  const block = [
    `## Escalated — ${todayStamp()}${revision ? ` (rev ${revision})` : ''}`,
    '',
    `**By:** ${by}`,
    `**Scenarios:** ${chosen.join(', ')}`,
    ...chosen.map((n) => `- Scenario ${n}${title(n) ? ` — ${title(n)}` : ''}`),
    '',
    '### Ask',
    '',
    ask,
    '',
    '### Tried',
    '',
    tried,
  ].join('\n');
  mkdirSync(resultsDir, { recursive: true });
  const path = join(resultsDir, ESCALATIONS_FILE);
  if (existsSync(path) && readFileSync(path, 'utf8').trim() !== '') appendFileSync(path, `\n---\n\n${block}\n`);
  else writeFileSync(path, `# Needs a person — ${input.taskId}\n\n<!-- Written by \`novadev test-result escalate\`: the scenarios the tester could not run itself, and the smallest thing a person must do. An ask, not a result. -->\n\n${block}\n`);
  return {
    taskId: input.taskId,
    escalated: chosen,
    written: `${input.taskId}/${TEST_RESULTS_DIR}/${ESCALATIONS_FILE}`,
    next: 'it is listed under WAITING ON THE HUMAN until each scenario has a result or is skipped by the owner; test every other scenario meanwhile',
  };
}

/** The asks of a round's needs-human.md, each with the scenarios still open (no result, not skipped). */
export function escalations(resultsDir: string): Escalation[] {
  const path = join(resultsDir, ESCALATIONS_FILE);
  if (!existsSync(path)) return [];
  const verdicts = recordedVerdicts(resultsDir);
  const skipped = readSkipped(resultsDir);
  const text = readFileSync(path, 'utf8').replace(/\r\n?/g, '\n');
  const out: Escalation[] = [];
  for (const part of text.split(/^## Escalated\b/m).slice(1)) {
    const block = part.split(/^---\s*$/m)[0] ?? part;
    const date = /\d{4}-\d{2}-\d{2}/.exec(block.split('\n', 1)[0] ?? '')?.[0] ?? '';
    const by = (/^\*\*By:\*\*\s*(.+)$/m.exec(block)?.[1] ?? '').trim();
    const scenarios = ((/^\*\*Scenarios:\*\*\s*(.+)$/m.exec(block)?.[1] ?? '').match(/\d+/g) ?? []).map(Number);
    const ask = (/^### Ask\s*\n([\s\S]*?)(?=^### Tried\b|$(?![\s\S]))/m.exec(block)?.[1] ?? '').trim();
    out.push({ date, by, scenarios, ask, open: scenarios.filter((n) => !verdicts.has(n) && !skipped.has(n)) });
  }
  return out;
}
