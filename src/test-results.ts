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
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TEST_PLAN_FILE, TEST_RESULTS_DIR, readFrontmatter, todayStamp, totestDir } from './lib.ts';
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
