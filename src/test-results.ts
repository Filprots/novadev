// The MECHANICS of recording what a HUMAN found into `.novadev/totest/<task>/test-results/`.
//
// Two shapes, because a person reports in two ways:
// - `writeResult` — one scenario at a time, the /novadev-what-to-test walk. Appends to
//   `scenario-<N>.txt`.
// - `writeReview` — a whole round in one go, the /novadev-test-review dump: a verdict, per-scenario
//   notes, change requests, screenshots. Appends a dated block to `review.md`.
//
// The rule worth putting in code rather than in prose is the first one: a second pass APPENDS.
// Replacing would quietly erase the first walk, and a skill writing the file by hand would replace.
//
// A third shape is not a result at all: `skipScenarios` — the owner decided some scenarios (or the
// rest of a round) will not be tested by a human. It lives in code because closing a round touches
// the plan, the round's results and every gated todo at once, and because the one thing it must
// never do — write `ai_confirmed.md` for a test nobody ran — is easy to get wrong by hand.
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { humanActor } from './knowledge-log.ts';
import {
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
import { actorKind } from './okf.ts';
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
  },
): WrittenResult {
  const { taskId, scenario } = input;
  if (!Number.isInteger(scenario) || scenario < 1 || scenario > 99) {
    throw new Error(`Scenario number must be 1-99, got '${scenario}'.`);
  }
  const body = requireBody(input.text);
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
    if (file === 'README.md' || file === SKIPPED_FILE || !(file.endsWith('.md') || file.endsWith('.txt'))) continue;
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
function readSkipped(resultsDir: string): Set<number> {
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
