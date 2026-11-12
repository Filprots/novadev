// `novadev status` — stock-take of the novadev tree without an agent.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
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
  readManifest,
  requireProjectRoot,
  todoState,
} from './lib.ts';
import { sharedClaims } from './claim-policy.ts';
import { worktreeList } from './git.ts';
import { queueLockHolder, queueOrder, readQueue } from './queue.ts';
import { type WipHolder, parseWipSettings, wipHolders } from './wip.ts';
import { ruleRoot } from './claim-policy.ts';
import { metricsStatusLine } from './metrics-audit.ts';
import { batchesInWorkElsewhere, insideWorktree, lockRef, registryLocks } from './registry.ts';
import { stateText, todosInOrder, usesLinks } from './todo.ts';
import { batchesByPriority } from './todo-meta.ts';
import { type TodoHolder, auditWork, batchWorkLocks, holderNote, latestLine, listWorkLocks, lockLiveness, phaseLabel, todoHolders } from './work.ts';

const STATE_MARK = {
  confirmed: '✓✓',
  completed: '✓',
  needstest: '⧗',
  changes: '↺',
  review: '◇',
  unmerged: '⇢',
  failed: '✗',
  progress: '…',
  open: '·',
} as const;

/**
 * `novadev status --json`: the same stock-take as data, for a tool that answers a person away from the repository
 * (a chat bot): the batches in work with their holder and newest waypoint, every open todo with its title and state,
 * the human-test queue, postponed items, and the counts.
 */
/**
 * The repository's worktrees (git worktree list), each with its branch and the locks held there —
 * a todo's (`unit: "todo"`, `ref` names it) or a batch's — from the registry (registry.ts); this
 * worktree's own from its files. Null outside git.
 */
/**
 * Work in progress per holder against the project's limit ("wipLimit"); `limit` null = no limit
 * set — the counts are still true. An unreadable setting counts as no limit here (sync names it).
 */
export function wipData(nd: string, holders: ReadonlyMap<string, TodoHolder>): { limit: number | null; countsPaused: boolean; holders: WipHolder[] } {
  const parsed = parseWipSettings(readManifest(novadevDir(ruleRoot(dirname(nd)))));
  const settings = parsed.ok ? parsed.value : { limit: null, countsPaused: true };
  return { limit: settings.limit, countsPaused: settings.countsPaused, holders: wipHolders(nd, settings, holders) };
}

/** The merge queue as `status` shows it: in running order, then the failed ones. */
export function mergeQueueData(nd: string): { running: string | null; entries: { name: string; state: 'queued' | 'failed'; position: number | null; express: boolean; reason: string | null }[] } {
  const root = dirname(nd);
  const queue = readQueue(root);
  return {
    running: queueLockHolder(root)?.what ?? null,
    entries: [
      ...queueOrder(queue).map((e, i) => ({ name: e.name, state: e.state, position: i + 1, express: e.express, reason: null })),
      ...queue.filter((e) => e.state === 'failed').map((e) => ({ name: e.name, state: e.state, position: null, express: e.express, reason: e.reason ?? null })),
    ],
  };
}

export function worktreesData(nd: string): { path: string; branch: string | null; current: boolean; main: boolean; batches: { batch: string; unit: 'batch' | 'todo'; ref: string; state: string; agent: string; claims: string[]; covers: string[] | null }[] }[] | null {
  const root = dirname(nd);
  const list = worktreeList(root);
  if (list === null) return null;
  const registry = registryLocks(root);
  // A project root belongs to the deepest worktree top that holds it (a worktree may sit inside the
  // main checkout's folder).
  const tops = list.filter((w) => !w.bare).map((w) => w.path).sort((a, b) => b.length - a.length);
  const topOf = (path: string) => tops.find((top) => insideWorktree(path, top)) ?? null;
  const here = topOf(root);
  return list
    .filter((w) => !w.bare)
    .map((w) => {
      const current = here === w.path;
      const batches = current
        ? listWorkLocks(nd).flatMap((read) => (read.state === 'ok' ? [{ batch: read.batch, unit: read.lock.unit, ref: lockRef(read.lock), state: read.lock.state, agent: read.lock.agent, claims: read.lock.claims, covers: read.lock.covers }] : []))
        : registry.filter((lock) => topOf(lock.worktree) === w.path).map((lock) => ({ batch: lock.batch, unit: lock.unit, ref: lockRef(lock), state: lock.state, agent: lock.agent, claims: lock.claims, covers: lock.covers }));
      return { path: w.path, branch: w.branch, current, main: w.main, batches };
    });
}

export function statusData(nd: string, now: Date = new Date()): Record<string, unknown> {
  // One entry per lock: a todo's (`unit: "todo"`, `ref` is `<batch>/<todo>`) or a batch's (`ref` is the batch).
  const inWork = listWorkLocks(nd).map((read) => {
    const ref = read.todo === null ? read.batch : `${read.batch}/${read.todo}`;
    if (read.state === 'invalid') return { batch: read.batch, ref, state: 'unreadable', error: read.error };
    const lock = read.lock;
    const live = lockLiveness(lock, now);
    return {
      batch: read.batch, ref, unit: lock.unit, state: lock.state, live: live.live, liveness: live.reason, minutesSinceUpdate: live.ageMinutes,
      agent: lock.agent, host: lock.host, started: lock.started, updated: lock.updated, resumed: lock.resumed,
      covers: lock.covers, todo: lock.todo, phase: lock.phase, phaseLabel: lock.phase === null ? null : phaseLabel(lock.phase),
      latest: latestLine(lock), entries: lock.entries.length,
    };
  });
  // By priority (todo-meta.ts): urgent first, then the filing order — the todos, and the batches by their best open todo.
  const todos = todosInOrder(nd);
  // Per todo, who holds it — here or in another worktree — and where it stopped; a batch is in work
  // while any todo of it is.
  const holders = todoHolders(nd, now);
  const elsewhere = batchesInWorkElsewhere(dirname(nd));
  const batches = batchesByPriority(join(nd, 'todos'), todoState).map((batch) => {
    return {
      batch,
      readyToArchive: batchIsDone(join(nd, 'todos', batch)),
      inWork: batchInWork(nd, batch),
      inWorkElsewhere: elsewhere.has(batch),
      todos: todos.filter((t) => t.batch === batch).map(({ todo, title, state, priority, after, waitsFor, ready, suggestedOwner }) => ({ todo, title, state, priority, after, waitsFor, ready, ...(suggestedOwner !== undefined ? { suggestedOwner } : {}), holder: holderData(holders.get(`${batch}/${todo}`)) })),
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
    inWork, worktrees: worktreesData(nd), wip: wipData(nd, holders), mergeQueue: mergeQueueData(nd), sharedClaims: sharedClaims(dirname(nd)).map((s) => ({ path: s.path, between: s.between })), batches, todoCounts: counts, totest: tasks, postponed,
    sparks: listFiles(join(nd, 'sparks')).filter((f) => f !== 'README.md').length,
    features, archivedBatches: archived,
  };
}

/**
 * What the locks THIS worktree carries in a batch say: `unreadable` when one cannot be read, else
 * `working` while any is, else `paused`; null when it carries none.
 */
function batchInWork(nd: string, batch: string): 'unreadable' | 'working' | 'paused' | null {
  const locks = batchWorkLocks(nd, batch);
  if (locks.length === 0) return null;
  if (locks.some((read) => read.state === 'invalid')) return 'unreadable';
  return locks.some((read) => read.state === 'ok' && read.lock.state === 'working') ? 'working' : 'paused';
}

/** A todo's holder for `status --json`: who, where, in which state, and where the work stopped; null when nobody holds it. */
function holderData(holder: TodoHolder | undefined): Record<string, unknown> | null {
  if (holder === undefined) return null;
  const { phase, ...rest } = holder;
  return { ...rest, here: holder.worktree === null, phase, phaseLabel: phase === null ? null : phaseLabel(phase) };
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
    console.log('in work — none (nothing is locked; `/novadev-work` takes the lock of the todo it starts on)');
  } else {
    // Counted as what is locked: todos, and batches locked as a whole (or by a 0.17.0 lock).
    const counted = [inWork.todoLocks > 0 ? `${inWork.todoLocks} todo(s)` : '', locks > inWork.todoLocks ? `${locks - inWork.todoLocks} batch(es)` : ''].filter(Boolean);
    console.log(`in work — ${counted.join(', ')}`);
    for (const line of inWork.lines) console.log(`  ${line}`);
    for (const problem of inWork.problems) console.log(`  ⚠ ${problem}`);
    const unit = inWork.todoLocks > 0 ? 'todo' : 'batch';
    if (inWork.waiting.length > 0) console.log(`  → a paused ${unit} resumes with \`/novadev-work\`; it reads the PAUSED section of ${unit === 'todo' ? 'its ' : ''}${WORK_LOCK_FILE} first`);
    if (inWork.actions.length > 0) console.log(`  → an abandoned lock is resumed (\`novadev work start <${unit === 'todo' ? 'batch>/<todo' : 'batch'}>\`) or released (\`novadev work stop <${unit === 'todo' ? 'batch>/<todo' : 'batch'}>\`)`);
  }

  // The repository's worktrees, when it has more than one: which branch each is on, and which
  // batch is in work there — the registry every worktree shares says so.
  const worktrees = worktreesData(nd);
  if (worktrees !== null && worktrees.length > 1) {
    console.log(`\nworktrees — ${worktrees.length} (* = this one)`);
    for (const w of worktrees) {
      const batches = w.batches.map((b) => `${b.ref}${b.unit === 'todo' || b.covers === null ? '' : ` (todos ${b.covers.join(', ')})`} ${b.state === 'paused' ? 'PAUSED' : 'in work'} (${b.agent})${b.claims.length > 0 ? `, claims ${b.claims.join(', ')}` : ''}`);
      console.log(`  ${w.current ? '*' : ' '} ${w.path}  ${w.branch ?? '(detached)'}${w.main ? '  [main checkout]' : ''}${batches.length > 0 ? ` — ${batches.join('; ')}` : ''}`);
    }
  }

  // Paths two worktrees both claim (a notice under "claims": "notice", an allowed overlap otherwise).
  const shared = sharedClaims(dirname(nd));
  if (shared.length > 0) {
    console.log(`\nshared claims — ${shared.length} (two worktrees in one path; the merge checks the combination)`);
    for (const s of shared.slice(0, 20)) console.log(`  ${s.path} — ${s.between[0]} and ${s.between[1]}`);
    if (shared.length > 20) console.log(`  … +${shared.length - 20}`);
  }

  // Work in progress against the limit, when the project set one.
  const wip = wipData(nd, todoHolders(nd));
  if (wip.limit !== null && wip.holders.length > 0) {
    console.log(`\nwork in progress — limit ${wip.limit} todo(s) per holder${wip.countsPaused ? ', paused ones count' : ', paused ones do not count'}`);
    for (const h of wip.holders) {
      console.log(`  ${h.agent}  ${h.count}/${wip.limit}${h.atLimit ? '  AT THE LIMIT' : ''}${h.todos.length > 0 ? `  ${h.todos.join(', ')}` : ''}${h.urgent.length > 0 ? `  + urgent (exempt): ${h.urgent.join(', ')}` : ''}${h.pausedNotCounted.length > 0 ? `  + paused: ${h.pausedNotCounted.join(', ')}` : ''}`);
    }
  }

  // The merge queue: what lands next, and what went back to its builder.
  const queue = mergeQueueData(nd);
  if (queue.entries.length > 0 || queue.running !== null) {
    console.log(`\nmerge queue — ${queue.entries.filter((e) => e.state === 'queued').length} waiting, ${queue.entries.filter((e) => e.state === 'failed').length} failed${queue.running !== null ? ` — running now: ${queue.running}` : ''}`);
    for (const e of queue.entries) console.log(e.state === 'queued' ? `  ${e.position}. ${e.name}${e.express ? ' [express]' : ''}` : `  ✗ ${e.name} — ${e.reason ?? 'failed'}`);
  }

  // Open batches — by priority (todo-meta.ts): a batch with an urgent todo to do first, and in a batch the urgent todo first.
  // Each todo says what it waits for ("do after" links, todo-links.ts), or that it is ready, once any todo has a link.
  // Per todo: its state, then who holds it and in which phase — a todo's own lock, here or in another
  // worktree, or a 0.17.0 lock on part of the batch. (A lock on the WHOLE batch is the batch's mark.)
  const holders = todoHolders(nd);
  const batches = batchesByPriority(join(nd, 'todos'), todoState);
  const listed = todosInOrder(nd);
  const showReady = usesLinks(listed);
  console.log(`\ntodos — ${batches.length} open batch(es)`);
  for (const batch of batches) {
    const batchDir = join(nd, 'todos', batch);
    const names = listDirs(batchDir);
    const held = names.flatMap((todo) => holders.get(`${batch}/${todo}`) ?? []);
    // One lock on the whole batch holds every todo of it: the batch's mark says so, once.
    const whole = held.length === names.length && held.every((h) => h.unit === 'batch' && h.worktree === held[0]!.worktree);
    const here = batchInWork(nd, batch);
    const mark =
      here === 'unreadable'
        ? '  [lock unreadable]'
        : held.length === 0
          ? here === null ? '' : here === 'paused' ? '  [paused]' : '  [in work]'
          : held.some((h) => h.state === 'working') ? '  [in work]' : '  [paused]';
    const done = batchIsDone(batchDir) ? '  [ready to archive]' : mark;
    console.log(`  ${batch}${done}`);
    for (const t of listed.filter((item) => item.batch === batch)) {
      console.log(`    ${STATE_MARK[t.state]} ${t.todo}  ${stateText(t, showReady)}${whole ? '' : holderNote(holders.get(`${batch}/${t.todo}`))}`);
      if (t.priority === 'urgent') {
        const pausedFor = [...holders].filter(([, h]) => h.state === 'paused' && (h.latest ?? '').startsWith('Paused for the urgent todo') && (h.latest ?? '').includes(t.ref)).map(([ref, h]) => `${ref} (${h.agent})`);
        if (pausedFor.length > 0) console.log(`        paused for it: ${pausedFor.join(', ')}`);
      }
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
