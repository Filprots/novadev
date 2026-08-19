// `novadev new [slug…]` — scaffold today's next batch folder (+ optional todo folders).
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BATCH_RE, listDirs, novadevDir, requireProjectRoot, todayStamp } from './lib.ts';

export function newBatch(slugs: string[]): void {
  const root = requireProjectRoot();
  const todos = join(novadevDir(root), 'todos');
  const today = todayStamp();

  // A same-day batch that was already archived still claims its N — recreating
  // the name would make the new batch un-archivable (name collision in archive/).
  const archiveYear = join(novadevDir(root), 'archive', today.slice(0, 4));
  let maxN = 0;
  for (const name of [...listDirs(todos), ...listDirs(archiveYear)]) {
    const m = name.match(BATCH_RE);
    if (m && name.startsWith(today + '_')) maxN = Math.max(maxN, Number(m[4]));
  }
  const batch = `${today}_${maxN + 1}`;
  const batchDir = join(todos, batch);
  mkdirSync(batchDir, { recursive: true });

  const cleanSlugs = slugs.map((s, i) =>
    /^\d/.test(s) ? s : `${String(i + 1).padStart(2, '0')}-${s}`,
  );
  for (const slug of cleanSlugs) {
    const dir = join(batchDir, slug);
    mkdirSync(dir, { recursive: true });
    const brief = join(dir, 'prompt.txt');
    if (!existsSync(brief)) writeFileSync(brief, '');
  }

  console.log(`created ${batchDir.replace(root + '/', '')}/`);
  for (const slug of cleanSlugs) console.log(`  ${slug}/prompt.txt  (empty — write the brief)`);
  if (cleanSlugs.length === 0) {
    console.log('  (no todo folders yet — add <slug>/ folders with a brief inside)');
  }
}
