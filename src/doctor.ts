// `novadev doctor` — validate the structure; exit 1 when problems are found.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BATCH_RE,
  NOVADEV_VERSION,
  RECORD_COMPLETED,
  RECORD_FAILED,
  RECORD_PROGRESS,
  SKILLS,
  WIKI_PAGES,
  listDirs,
  listFiles,
  novadevDir,
  packageDir,
  readFrontmatter,
  requireProjectRoot,
} from './lib.ts';
import { auditLinks } from './links.ts';

export function doctor(): void {
  const root = requireProjectRoot();
  const nd = novadevDir(root);
  const problems: string[] = [];
  const notes: string[] = [];

  // --- todos: batch naming, briefs, records ---
  const todosDir = join(nd, 'todos');
  for (const batch of listDirs(todosDir)) {
    const batchDir = join(todosDir, batch);
    if (!BATCH_RE.test(batch)) {
      problems.push(`todos/${batch}: batch name does not match YYYY-MM-DD_N`);
    }
    for (const todo of listDirs(batchDir)) {
      const todoDir = join(batchDir, todo);
      const files = listFiles(todoDir);
      const hasBrief = files.some(
        (f) => (f.endsWith('.txt') || f.endsWith('.md')) && !f.startsWith('ai_'),
      );
      if (!hasBrief) problems.push(`todos/${batch}/${todo}: no brief (.txt/.md) file`);
      const emptyBriefs = files.filter(
        (f) =>
          (f.endsWith('.txt') || f.endsWith('.md')) &&
          !f.startsWith('ai_') &&
          readFileSync(join(todoDir, f), 'utf8').trim() === '',
      );
      for (const f of emptyBriefs) notes.push(`todos/${batch}/${todo}/${f}: brief is empty`);
      if (files.includes(RECORD_COMPLETED) && files.includes(RECORD_FAILED)) {
        problems.push(
          `todos/${batch}/${todo}: BOTH ${RECORD_COMPLETED} and ${RECORD_FAILED} present — keep one`,
        );
      }
      if (
        files.includes(RECORD_PROGRESS) &&
        (files.includes(RECORD_COMPLETED) || files.includes(RECORD_FAILED))
      ) {
        problems.push(
          `todos/${batch}/${todo}: stale ${RECORD_PROGRESS} beside a terminal record — delete it (the record replaces it)`,
        );
      }
    }
  }

  // --- archive: year grouping + naming ---
  const archiveDir = join(nd, 'archive');
  for (const year of listDirs(archiveDir)) {
    if (!/^\d{4}$/.test(year)) {
      problems.push(`archive/${year}: expected a YYYY year folder`);
      continue;
    }
    for (const batch of listDirs(join(archiveDir, year))) {
      const m = batch.match(BATCH_RE);
      if (!m) notes.push(`archive/${year}/${batch}: batch name does not match YYYY-MM-DD_N`);
      else if (m[1] !== year) problems.push(`archive/${year}/${batch}: year mismatch with folder`);
    }
  }

  // --- postponed: frontmatter contract ---
  const postponedDir = join(nd, 'postponed');
  for (const file of listFiles(postponedDir)) {
    if (!file.endsWith('.md') || file === 'README.md') continue;
    const fm = readFrontmatter(join(postponedDir, file));
    if (!fm) problems.push(`postponed/${file}: missing frontmatter header`);
    else {
      for (const key of ['title', 'do-when', 'discard-if']) {
        if (!fm[key]) problems.push(`postponed/${file}: frontmatter missing "${key}"`);
      }
    }
  }

  // --- memories: frontmatter + INDEX sync ---
  const memoriesDir = join(nd, 'memories');
  const memoryFiles = listFiles(memoriesDir).filter(
    (f) => f.endsWith('.md') && f !== 'INDEX.md' && f !== 'README.md',
  );
  const indexPath = join(memoriesDir, 'INDEX.md');
  const indexText = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : '';
  if (!existsSync(indexPath)) problems.push('memories/INDEX.md: missing');
  for (const file of memoryFiles) {
    const fm = readFrontmatter(join(memoriesDir, file));
    if (!fm) problems.push(`memories/${file}: missing frontmatter header`);
    else {
      for (const key of ['title', 'created', 'kind']) {
        if (!fm[key]) problems.push(`memories/${file}: frontmatter missing "${key}"`);
      }
    }
    if (indexText && !indexText.includes(file)) {
      problems.push(`memories/INDEX.md: no pointer line for ${file}`);
    }
  }

  // --- wiki: page set + index sync ---
  const wikiDir = join(nd, 'wiki');
  if (!existsSync(join(wikiDir, 'INDEX.md'))) {
    notes.push('wiki: MISSING — an agent must create it (skills/wiki-init.md) before todo work');
  } else {
    for (const page of WIKI_PAGES) {
      if (!existsSync(join(wikiDir, page))) problems.push(`wiki/${page}: missing (strict page set)`);
    }
    const wikiIndex = readFileSync(join(wikiDir, 'INDEX.md'), 'utf8');
    for (const page of listFiles(wikiDir)) {
      if (!page.endsWith('.md') || page === 'INDEX.md' || page === 'README.md') continue;
      if (!wikiIndex.includes(page)) problems.push(`wiki/INDEX.md: no line for ${page}`);
    }
  }

  // --- skills: canonical files present + in sync with the installed novadev ---
  // Direction matters: when the DEPLOYED novadev is newer than this install,
  // `novadev deploy` would downgrade the project's skills — prescribe an upgrade instead.
  const deployedIsNewer = (() => {
    try {
      const manifest = JSON.parse(readFileSync(join(nd, 'novadev.json'), 'utf8'));
      if (typeof manifest.version !== 'string') return false;
      const a = manifest.version.split('.').map(Number);
      const b = NOVADEV_VERSION.split('.').map(Number);
      for (let i = 0; i < 3; i++) {
        if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
      }
      return false;
    } catch {
      return false;
    }
  })();
  if (deployedIsNewer) {
    problems.push(
      `novadev.json: deployed novadev is newer than this install (${NOVADEV_VERSION}) — upgrade the install; do NOT run \`novadev deploy\` from it (that would downgrade the deployed skills)`,
    );
  }
  const skillsDir = join(nd, 'skills');
  const templates = join(packageDir(), 'templates', 'skills');
  for (const skill of SKILLS) {
    const deployed = join(skillsDir, skill.file);
    if (!existsSync(deployed)) {
      problems.push(`skills/${skill.file}: missing — run \`novadev deploy\``);
    } else if (
      !deployedIsNewer &&
      existsSync(join(templates, skill.file)) &&
      readFileSync(deployed, 'utf8') !== readFileSync(join(templates, skill.file), 'utf8')
    ) {
      problems.push(`skills/${skill.file}: differs from installed novadev — run \`novadev deploy\``);
    }
    const adapter = join(root, '.claude', 'skills', skill.slug, 'SKILL.md');
    if (!existsSync(adapter)) notes.push(`.claude/skills/${skill.slug}: adapter missing — run \`novadev deploy\``);
  }

  // --- features + the link graph (shared with `novadev links`) ---
  const audit = auditLinks(root);
  problems.push(...audit.problems);
  notes.push(...audit.notes);
  for (const fix of audit.fixes) {
    problems.push(`${fix.label} — run \`novadev links --fix\``);
  }

  // --- unknown top-level folders: tolerated, but surfaced ---
  const known = new Set([
    'todos',
    'archive',
    'postponed',
    'sparks',
    'wiki',
    'memories',
    'features',
    'skills',
  ]);
  for (const dir of listDirs(nd)) {
    if (!known.has(dir)) notes.push(`.novadev/${dir}/: not a novadev folder (tolerated)`);
  }

  // --- report ---
  if (problems.length === 0 && notes.length === 0) {
    console.log('doctor: structure is healthy.');
    return;
  }
  if (problems.length > 0) {
    console.log(`PROBLEMS (${problems.length}):`);
    for (const p of problems) console.log(`  ✗ ${p}`);
  }
  if (notes.length > 0) {
    console.log(`notes (${notes.length}):`);
    for (const n of notes) console.log(`  · ${n}`);
  }
  if (problems.length > 0) process.exit(1);
}
