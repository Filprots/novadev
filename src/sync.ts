// `novadev sync` — the mechanical half of the novadev loop, in one call.
//
// Regenerate derived content, sweep everything finished into the archive, validate,
// then print NEXT ACTIONS: exactly what the agent still has to do and what is waiting
// on the human. The agent runs this after every round of work and acts on the list
// until it comes back clean — so nobody has to remember a sequence of commands.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sweepDone } from './archive.ts';
import {
  RECORD_NEEDSTEST,
  addDays,
  archiveGraceDays,
  batchCompletedOn,
  compareVersions,
  listDirs,
  readField,
  deployedVersion,
  listAllTodos,
  listFeatures,
  listFiles,
  listTestTasks,
  novadevDir,
  NOVADEV_VERSION,
  readFrontmatter,
  requireProjectRoot,
  todoState,
} from './lib.ts';
import { auditLinks } from './links.ts';

export function sync(args: string[]): void {
  const check = args.includes('--check');
  for (const a of args) {
    if (a !== '--check') {
      console.error(`novadev: unknown option "${a}"\nusage: novadev sync [--check]`);
      process.exit(1);
    }
  }

  const root = requireProjectRoot();
  const nd = novadevDir(root);

  // A repo on an older layout must migrate before anything else is trustworthy.
  const deployed = deployedVersion(nd);
  if (deployed && compareVersions(deployed, NOVADEV_VERSION) < 0) {
    console.log(`sync: repo is at ${deployed}, installed novadev is ${NOVADEV_VERSION}.`);
    console.log('  Run `novadev migrate-repo` (then `novadev deploy`) before syncing.');
    process.exit(1);
  }

  // 1. Derived content.
  const before = auditLinks(root);
  if (!check && before.fixes.length > 0) {
    for (const fix of before.fixes) writeFileSync(fix.path, fix.next);
    console.log(`derived: regenerated ${before.fixes.length} file(s)`);
  } else if (check && before.fixes.length > 0) {
    console.log(`derived: ${before.fixes.length} file(s) are stale`);
  }

  // 2. Archive whatever is finished.
  if (!check) {
    const moved = sweepDone(root);
    if (moved.length > 0) {
      console.log(`archived: ${moved.length} item(s)`);
      for (const m of moved) console.log(`  ${m}`);
    }
  }

  // 3. Validate what is left.
  const audit = auditLinks(root);
  if (audit.problems.length > 0) {
    console.log(`\nPROBLEMS (${audit.problems.length}):`);
    for (const p of audit.problems) console.log(`  ✗ ${p}`);
  }

  // Finished batches inside the grace window stay put on purpose — say so, or their
  // presence in todos/ reads as unfinished work.
  const grace = archiveGraceDays(nd);
  const holding = listDirs(join(nd, 'todos'))
    .map((b) => ({ b, on: batchCompletedOn(join(nd, 'todos', b)) }))
    .filter((x) => x.on !== null);
  if (holding.length > 0) {
    console.log(
      `\ncomplete, held in todos/ for ${grace} more day(s) so recent work stays visible:`,
    );
    for (const h of holding) {
      console.log(`  ✓ ${h.b} — done ${h.on}, archives ${addDays(h.on!, grace)}`);
    }
  }

  // 4. What still needs doing, split by who has to do it.
  const agent = agentActions(root, nd, audit.notes);
  const human = humanActions(nd);

  if (agent.length > 0) {
    console.log(`\nNEXT ACTIONS — you (${agent.length}):`);
    for (const a of agent) console.log(`  → ${a}`);
  }
  if (human.length > 0) {
    console.log(`\nWAITING ON THE HUMAN (${human.length}):`);
    for (const h of human) console.log(`  ⧗ ${h}`);
  }

  if (agent.length === 0 && audit.problems.length === 0) {
    console.log(
      human.length > 0
        ? '\nsync: clean — everything left is the human\'s to do.'
        : '\nsync: clean. ✓',
    );
  }
  if (audit.problems.length > 0 || (check && before.fixes.length > 0)) process.exit(1);
}

/** Work only an agent can do — the loop keeps running until this list is empty. */
function agentActions(root: string, nd: string, notes: string[]): string[] {
  const out: string[] = [];

  if (!existsSync(join(nd, 'wiki', 'INDEX.md'))) {
    out.push('wiki is MISSING — build it before any todo work (loop phase 9, "Building the wiki")');
  }
  if (!existsSync(join(nd, 'features', 'INDEX.md')) && listFeatures(nd).length === 0) {
    out.push(
      'features registry is MISSING — reverse-engineer it (loop phase 9, "Building the registry")',
    );
  }

  // Test rounds the human has already walked: reviewing them is the agent's job.
  for (const task of listTestTasks(nd)) {
    if (task.status !== 'reviewed' && task.hasResults) {
      out.push(
        `REVIEW totest/${task.id} — the human left results (${task.results.join(', ')}); judge them, close the gate, file follow-ups (loop phase 6)`,
      );
    }
  }

  for (const todo of listAllTodos(nd)) {
    if (todo.archived) continue;
    const state = todoState(todo.dir);
    if (state === 'open') out.push(`${todo.ref} has no record yet — do the work, then record it`);
    if (state === 'progress') out.push(`${todo.ref} is mid-flight — finish it or update ai_progress.md`);
  }

  // Anything the link audit found that a person has to decide.
  for (const note of notes) {
    if (note.includes('declares no **Feature:**')) {
      out.push(`${note.split(':')[0]} — link its record to a feature, or state "none — <why>"`);
    }
    if (note.includes('status "shipped"') || note.includes('status "planned"')) {
      out.push(`${note} (loop phase 7)`);
    }
    if (note.includes('is not in this repository')) out.push(note);
  }

  const postponed = listFiles(join(nd, 'postponed')).filter(
    (f) => f.endsWith('.md') && f !== 'README.md',
  );
  for (const file of postponed) {
    const fm = readFrontmatter(join(nd, 'postponed', file)) ?? {};
    if (fm['do-when']) {
      out.push(`postponed/${file}: check its trigger — "${fm['do-when']}"`);
    }
  }

  return out;
}

/** Work only the human can do — never something the agent should pre-empt. */
function humanActions(nd: string): string[] {
  const out: string[] = [];
  for (const task of listTestTasks(nd)) {
    if (task.status === 'reviewed' || task.hasResults) continue;
    const gated = task.todoRefs.length ? ` for ${task.todoRefs.join(', ')}` : '';
    out.push(
      `totest/${task.id} — ${task.scenarios} scenario(s) to walk${gated}; write what happens into its test-results/`,
    );
  }
  // A gate whose task does not exist is a broken hand-off, not something to wait on.
  const taskIds = new Set(listTestTasks(nd).map((t) => t.id));
  const orphaned = listAllTodos(nd).filter(
    (t) =>
      !t.archived &&
      existsSync(join(t.dir, RECORD_NEEDSTEST)) &&
      !taskIds.has(readField(readFileSync(join(t.dir, RECORD_NEEDSTEST), 'utf8'), 'Test') ?? ''),
  );
  for (const t of orphaned) {
    out.push(
      `${t.ref} is gated on human testing but its **Test:** task is missing from totest/ — see \`novadev links\``,
    );
  }
  return out;
}
