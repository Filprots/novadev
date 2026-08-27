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

export function archive(args: string[]): void {
  const root = requireProjectRoot();
  const nd = novadevDir(root);
  const todosDir = join(nd, 'todos');

  let targets: string[];
  let sweptTests = 0;
  if (args.includes('--done')) {
    // Reviewed test tasks archive alongside the batches; an open one stays put so the
    // human's queue keeps showing it. Done first so it still happens when no batch is ready.
    for (const task of listTestTasks(nd)) {
      if (task.status !== 'reviewed') continue;
      const year = task.id.slice(0, 4);
      const destDir = join(nd, 'archive', year, 'totest');
      mkdirSync(destDir, { recursive: true });
      const dest = join(destDir, task.id);
      if (existsSync(dest)) fail(`archive already contains ${year}/totest/${task.id}`);
      renameSync(task.dir, dest);
      console.log(`archived totest/${task.id} → archive/${year}/totest/${task.id}`);
      sweptTests++;
    }

    targets = listDirs(todosDir).filter((b) => batchIsDone(join(todosDir, b)));
    if (targets.length === 0) {
      if (sweptTests > 0) {
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
    const destDir = join(nd, 'archive', m![1]);
    mkdirSync(destDir, { recursive: true });
    const dest = join(destDir, batch);
    if (existsSync(dest)) fail(`archive already contains ${m![1]}/${batch}`);
    renameSync(src, dest);
    console.log(`archived todos/${batch} → archive/${m![1]}/${batch}`);
  }
  regenerateDerived(root);
  console.log('remember to commit the move.');
}
