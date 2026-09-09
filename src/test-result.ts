// `novadev test-result` — the command half of /novadev-what-to-test and /novadev-test-review.
//
//   novadev test-result tasks [query]     the open queue as JSON, with each task's scenarios
//   novadev test-result write <payload>   one scenario's verdict, appended to scenario-<N>.txt
//   novadev test-result review <payload>  a whole round, appended to review.md
//
// Payloads are JSON FILES because the content is a person's own multi-line words, and quoting that
// through a shell is how it gets mangled. Answers are JSON on stdout; errors are `{ "error": … }`
// with a non-zero exit.
//
// `tasks` exists so a skill never has to guess which folder a person meant: they say "the selection
// one" or "16", and this resolves it against the real queue.
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import {
  TEST_PLAN_FILE,
  listTestTasks,
  novadevDir,
  requireProjectRoot,
  totestDir,
} from './lib.ts';
import { writeResult, writeReview, type ReviewScenario } from './test-results.ts';

const USAGE =
  'usage: novadev test-result tasks [query]\n' +
  '       novadev test-result write <payload.json>\n' +
  '       novadev test-result review <payload.json>';

export function testResult(args: string[]): void {
  const [command, argument] = args;
  const nd = novadevDir(requireProjectRoot());
  try {
    if (command === 'tasks') {
      console.log(JSON.stringify({ tasks: describeTasks(nd, argument) }, null, 2));
      return;
    }
    if (command === 'write' || command === 'review') {
      if (argument === undefined) throw new Error(USAGE);
      const payload = readPayload(argument);
      const attachments = stringList(payload['attachments'] ?? payload['attachmentIds']);
      const taskId = requireString(payload, 'taskId');
      if (command === 'write') {
        const written = writeResult(nd, {
          taskId,
          scenario: Number(payload['scenario']),
          ...(typeof payload['title'] === 'string' ? { title: payload['title'] } : {}),
          text: requireString(payload, 'text'),
          attachments,
        });
        report(written, missingIn([...attachments]));
        return;
      }
      const scenarios = parseScenarios(payload['scenarios']);
      const written = writeReview(nd, {
        taskId,
        verdict: requireString(payload, 'verdict'),
        ...(typeof payload['summary'] === 'string' ? { summary: payload['summary'] } : {}),
        ...(typeof payload['notes'] === 'string' ? { notes: payload['notes'] } : {}),
        ...(typeof payload['environment'] === 'string' ? { environment: payload['environment'] } : {}),
        scenarios,
        attachments,
      });
      report(written, missingIn([...attachments, ...scenarios.flatMap((s) => s.attachments ?? [])]));
      return;
    }
    console.error(USAGE);
    process.exit(2);
  } catch (error) {
    console.log(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2),
    );
    process.exit(1);
  }
}

function report(
  written: { written: string; attachments: readonly string[] },
  missing: readonly string[],
): void {
  console.log(
    JSON.stringify(
      { ...written, ...(missing.length > 0 ? { missingAttachments: missing } : {}) },
      null,
      2,
    ),
  );
}

/**
 * The open queue, each task with the scenarios its plan actually defines — so a review can name
 * `Scenario 3` and mean the one the person walked. `query` narrows it the way a person refers to a
 * task out loud: a FEAT id, a bare number, or a word from the name or the scope.
 */
function describeTasks(nd: string, query: string | undefined): unknown[] {
  const wanted = (query ?? '').trim().toLowerCase();
  const padded = wanted.match(/^\d{1,4}$/) ? `feat-${wanted.padStart(4, '0')}` : '';
  return listTestTasks(nd)
    .map((task) => {
      const planPath = join(totestDir(nd), task.id, TEST_PLAN_FILE);
      const plan = existsSync(planPath) ? readFileSync(planPath, 'utf8') : '';
      return {
        id: task.id,
        features: task.featureIds,
        status: task.status,
        revision: task.revision || 1,
        lastTested: task.lastTested,
        scope: (task.fm['scope'] ?? '').trim(),
        todos: task.todoRefs,
        scenarios: scenariosIn(plan),
        results: task.results,
        hasResults: task.hasResults,
      };
    })
    .filter((task) => {
      if (wanted === '') return true;
      const haystack = [
        task.id,
        task.scope,
        ...task.features,
        ...task.scenarios.map((s) => s.title),
      ]
        .join(' ')
        .toLowerCase();
      // A bare number is a FEATURE number and nothing else: matching it as loose text would make
      // "16" pull in FEAT-0160, FEAT-0161 and FEAT-0163 — the opposite of naming one task.
      return padded !== '' ? haystack.includes(padded) : haystack.includes(wanted);
    });
}

/** `## Scenario 2 — Expired magic link is refused` → `{ scenario: 2, title, priority }`. */
function scenariosIn(plan: string): { scenario: number; title: string; priority: string }[] {
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

function readPayload(argument: string): Record<string, unknown> {
  const path = isAbsolute(argument) ? argument : resolve(process.cwd(), argument);
  if (!existsSync(path)) throw new Error(`No payload file at ${path}.`);
  const payload = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('The payload must be a JSON object.');
  }
  return payload as Record<string, unknown>;
}

function requireString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`The payload needs a '${key}'.`);
  }
  return value;
}

function stringList(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [];
}

function parseScenarios(raw: unknown): ReviewScenario[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new Error("'scenarios' must be an array.");
  return raw.map((entry) => {
    if (entry === null || typeof entry !== 'object') throw new Error('Each scenario must be an object.');
    const record = entry as Record<string, unknown>;
    const text = typeof record['text'] === 'string' ? record['text'] : '';
    if (text.trim() === '') throw new Error('Each scenario entry needs the text of what happened.');
    const number = Number(record['scenario']);
    return {
      ...(Number.isInteger(number) && number > 0 ? { scenario: number } : {}),
      ...(typeof record['title'] === 'string' ? { title: record['title'] } : {}),
      ...(typeof record['verdict'] === 'string' ? { verdict: record['verdict'] } : {}),
      text,
      attachments: stringList(record['attachments'] ?? record['attachmentIds']),
    };
  });
}

function missingIn(paths: readonly string[]): string[] {
  return [...new Set(paths.filter((path) => !existsSync(path)))];
}
