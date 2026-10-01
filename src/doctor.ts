// `novadev doctor` — validate the structure; exit 1 when problems are found.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BATCH_RE,
  NOVADEV_VERSION,
  RECORD_COMPLETED,
  RECORD_CONFIRMED,
  RECORD_FAILED,
  RECORD_NEEDSTEST,
  RECORD_PROGRESS,
  SKILLS,
  LEGACY_TEST_TASK_RE,
  TEST_RESULTS_DIR,
  TEST_ROUND_RE,
  TEST_TASK_RE,
  WIKI_PAGES,
  compareVersions,
  deployedVersion,
  listDirs,
  listFiles,
  novadevDir,
  packageDir,
  readFrontmatter,
  requireProjectRoot,
} from './lib.ts';
import { auditLinks } from './links.ts';
import { auditMetrics } from './metrics-audit.ts';

export function doctor(): void {
  const root = requireProjectRoot();
  const nd = novadevDir(root);
  const problems: string[] = [];
  const notes: string[] = [];

  // --- todos: batch naming, briefs, records ---
  const todosDir = join(nd, 'todos');
  for (const batch of listDirs(todosDir)) {
    const batchDir = join(todosDir, batch);
    const m = BATCH_RE.exec(batch);
    if (!m) {
      problems.push(`todos/${batch}: batch name does not match YYYY-MM-DD_N`);
    } else if (existsSync(join(nd, 'archive', m[1], 'todos', batch))) {
      // Hand-created a batch whose number the archive already claimed — it can never
      // be archived, and two different batches now share one reference.
      const taken = new Set(
        [...listDirs(todosDir), ...listDirs(join(nd, 'archive', m[1], 'todos'))]
          .map((b) => BATCH_RE.exec(b))
          .filter((x) => x && x[0].startsWith(`${m[1]}-${m[2]}-${m[3]}_`))
          .map((x) => Number(x![4])),
      );
      let free = 1;
      while (taken.has(free)) free++;
      problems.push(
        `todos/${batch}: archive/${m[1]}/todos/${batch} already exists — this name is taken. Rename it to ${m[1]}-${m[2]}-${m[3]}_${free} (\`novadev new\` picks the free number for you)`,
      );
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
      // The human-verification gate: open XOR closed, and never without work behind it.
      if (files.includes(RECORD_NEEDSTEST) && files.includes(RECORD_CONFIRMED)) {
        problems.push(
          `todos/${batch}/${todo}: BOTH ${RECORD_NEEDSTEST} and ${RECORD_CONFIRMED} present — the review replaces the gate, delete ${RECORD_NEEDSTEST}`,
        );
      }
      if (
        files.includes(RECORD_NEEDSTEST) &&
        !files.includes(RECORD_COMPLETED) &&
        !files.includes(RECORD_PROGRESS)
      ) {
        problems.push(
          `todos/${batch}/${todo}: ${RECORD_NEEDSTEST} with no ${RECORD_COMPLETED}/${RECORD_PROGRESS} — say what was built before asking for it to be tested`,
        );
      }
      if (files.includes(RECORD_CONFIRMED) && !files.includes(RECORD_COMPLETED)) {
        problems.push(
          `todos/${batch}/${todo}: ${RECORD_CONFIRMED} with no ${RECORD_COMPLETED} — a confirmation needs the work record it confirms`,
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
    // 0.6.0 layout: archive/<year>/{todos,totest}/…
    for (const entry of listDirs(join(archiveDir, year))) {
      if (entry === 'totest') continue;
      if (entry !== 'todos') {
        problems.push(
          `archive/${year}/${entry}: pre-0.6.0 layout — batches belong in archive/${year}/todos/. Run \`novadev migrate-repo\``,
        );
        continue;
      }
      for (const batch of listDirs(join(archiveDir, year, 'todos'))) {
        const m = batch.match(BATCH_RE);
        if (!m) notes.push(`archive/${year}/todos/${batch}: batch name does not match YYYY-MM-DD_N`);
        else if (m[1] !== year) {
          problems.push(`archive/${year}/todos/${batch}: year mismatch with folder`);
        }
      }
    }
    for (const task of listDirs(join(archiveDir, year, 'totest'))) {
      for (const round of listDirs(join(archiveDir, year, 'totest', task))) {
        if (!TEST_ROUND_RE.test(round)) {
          notes.push(`archive/${year}/totest/${task}/${round}: round name is not rev<N>-<date>`);
        }
      }
    }
  }

  // --- totest: folder shape (the link/ref checks live in auditLinks) ---
  for (const task of listDirs(join(nd, 'totest'))) {
    const taskDir = join(nd, 'totest', task);
    if (LEGACY_TEST_TASK_RE.test(task)) {
      problems.push(
        `totest/${task}: date-stamped names are the old per-round model — rename this folder to the feature it tests (e.g. FEAT-0007-magic-link) and keep ONE living task per feature`,
      );
    } else if (!TEST_TASK_RE.test(task)) {
      problems.push(`totest/${task}: name must be <FEAT-NNNN->? <kebab-slug>, after the feature it tests`);
    }
    if (!existsSync(join(taskDir, TEST_RESULTS_DIR))) {
      problems.push(`totest/${task}: missing ${TEST_RESULTS_DIR}/ — the human has nowhere to report`);
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
    notes.push('wiki: MISSING — an agent must create it (skills/novadev-work.md (phase 9)) before todo work');
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
  const deployed = deployedVersion(nd);
  const deployedIsNewer = deployed !== null && compareVersions(deployed, NOVADEV_VERSION) > 0;
  if (deployedIsNewer) {
    problems.push(
      `novadev.json: deployed novadev (${deployed}) is newer than this install (${NOVADEV_VERSION}) — upgrade the install; do NOT run \`novadev deploy\` from it (that would downgrade the deployed skills)`,
    );
  } else if (deployed !== null && compareVersions(deployed, NOVADEV_VERSION) < 0) {
    problems.push(
      `novadev.json: repo is at ${deployed}, installed novadev is ${NOVADEV_VERSION} — run \`novadev migrate-repo\` (then \`novadev deploy\`)`,
    );
  }
  // Self-check: NOVADEV_VERSION and package.json must agree, or every deploy stamps
  // the wrong version into novadev.json and migrations pick the wrong starting point.
  try {
    const pkg = JSON.parse(readFileSync(join(packageDir(), 'package.json'), 'utf8'));
    if (pkg.version !== NOVADEV_VERSION) {
      problems.push(
        `installed novadev is inconsistent: package.json says ${pkg.version}, NOVADEV_VERSION says ${NOVADEV_VERSION} — fix the install`,
      );
    }
  } catch {
    /* not fatal — the package may be running from an unusual layout */
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

  // --- metrics: the settings, the stored snapshot, budget raises, the wiki budgets block ---
  // Judged from the files alone: doctor never runs the project's metrics command.
  const metricsAudit = auditMetrics(root);
  problems.push(...metricsAudit.problems);
  notes.push(...metricsAudit.notes);
  for (const fix of metricsAudit.fixes) {
    problems.push(`${fix.label} — run \`novadev sync\``);
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
    'totest',
    'skills',
    'metrics',
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
