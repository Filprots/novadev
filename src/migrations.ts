// `novadev migrate-repo` — bring a deployed .novadev/ up to the installed layout.
//
// Each migration moves the tree from one version's shape to the next, and the runner
// applies every migration the repo has not reached yet, in order: a repo at 0.4.0
// upgrading to 0.6.0 runs 0.4.0→0.5.0 then 0.5.0→0.6.0. Migrations must be safe to
// re-run — they report "nothing to do" rather than failing when already applied.
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  FEATURE_DOC,
  LEGACY_ADAPTER_SLUGS,
  LEGACY_FEATURE_FILE_RE,
  LEGACY_SKILL_FILES,
  LEGACY_TEST_TASK_RE,
  NOVADEV_VERSION,
  RENAMED_ADAPTER_SLUGS,
  RENAMED_SKILL_FILES,
  TEST_HISTORY_DIR,
  TEST_PLAN_FILE,
  TEST_RESULTS_DIR,
  compareVersions,
  deployedVersion,
  featureIdsIn,
  featuresDir,
  listDirs,
  listFiles,
  novadevDir,
  readFrontmatter,
  readManifest,
  requireProjectRoot,
  setFrontmatter,
  todayStamp,
  totestDir,
  writeManifest,
} from './lib.ts';
import { METRICS_DIR, METRICS_SNAPSHOT } from './metrics.ts';

export type MigrationContext = { nd: string; dryRun: boolean; log: (line: string) => void };
export type Migration = {
  to: string;
  title: string;
  run(ctx: MigrationContext): void;
};

/** Ordered by target version. */
export const MIGRATIONS: Migration[] = [
  {
    to: '0.5.0',
    title: 'totest: date-stamped round folders → one living task per feature',
    run: migrateTotestNaming,
  },
  {
    to: '0.6.0',
    title: 'features become folders; archive namespaced into todos/ + totest/; test rounds archived',
    run: migrateFeatureFoldersAndArchive,
  },
  {
    to: '0.7.0',
    title: 'twelve playbooks collapse into the single novadev.md gateway skill',
    run: migrateToSingleSkill,
  },
  {
    to: '0.9.0',
    title: 'the gateway skill becomes /novadev-work, beside three novadev-* companion skills',
    run: migrateToFourSkills,
  },
  {
    to: '0.10.0',
    title: 'metrics hook + debt budget: novadev.json gains "metrics" and "debtBudget", both off until set',
    run: migrateMetricsSettings,
  },
];

export function migrateRepo(args: string[]): void {
  const dryRun = args.includes('--dry-run');
  const force = args.includes('--force');
  for (const a of args) {
    if (a !== '--dry-run' && a !== '--force') {
      console.error(`novadev: unknown option "${a}"\nusage: novadev migrate-repo [--dry-run] [--force]`);
      process.exit(1);
    }
  }

  const root = requireProjectRoot();
  const nd = novadevDir(root);
  const from = deployedVersion(nd);

  if (!from) {
    console.log(
      'migrate-repo: no version recorded in .novadev/novadev.json — run `novadev deploy` first.',
    );
    return;
  }
  if (compareVersions(from, NOVADEV_VERSION) > 0) {
    console.error(
      `novadev: this repo is at ${from}, newer than the installed novadev (${NOVADEV_VERSION}).\n` +
        '  Upgrade the install (git pull in the novadev clone) instead of migrating down.',
    );
    process.exit(1);
  }

  const pending = MIGRATIONS.filter((m) => compareVersions(from, m.to) < 0);
  if (pending.length === 0) {
    // No structural change between these versions — the layout is already current, so
    // just advance the stamp; leaving it behind would keep `novadev sync` blocked.
    if (compareVersions(from, NOVADEV_VERSION) < 0) {
      if (!dryRun) stampVersion(nd);
      console.log(
        `migrate-repo: layout is already current; ${dryRun ? 'would stamp' : 'stamped'} ${from} → ${NOVADEV_VERSION}.`,
      );
    } else {
      console.log(`migrate-repo: already at ${from} — nothing to migrate.`);
    }
    return;
  }

  console.log(`migrate-repo: ${from} → ${NOVADEV_VERSION}`);
  console.log(`  ${pending.length} migration(s) to apply: ${pending.map((m) => m.to).join(' → ')}`);

  // Migrations move folders wholesale; an unreviewable diff on top of uncommitted work
  // is how people lose things, so insist on a clean tree unless explicitly overridden.
  if (!dryRun && !force && isDirty(root)) {
    console.error(
      '\nnovadev: the working tree has uncommitted changes.\n' +
        '  Migrations move whole folders — commit or stash first so the migration is a\n' +
        '  reviewable diff on its own. Re-run with --force to override, or --dry-run to preview.',
    );
    process.exit(1);
  }

  let applied = 0;
  for (const migration of pending) {
    console.log(`\n▸ ${migration.to} — ${migration.title}`);
    const lines: string[] = [];
    migration.run({ nd, dryRun, log: (l) => lines.push(l) });
    if (lines.length === 0) {
      console.log('  (nothing to do)');
    } else {
      for (const line of lines) console.log(`  ${dryRun ? 'would ' : ''}${line}`);
      applied++;
    }
  }

  if (dryRun) {
    console.log('\ndry run — nothing was changed. Re-run without --dry-run to apply.');
    return;
  }

  stampVersion(nd);
  console.log(
    `\nmigrated to ${NOVADEV_VERSION}${applied === 0 ? ' (layout was already current)' : ''}.` +
      '\nNext: `novadev deploy` to refresh the playbooks, `novadev links --fix`, then' +
      '\n`novadev doctor` — and commit the move.',
  );
}

function isDirty(root: string): boolean {
  try {
    const out = execFileSync('git', ['status', '--porcelain'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim().length > 0;
  } catch {
    return false; // not a git repo — nothing to protect
  }
}

function stampVersion(nd: string): void {
  const path = join(nd, 'novadev.json');
  let manifest: Record<string, unknown> = { novadev: true };
  try {
    manifest = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    /* recreate it */
  }
  manifest.version = NOVADEV_VERSION;
  manifest.migratedAt = todayStamp();
  writeFileSync(path, JSON.stringify(manifest, null, 2) + '\n');
}

function move(ctx: MigrationContext, from: string, to: string, label: string): void {
  ctx.log(label);
  if (ctx.dryRun) return;
  mkdirSync(join(to, '..'), { recursive: true });
  renameSync(from, to);
}

// ---------------------------------------------------------------------------
// 0.4.0 → 0.5.0
// ---------------------------------------------------------------------------

/** `totest/2026-08-27_magic-link/` → `totest/FEAT-0007-magic-link/` (or the bare slug). */
function migrateTotestNaming(ctx: MigrationContext): void {
  const dir = totestDir(ctx.nd);
  for (const task of listDirs(dir)) {
    if (!LEGACY_TEST_TASK_RE.test(task)) continue;
    const planPath = join(dir, task, TEST_PLAN_FILE);
    const fm = existsSync(planPath) ? (readFrontmatter(planPath) ?? {}) : {};
    const slug = task.replace(LEGACY_TEST_TASK_RE, '');
    const featureId = featureIdsIn(fm.feature ?? '')[0];
    const target = featureId ? featureFolderFor(ctx.nd, featureId) || `${featureId}-${slug}` : slug;

    if (existsSync(join(dir, target))) {
      ctx.log(`SKIP totest/${task} — totest/${target} already exists; merge it by hand`);
      continue;
    }
    move(ctx, join(dir, task), join(dir, target), `rename totest/${task} → totest/${target}`);

    if (!ctx.dryRun && existsSync(join(dir, target, TEST_PLAN_FILE))) {
      const path = join(dir, target, TEST_PLAN_FILE);
      const text = readFileSync(path, 'utf8');
      const updates: Record<string, string> = { id: target };
      if (!fm.revision) updates.revision = '1';
      if (!fm.updated) updates.updated = fm.created ?? todayStamp();
      if (fm.todo !== undefined && fm.todos === undefined) updates.todos = fm.todo;
      writeFileSync(path, setFrontmatter(text, updates));
    }
  }
}

// ---------------------------------------------------------------------------
// 0.6.0 → 0.7.0
// ---------------------------------------------------------------------------

/** Delete the superseded playbooks and their slash-command adapters. */
function migrateToSingleSkill(ctx: MigrationContext): void {
  const skillsDir = join(ctx.nd, 'skills');
  for (const file of LEGACY_SKILL_FILES) {
    if (!existsSync(join(skillsDir, file))) continue;
    ctx.log(`delete skills/${file} (folded into the gateway playbook)`);
    if (!ctx.dryRun) rmSync(join(skillsDir, file));
  }
  const claudeSkills = join(ctx.nd, '..', '.claude', 'skills');
  for (const slug of LEGACY_ADAPTER_SLUGS) {
    if (!existsSync(join(claudeSkills, slug))) continue;
    ctx.log(`delete .claude/skills/${slug}/ (stale slash command)`);
    if (!ctx.dryRun) rmSync(join(claudeSkills, slug), { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// 0.8.0 → 0.9.0
// ---------------------------------------------------------------------------

/**
 * Remove the renamed playbook and its slash command. `novadev deploy` writes the four new ones;
 * this only clears what they replace, so a project does not end up carrying both `/novadev` (whose
 * canonical file is gone) and `/novadev-work`.
 */
function migrateToFourSkills(ctx: MigrationContext): void {
  const skillsDir = join(ctx.nd, 'skills');
  for (const file of RENAMED_SKILL_FILES) {
    if (!existsSync(join(skillsDir, file))) continue;
    ctx.log(`delete skills/${file} (renamed to skills/novadev-work.md)`);
    if (!ctx.dryRun) rmSync(join(skillsDir, file));
  }
  const claudeSkills = join(ctx.nd, '..', '.claude', 'skills');
  for (const slug of RENAMED_ADAPTER_SLUGS) {
    if (!existsSync(join(claudeSkills, slug))) continue;
    ctx.log(`delete .claude/skills/${slug}/ (renamed to novadev-work)`);
    if (!ctx.dryRun) rmSync(join(claudeSkills, slug), { recursive: true, force: true });
  }
  ctx.log('run `novadev deploy` to write the four novadev-* playbooks and their adapters');
}

// ---------------------------------------------------------------------------
// 0.9.0 → 0.10.0
// ---------------------------------------------------------------------------

/**
 * Two new opt-in settings, written as `null` — OFF — so the repo's novadev.json shows they exist
 * without changing what sync does: novadev cannot guess a project's metrics command or its debt
 * budget. The `metrics/` folder name becomes novadev's, so anything a project already kept there
 * is reported rather than silently mixed in with the snapshot.
 */
function migrateMetricsSettings(ctx: MigrationContext): void {
  const manifest = readManifest(ctx.nd);
  if (manifest !== null) {
    const missing = ['metrics', 'debtBudget'].filter((key) => !(key in manifest));
    if (missing.length > 0) {
      ctx.log(
        `add ${missing.map((key) => `"${key}": null`).join(' and ')} to novadev.json — off until you set ${missing.length === 1 ? 'it' : 'them'} (README, "Metrics and the debt budget")`,
      );
      if (!ctx.dryRun) {
        for (const key of missing) manifest[key] = null;
        writeManifest(ctx.nd, manifest);
      }
    }
  }
  const dir = join(ctx.nd, METRICS_DIR);
  const foreign = [
    ...listFiles(dir).filter((file) => file !== METRICS_SNAPSHOT && file !== 'README.md'),
    ...listDirs(dir).map((folder) => `${folder}/`),
  ];
  if (foreign.length > 0) {
    ctx.log(
      `SKIP .novadev/${METRICS_DIR}/ — it already holds ${foreign.join(', ')}; from 0.10.0 novadev keeps its metrics snapshot there, so move those to another folder`,
    );
  }
}

function featureFolderFor(nd: string, featureId: string): string | null {
  for (const folder of listDirs(featuresDir(nd))) {
    if (folder.startsWith(featureId + '-')) return folder;
  }
  for (const file of listFiles(featuresDir(nd))) {
    if (file.startsWith(featureId + '-') && file.endsWith('.md')) return file.replace(/\.md$/, '');
  }
  return null;
}

// ---------------------------------------------------------------------------
// 0.5.0 → 0.6.0
// ---------------------------------------------------------------------------

function migrateFeatureFoldersAndArchive(ctx: MigrationContext): void {
  featureFilesToFolders(ctx);
  namespaceArchive(ctx);
  archiveLegacyTestHistory(ctx);
  archiveReviewedTasks(ctx);
}

/** `features/FEAT-0007-magic-link.md` → `features/FEAT-0007-magic-link/feature.md`. */
function featureFilesToFolders(ctx: MigrationContext): void {
  const dir = featuresDir(ctx.nd);
  for (const file of listFiles(dir)) {
    if (!LEGACY_FEATURE_FILE_RE.test(file)) continue;
    const folder = file.replace(/\.md$/, '');
    if (existsSync(join(dir, folder))) {
      ctx.log(`SKIP features/${file} — features/${folder}/ already exists`);
      continue;
    }
    ctx.log(`move features/${file} → features/${folder}/${FEATURE_DOC}`);
    if (ctx.dryRun) continue;
    mkdirSync(join(dir, folder), { recursive: true });
    renameSync(join(dir, file), join(dir, folder, FEATURE_DOC));
  }
}

/** `archive/<year>/<batch>/` → `archive/<year>/todos/<batch>/`. */
function namespaceArchive(ctx: MigrationContext): void {
  for (const year of listDirs(join(ctx.nd, 'archive'))) {
    const yearDir = join(ctx.nd, 'archive', year);
    for (const entry of listDirs(yearDir)) {
      if (entry === 'todos' || entry === 'totest') continue;
      move(
        ctx,
        join(yearDir, entry),
        join(yearDir, 'todos', entry),
        `move archive/${year}/${entry} → archive/${year}/todos/${entry}`,
      );
    }
  }
}

/** `totest/<task>/history/<stamp>/` → `archive/<year>/totest/<task>/rev<N>-<stamp>/`. */
function archiveLegacyTestHistory(ctx: MigrationContext): void {
  const dir = totestDir(ctx.nd);
  for (const task of listDirs(dir)) {
    const historyDir = join(dir, task, TEST_HISTORY_DIR);
    if (!existsSync(historyDir)) continue;
    let rev = 1;
    for (const stamp of listDirs(historyDir)) {
      const year = /^(\d{4})/.exec(stamp)?.[1] ?? todayStamp().slice(0, 4);
      const round = `rev${rev++}-${/^\d{4}-\d{2}-\d{2}/.exec(stamp)?.[0] ?? todayStamp()}`;
      move(
        ctx,
        join(historyDir, stamp),
        join(ctx.nd, 'archive', year, 'totest', task, round),
        `move totest/${task}/${TEST_HISTORY_DIR}/${stamp} → archive/${year}/totest/${task}/${round}`,
      );
    }
    if (!ctx.dryRun && listDirs(historyDir).length === 0 && listFiles(historyDir).length === 0) {
      rmdirSync(historyDir);
    }
  }
}

/** A reviewed task is a finished round: archive it out so totest/ holds only open work. */
function archiveReviewedTasks(ctx: MigrationContext): void {
  const dir = totestDir(ctx.nd);
  for (const task of listDirs(dir)) {
    const planPath = join(dir, task, TEST_PLAN_FILE);
    if (!existsSync(planPath)) continue;
    const fm = readFrontmatter(planPath) ?? {};
    if (fm.status !== 'reviewed') continue;
    const date = (fm['last-tested'] || fm.updated || todayStamp()).slice(0, 10);
    const year = date.slice(0, 4);
    const round = `rev${Number(fm.revision ?? '') || 1}-${date}`;
    const dest = join(ctx.nd, 'archive', year, 'totest', task, round);
    if (existsSync(dest)) {
      ctx.log(`SKIP totest/${task} — ${dest.split('/.novadev/')[1]} already exists`);
      continue;
    }
    move(
      ctx,
      join(dir, task),
      dest,
      `archive reviewed totest/${task} → archive/${year}/totest/${task}/${round}`,
    );
    // The results guide belongs to the open-round inbox, not to a finished round.
    const guide = join(dest, TEST_RESULTS_DIR, 'README.md');
    if (!ctx.dryRun && existsSync(guide)) {
      try {
        renameSync(guide, join(dest, TEST_RESULTS_DIR, '.results-guide.md'));
      } catch {
        /* leave it */
      }
    }
  }
}
