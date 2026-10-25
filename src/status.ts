// `novadev status` — stock-take of the novadev tree without an agent.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { knowledgeStatusLine } from './knowledge.ts';
import {
  FEATURE_STATUSES,
  WORK_LOCK_FILE,
  batchIsDone,
  featuresDir,
  listDirs,
  listFeatures,
  listFiles,
  listTestTasks,
  novadevDir,
  readFrontmatter,
  requireProjectRoot,
  todoState,
} from './lib.ts';
import { metricsStatusLine } from './metrics-audit.ts';
import { listTodos } from './todo.ts';
import { auditWork, latestLine, listWorkLocks, lockLiveness, phaseLabel, readWorkLock } from './work.ts';

const STATE_MARK = {
  confirmed: '✓✓',
  completed: '✓',
  needstest: '⧗',
  failed: '✗',
  progress: '…',
  open: '·',
} as const;

/**
 * `novadev status --json`: the same stock-take as data, for a tool that answers a person away from the repository
 * (a chat bot): the batches in work with their holder and newest waypoint, every open todo with its title and state,
 * the human-test queue, postponed items, and the counts.
 */
export function statusData(nd: string, now: Date = new Date()): Record<string, unknown> {
  const inWork = listWorkLocks(nd).map((read) => {
    if (read.state === 'invalid') return { batch: read.batch, state: 'unreadable', error: read.error };
    const lock = read.lock;
    const live = lockLiveness(lock, now);
    return {
      batch: read.batch, state: lock.state, live: live.live, liveness: live.reason, minutesSinceUpdate: live.ageMinutes,
      agent: lock.agent, host: lock.host, started: lock.started, updated: lock.updated, resumed: lock.resumed,
      todo: lock.todo, phase: lock.phase, phaseLabel: lock.phase === null ? null : phaseLabel(lock.phase),
      latest: latestLine(lock), entries: lock.entries.length,
    };
  });
  const todos = listTodos(nd);
  const batches = listDirs(join(nd, 'todos')).map((batch) => {
    const lock = readWorkLock(nd, batch);
    return {
      batch,
      readyToArchive: batchIsDone(join(nd, 'todos', batch)),
      inWork: lock === null ? null : lock.state === 'invalid' ? 'unreadable' : lock.lock.state,
      todos: todos.filter((t) => t.batch === batch).map(({ todo, title, state }) => ({ todo, title, state })),
    };
  });
  const counts: Record<string, number> = {};
  for (const t of todos) counts[t.state] = (counts[t.state] ?? 0) + 1;
  const tasks = listTestTasks(nd).map((t) => ({ id: t.id, features: t.featureIds, scenarios: t.scenarios, revision: t.revision || 1, lastTested: t.lastTested || null, readyForReview: t.hasResults, results: t.results, todos: t.todoRefs }));
  const postponed = listFiles(join(nd, 'postponed')).filter((f) => f.endsWith('.md') && f !== 'README.md').map((file) => {
    const fm = readFrontmatter(join(nd, 'postponed', file)) ?? {};
    return { file, title: fm.title ?? null, doWhen: fm['do-when'] ?? null, discardIf: fm['discard-if'] ?? null };
  });
  const features: Record<string, number> = {};
  for (const f of listFeatures(nd)) features[f.status] = (features[f.status] ?? 0) + 1;
  let archived = 0;
  for (const year of listDirs(join(nd, 'archive'))) archived += listDirs(join(nd, 'archive', year)).length;
  return {
    inWork, batches, todoCounts: counts, totest: tasks, postponed,
    sparks: listFiles(join(nd, 'sparks')).filter((f) => f !== 'README.md').length,
    features, archivedBatches: archived,
  };
}

export function status(args: string[] = []): void {
  const root = requireProjectRoot();
  const nd = novadevDir(root);
  if (args.includes('--json')) {
    console.log(JSON.stringify(statusData(nd), null, 2));
    return;
  }

  // Is a work cycle on? The batches in work come first: who holds each lock, whether they are
  // still there, and where the work is — the one thing a person opening the project wants to know.
  const inWork = auditWork(nd);
  const locks = inWork.lines.length + inWork.problems.length;
  if (locks === 0) {
    console.log('in work — none (no batch is locked; `/novadev-work` takes a batch\'s lock when it starts)');
  } else {
    console.log(`in work — ${locks} batch(es)`);
    for (const line of inWork.lines) console.log(`  ${line}`);
    for (const problem of inWork.problems) console.log(`  ⚠ ${problem}`);
    if (inWork.waiting.length > 0) console.log(`  → a paused batch resumes with \`/novadev-work\`; it reads the PAUSED section of ${WORK_LOCK_FILE} first`);
    if (inWork.actions.length > 0) console.log(`  → an abandoned lock is resumed (\`novadev work start <batch>\`) or released (\`novadev work stop <batch>\`)`);
  }

  // Open batches.
  const batches = listDirs(join(nd, 'todos'));
  console.log(`\ntodos — ${batches.length} open batch(es)`);
  for (const batch of batches) {
    const batchDir = join(nd, 'todos', batch);
    const lock = readWorkLock(nd, batch);
    const mark =
      lock === null ? '' : lock.state === 'invalid' ? '  [lock unreadable]' : lock.lock.state === 'paused' ? '  [paused]' : '  [in work]';
    const done = batchIsDone(batchDir) ? '  [ready to archive]' : mark;
    console.log(`  ${batch}${done}`);
    for (const todo of listDirs(batchDir)) {
      const state = todoState(join(batchDir, todo));
      console.log(`    ${STATE_MARK[state]} ${todo}  (${state})`);
    }
  }
  if (batches.length === 0) console.log('  (none)');

  // The human-verification queue comes first — it is the only thing here that is
  // blocked on the person reading this.
  const tasks = listTestTasks(nd);
  if (tasks.length > 0) {
    const ready = tasks.filter((t) => t.hasResults);
    console.log(`\ntotest — ${tasks.length} awaiting YOU (${ready.length} ready for review)`);
    for (const t of tasks) {
      const state = t.hasResults ? 'READY FOR REVIEW' : 'needs your test';
      console.log(`  ${t.hasResults ? '◆' : '○'} ${t.id}  — ${state}, ${t.scenarios} scenario(s)`);
      if (t.todoRefs.length) console.log(`      todos: ${t.todoRefs.join(', ')}`);
    }
    if (ready.length > 0) console.log('  → run `/novadev-work` to close the loop');
  }

  // Postponed with triggers.
  const postponed = listFiles(join(nd, 'postponed')).filter(
    (f) => f.endsWith('.md') && f !== 'README.md',
  );
  console.log(`\npostponed — ${postponed.length} item(s)`);
  for (const file of postponed) {
    const fm = readFrontmatter(join(nd, 'postponed', file)) ?? {};
    console.log(`  ${file}: ${fm.title ?? '(no title)'}`);
    if (fm['do-when']) console.log(`      do-when: ${fm['do-when']}`);
  }

  // Sparks / memories / wiki / archive.
  const sparks = listFiles(join(nd, 'sparks')).filter((f) => f !== 'README.md');
  console.log(`\nsparks — ${sparks.length} file(s)`);

  // The knowledge bundle: what it holds, how much of it is trusted, what is due for a re-check.
  console.log(knowledgeStatusLine(nd));

  // Features by lifecycle state.
  const features = listFeatures(nd);
  if (features.length === 0) {
    console.log(
      existsSync(join(featuresDir(nd), 'index.md'))
        ? 'features — 0 entries'
        : 'features — MISSING (an agent must create it: skills/novadev-work.md (phase 9))',
    );
  } else {
    const counts = new Map<string, number>();
    for (const f of features) counts.set(f.status, (counts.get(f.status) ?? 0) + 1);
    const parts = FEATURE_STATUSES.filter((s) => counts.has(s)).map((s) => `${counts.get(s)} ${s}`);
    const unknown = features.filter((f) => !(FEATURE_STATUSES as readonly string[]).includes(f.status));
    if (unknown.length) parts.push(`${unknown.length} unknown-status`);
    console.log(`features — ${features.length} (${parts.join(', ')})`);
  }

  console.log(metricsStatusLine(nd));

  let archived = 0;
  for (const year of listDirs(join(nd, 'archive'))) {
    archived += listDirs(join(nd, 'archive', year)).length;
  }
  console.log(`archive — ${archived} batch(es)`);
}
