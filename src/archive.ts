// `novadev archive <batch>… | --done` — move fully-recorded batches into archive/<year>/.
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { auditLinks } from './links.ts';
import {
  BATCH_RE,
  batchIsDone,
  fail,
  listDirs,
  listTestTasks,
  novadevDir,
  requireProjectRoot,
  todayStamp,
} from './lib.ts';

/**
 * Archiving changes what the derived blocks say (a work line gains "· archived"), so
 * regenerate them here — otherwise every archive sweep leaves `novadev doctor` failing
 * until someone remembers to run `novadev links --fix` by hand.
 */
function regenerateDerived(root: string): void {
  const { fixes } = auditLinks(root);
  for (const fix of fixes) writeFileSync(fix.path, fix.next);
  if (fixes.length > 0) console.log(`regenerated ${fixes.length} derived file(s).`);
}

/** Move every reviewed test task out of the queue and into the archive as a round. */
function archiveReviewedRounds(nd: string): number {
  let count = 0;
  for (const task of listTestTasks(nd)) {
    if (task.status !== 'reviewed') continue;
    const date = (task.lastTested || task.fm.updated || todayStamp()).slice(0, 10);
    const year = date.slice(0, 4);
    const round = `rev${task.revision || 1}-${date}`;
    const dest = join(nd, 'archive', year, 'totest', task.id, round);
    if (existsSync(dest)) {
      fail(`archive already contains ${year}/totest/${task.id}/${round}`);
    }
    mkdirSync(join(dest, '..'), { recursive: true });
    renameSync(task.dir, dest);
    console.log(`archived totest/${task.id} → archive/${year}/totest/${task.id}/${round}`);
    count++;
  }
  return count;
}

export function archive(args: string[]): void {
  const root = requireProjectRoot();
  const nd = novadevDir(root);
  const todosDir = join(nd, 'todos');

  let targets: string[];
  let sweptRounds = 0;
  if (args.includes('--done')) {
    // A reviewed test task is a COMPLETED ROUND: move it out of the queue into
    // archive/<year>/totest/<task>/rev<N>-<date>/ with its plan and evidence intact.
    // Done before the batch sweep so it still runs when no batch is ready.
    sweptRounds = archiveReviewedRounds(nd);

    targets = listDirs(todosDir).filter((b) => batchIsDone(join(todosDir, b)));
    if (targets.length === 0) {
      if (sweptRounds > 0) {
        regenerateDerived(root);
        console.log('no fully-recorded batches to archive.\nremember to commit the move.');
      } else {
        console.log('no fully-recorded batches to archive.');
      }
      return;
    }
  } else if (args.length > 0) {
    targets = args;
  } else {
    fail('usage: novadev archive <batch>… | --done');
  }

  for (const batch of targets!) {
    const src = join(todosDir, batch);
    if (!existsSync(src)) fail(`batch not found: todos/${batch}`);
    const m = batch.match(BATCH_RE);
    if (!m) fail(`batch name "${batch}" does not match YYYY-MM-DD_N`);
    if (!batchIsDone(src)) {
      fail(
        `batch ${batch} is not fully recorded — every todo folder needs ai_completed.md or ai_failed.md (run \`novadev status\`).`,
      );
    }
    const destDir = join(nd, 'archive', m![1], 'todos');
    mkdirSync(destDir, { recursive: true });
    const dest = join(destDir, batch);
    if (existsSync(dest)) fail(`archive already contains ${m![1]}/todos/${batch}`);
    renameSync(src, dest);
    console.log(`archived todos/${batch} → archive/${m![1]}/todos/${batch}`);
  }
  regenerateDerived(root);
  console.log('remember to commit the move.');
}
