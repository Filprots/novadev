// `novadev status` — stock-take of the novadev tree without an agent.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FEATURE_STATUSES,
  batchIsDone,
  listDirs,
  listFeatures,
  listFiles,
  novadevDir,
  readFrontmatter,
  requireProjectRoot,
  todoState,
} from './lib.ts';

const STATE_MARK = { completed: '✓', failed: '✗', progress: '…', open: '·' } as const;

export function status(): void {
  const root = requireProjectRoot();
  const nd = novadevDir(root);

  // Open batches.
  const batches = listDirs(join(nd, 'todos'));
  console.log(`todos — ${batches.length} open batch(es)`);
  for (const batch of batches) {
    const batchDir = join(nd, 'todos', batch);
    const done = batchIsDone(batchDir) ? '  [ready to archive]' : '';
    console.log(`  ${batch}${done}`);
    for (const todo of listDirs(batchDir)) {
      const state = todoState(join(batchDir, todo));
      console.log(`    ${STATE_MARK[state]} ${todo}  (${state})`);
    }
  }
  if (batches.length === 0) console.log('  (none)');

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

  const memories = listFiles(join(nd, 'memories')).filter(
    (f) => f.endsWith('.md') && f !== 'INDEX.md' && f !== 'README.md',
  );
  console.log(`memories — ${memories.length} memory file(s)`);

  // Features by lifecycle state.
  const features = listFeatures(nd);
  if (features.length === 0) {
    console.log(
      existsSync(join(nd, 'features', 'INDEX.md'))
        ? 'features — 0 entries'
        : 'features — MISSING (an agent must create it: skills/feature-init.md)',
    );
  } else {
    const counts = new Map<string, number>();
    for (const f of features) counts.set(f.status, (counts.get(f.status) ?? 0) + 1);
    const parts = FEATURE_STATUSES.filter((s) => counts.has(s)).map((s) => `${counts.get(s)} ${s}`);
    const unknown = features.filter((f) => !(FEATURE_STATUSES as readonly string[]).includes(f.status));
    if (unknown.length) parts.push(`${unknown.length} unknown-status`);
    console.log(`features — ${features.length} (${parts.join(', ')})`);
  }

  const wikiIndex = join(nd, 'wiki', 'INDEX.md');
  if (existsSync(wikiIndex)) {
    const pages = listFiles(join(nd, 'wiki')).filter(
      (f) => f.endsWith('.md') && f !== 'README.md',
    );
    console.log(`wiki — ${pages.length} page(s)`);
  } else {
    console.log('wiki — MISSING (an agent must create it: skills/wiki-init.md)');
  }

  let archived = 0;
  for (const year of listDirs(join(nd, 'archive'))) {
    archived += listDirs(join(nd, 'archive', year)).length;
  }
  console.log(`archive — ${archived} batch(es)`);
}
