// `novadev links` — validate the novadev link graph; `--fix` regenerates derived content.
//
// The graph only stays true because each edge has ONE authored direction and one
// derived direction. Authored (by an agent, in prose): a record/brief's
// `**Feature:**` and `**Commits:**` lines. Derived (regenerated here): every
// feature's `## Work` / `## Commits` blocks and `features/INDEX.md`. Nothing has to
// be updated in two places, so backlinks cannot silently rot.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type Feature,
  FEATURE_FILE_RE,
  FEATURE_ID_RE,
  FEATURE_REF_KEYS,
  FEATURE_REQUIRED_KEYS,
  FEATURE_STATUSES,
  RECORD_CONFIRMED,
  RECORD_NEEDSTEST,
  TEST_PLAN_FILE,
  TEST_PLAN_REQUIRED_KEYS,
  TEST_STATUSES,
  type TodoRef,
  blockBegin,
  blockEnd,
  commitHashesIn,
  featureIdsIn,
  featuresDir,
  listAllTodos,
  listFeatures,
  listFiles,
  listTestTasks,
  novadevDir,
  readBlock,
  readField,
  readFrontmatter,
  requireProjectRoot,
  todoState,
  writeBlock,
} from './lib.ts';

export type Fix = { path: string; label: string; next: string };
export type Audit = { problems: string[]; notes: string[]; fixes: Fix[] };

type TodoLinks = {
  todo: TodoRef;
  state: string;
  date: string;
  featureIds: string[];
  commits: string[];
  hasFeatureField: boolean;
  hasRecord: boolean;
  /** The `**Test:**` ref inside ai_needstest.md / ai_confirmed.md, when present. */
  testRef: string;
};

export function auditLinks(root: string): Audit {
  const nd = novadevDir(root);
  const problems: string[] = [];
  const notes: string[] = [];
  const fixes: Fix[] = [];

  const features = listFeatures(nd);
  const byId = new Map<string, Feature>();
  for (const f of features) {
    if (byId.has(f.id)) {
      problems.push(`features/${f.file}: duplicate id ${f.id} (also ${byId.get(f.id)!.file})`);
      continue;
    }
    byId.set(f.id, f);
  }

  // --- feature files: naming, frontmatter, cross-references ---
  for (const f of features) {
    const m = f.file.match(FEATURE_FILE_RE);
    if (!m) {
      problems.push(`features/${f.file}: name must be FEAT-NNNN-<kebab-slug>.md`);
    } else if (f.fm.id && m[1] !== f.fm.id) {
      problems.push(`features/${f.file}: filename id ${m[1]} does not match frontmatter id ${f.fm.id}`);
    }
    if (!readFrontmatter(f.path)) {
      problems.push(`features/${f.file}: missing frontmatter header`);
      continue;
    }
    for (const key of FEATURE_REQUIRED_KEYS) {
      if (!f.fm[key]) problems.push(`features/${f.file}: frontmatter missing "${key}"`);
    }
    if (f.fm.id && !FEATURE_ID_RE.test(f.fm.id)) {
      problems.push(`features/${f.file}: id "${f.fm.id}" must look like FEAT-0001`);
    }
    if (f.status && !(FEATURE_STATUSES as readonly string[]).includes(f.status)) {
      problems.push(
        `features/${f.file}: status "${f.status}" — one of: ${FEATURE_STATUSES.join(', ')}`,
      );
    }
    for (const key of FEATURE_REF_KEYS) {
      for (const id of f.refs[key] ?? []) {
        if (id === f.id) problems.push(`features/${f.file}: ${key} points at itself`);
        else if (!byId.has(id)) problems.push(`features/${f.file}: ${key} → ${id} does not exist`);
      }
    }
  }

  // supersedes / superseded-by must agree in both directions
  for (const f of features) {
    for (const id of f.refs['supersedes'] ?? []) {
      const other = byId.get(id);
      if (other && !(other.refs['superseded-by'] ?? []).includes(f.id)) {
        problems.push(
          `features/${other.file}: ${f.id} claims to supersede it — add "superseded-by: ${f.id}"`,
        );
      }
    }
    for (const id of f.refs['superseded-by'] ?? []) {
      const other = byId.get(id);
      if (other && !(other.refs['supersedes'] ?? []).includes(f.id)) {
        problems.push(
          `features/${other.file}: ${f.id} claims to be superseded by it — add "supersedes: ${f.id}"`,
        );
      }
    }
  }

  // --- authored links on todos: resolve every FEAT reference ---
  const todos = listAllTodos(nd).map((t) => readTodoLinks(t));
  const workByFeature = new Map<string, TodoLinks[]>();
  for (const t of todos) {
    for (const id of t.featureIds) {
      if (!byId.has(id)) {
        problems.push(`${t.todo.ref}: **Feature:** ${id} does not exist in features/`);
        continue;
      }
      if (!workByFeature.has(id)) workByFeature.set(id, []);
      workByFeature.get(id)!.push(t);
    }
    if (t.hasRecord && !t.hasFeatureField && features.length > 0) {
      notes.push(`${t.todo.ref}: record declares no **Feature:** (link it, or state "none — <why>")`);
    }
  }

  // --- totest: the human-verification gate must never dangle in either direction ---
  const tasks = listTestTasks(nd, true);
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const todoByRef = new Map(todos.map((t) => [t.todo.ref, t]));

  for (const t of todos) {
    if (t.state !== 'needstest') continue;
    if (!t.testRef) {
      problems.push(
        `${t.todo.ref}: ${RECORD_NEEDSTEST} has no **Test:** ref — name the totest/ task it is waiting on`,
      );
    } else if (!taskById.has(t.testRef)) {
      problems.push(`${t.todo.ref}: **Test:** ${t.testRef} does not exist in totest/`);
    }
  }

  for (const task of tasks) {
    const where = task.archived ? `archive/…/totest/${task.id}` : `totest/${task.id}`;
    if (!existsSync(task.planPath)) {
      problems.push(`${where}: missing ${TEST_PLAN_FILE}`);
      continue;
    }
    for (const key of TEST_PLAN_REQUIRED_KEYS) {
      if (!task.fm[key]) problems.push(`${where}/${TEST_PLAN_FILE}: frontmatter missing "${key}"`);
    }
    if (task.fm.id && task.fm.id !== task.id) {
      problems.push(`${where}/${TEST_PLAN_FILE}: id "${task.fm.id}" does not match the folder name`);
    }
    if (task.status && !(TEST_STATUSES as readonly string[]).includes(task.status)) {
      problems.push(
        `${where}/${TEST_PLAN_FILE}: status "${task.status}" — one of: ${TEST_STATUSES.join(', ')}`,
      );
    }
    if (task.scenarios === 0) {
      problems.push(`${where}/${TEST_PLAN_FILE}: no "## Scenario" sections — nothing to test`);
    }
    for (const id of task.featureIds) {
      if (!byId.has(id)) problems.push(`${where}/${TEST_PLAN_FILE}: feature ${id} does not exist`);
    }

    // A living task can gate several todos at once; the two sides must list each other.
    for (const ref of task.todoRefs) {
      const owner = todoByRef.get(ref);
      if (!owner) {
        problems.push(`${where}/${TEST_PLAN_FILE}: todo "${ref}" does not exist`);
      } else if (task.status !== 'reviewed' && owner.state !== 'needstest') {
        problems.push(
          `${where}: awaiting-test and lists ${ref}, but that todo is "${owner.state}" — the gate and the task disagree`,
        );
      }
    }
    if (task.status !== 'reviewed') {
      for (const gated of todos) {
        if (gated.state === 'needstest' && gated.testRef === task.id && !task.todoRefs.includes(gated.todo.ref)) {
          problems.push(
            `${where}/${TEST_PLAN_FILE}: ${gated.todo.ref} is gated on this task but missing from "todos:"`,
          );
        }
      }
    }

    // One living task per feature — a second folder for the same feature is the
    // duplicate-plan mistake this model exists to prevent.
    for (const id of task.featureIds) {
      const twin = tasks.find(
        (o) => o.id !== task.id && !o.archived && o.featureIds.includes(id),
      );
      if (twin && !task.archived && task.id < twin.id) {
        problems.push(
          `totest/${task.id} and totest/${twin.id} both cover ${id} — keep ONE living task per feature and revise its plan`,
        );
      }
    }

    if (task.status !== 'reviewed') {
      const rev = task.revision ? ` rev ${task.revision},` : '';
      notes.push(
        task.hasResults
          ? `${where}:${rev} results are in (${task.results.join(', ')}) — run /novadev-review-tests`
          : `${where}:${rev} waiting on a human to test it (${task.scenarios} scenario(s))`,
      );
    }
  }

  // --- commits referenced by records must exist in git history ---
  const allCommits = [...new Set(todos.flatMap((t) => t.commits))];
  for (const bad of unknownCommits(root, allCommits)) {
    const owners = todos.filter((t) => t.commits.includes(bad)).map((t) => t.todo.ref);
    notes.push(`commit ${bad} (${owners.join(', ')}) is not in this repository's history`);
  }

  // --- derived content: feature Work/Commits blocks ---
  for (const f of features) {
    const linked = (workByFeature.get(f.id) ?? []).sort((a, b) =>
      a.todo.ref.localeCompare(b.todo.ref),
    );
    let next = f.text;

    const work = writeBlock(next, 'work', renderWork(linked));
    if (work === null) {
      problems.push(
        `features/${f.file}: missing ${blockBegin('work')} … ${blockEnd('work')} block (the derived "## Work" list)`,
      );
    } else {
      next = work;
    }

    const commits = writeBlock(next, 'commits', renderCommits(linked));
    if (commits === null) {
      problems.push(
        `features/${f.file}: missing ${blockBegin('commits')} … ${blockEnd('commits')} block (the derived "## Commits" list)`,
      );
    } else {
      next = commits;
    }

    if (next !== f.text) {
      fixes.push({ path: f.path, label: `features/${f.file}: derived blocks are stale`, next });
    }

    if (f.status === 'shipped' && !linked.some((t) => t.state === 'completed')) {
      notes.push(`features/${f.file}: status "shipped" but no completed todo links to it`);
    }
    if (f.status === 'planned' && linked.some((t) => t.state === 'completed')) {
      notes.push(`features/${f.file}: status "planned" but completed work links to it — advance it`);
    }
  }

  // --- derived content: features/INDEX.md ---
  const indexPath = join(featuresDir(nd), 'INDEX.md');
  if (features.length > 0) {
    const current = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : null;
    const base = current ?? indexScaffold();
    const next = writeBlock(base, 'features-index', renderIndex(features));
    if (next === null) {
      problems.push(
        `features/INDEX.md: missing ${blockBegin('features-index')} … ${blockEnd('features-index')} block`,
      );
    } else if (next !== current) {
      fixes.push({
        path: indexPath,
        label: current === null ? 'features/INDEX.md: missing' : 'features/INDEX.md: out of date',
        next,
      });
    }
  } else if (!existsSync(indexPath)) {
    notes.push('features/: registry MISSING — an agent must create it (skills/feature-init.md)');
  }

  return { problems, notes, fixes };
}

function readTodoLinks(todo: TodoRef): TodoLinks {
  const featureIds: string[] = [];
  const commits: string[] = [];
  let hasFeatureField = false;
  let hasRecord = false;
  let date = '';
  let testRef = '';

  for (const file of listFiles(todo.dir)) {
    if (!file.endsWith('.md') && !file.endsWith('.txt')) continue;
    const text = readFileSync(join(todo.dir, file), 'utf8');
    const feature = readField(text, 'Feature');
    if (feature !== null) {
      hasFeatureField = true;
      featureIds.push(...featureIdsIn(feature));
    }
    const commitField = readField(text, 'Commits');
    if (commitField !== null) commits.push(...commitHashesIn(commitField));
    if (file === RECORD_NEEDSTEST || file === RECORD_CONFIRMED) {
      testRef = readField(text, 'Test') ?? testRef;
    }
    if (file.startsWith('ai_')) {
      hasRecord = true;
      date = readField(text, 'Date') ?? date;
    }
  }

  return {
    todo,
    state: todoState(todo.dir),
    date,
    featureIds: [...new Set(featureIds)],
    commits: [...new Set(commits)],
    hasFeatureField,
    hasRecord,
    testRef: testRef.trim(),
  };
}

function renderWork(linked: TodoLinks[]): string {
  if (linked.length === 0) return '(no linked todos yet)';
  return linked
    .map((t) => {
      const bits = [t.state, t.date, t.todo.archived ? 'archived' : ''].filter(Boolean);
      return `- \`${t.todo.ref}\` — ${bits.join(' · ')}`;
    })
    .join('\n');
}

function renderCommits(linked: TodoLinks[]): string {
  const rows = linked.flatMap((t) => t.commits.map((c) => `- \`${c}\` — ${t.todo.ref}`));
  return rows.length === 0 ? '(no linked commits yet)' : rows.join('\n');
}

function renderIndex(features: Feature[]): string {
  const head = '| ID | Status | Area | Feature | Touches |\n|---|---|---|---|---|';
  const rows = features.map((f) => {
    const cell = (s: string) => (s ? s.replace(/\|/g, '\\|') : '—');
    return `| [${f.id}](${f.file}) | ${cell(f.status)} | ${cell(f.area)} | ${cell(f.title)} | ${cell(f.touches.join(', '))} |`;
  });
  return [head, ...rows].join('\n');
}

function indexScaffold(): string {
  return `# Features index

<!-- The table below is DERIVED from the feature files' frontmatter.
     Regenerate it with \`novadev links --fix\` — do not hand-edit inside the markers. -->

${blockBegin('features-index')}
${blockEnd('features-index')}

Search the registry from the CLI:

\`\`\`sh
novadev features <query>              # title / area / tags / body
novadev features --touching <path>    # which features already claim this code
novadev features --status in-progress
\`\`\`
`;
}

/** Hashes that git does not know about (rebased away, typo'd, or never pushed). */
function unknownCommits(root: string, hashes: string[]): string[] {
  if (hashes.length === 0 || !existsSync(join(root, '.git'))) return [];
  try {
    const out = execFileSync('git', ['cat-file', '--batch-check'], {
      cwd: root,
      input: hashes.join('\n') + '\n',
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const bad: string[] = [];
    out.split('\n').forEach((line, i) => {
      if (line.trim().endsWith('missing') && hashes[i]) bad.push(hashes[i]);
    });
    return bad;
  } catch {
    return [];
  }
}

export function links(args: string[]): void {
  const root = requireProjectRoot();
  const apply = args.includes('--fix');
  for (const a of args) {
    if (a !== '--fix') {
      console.error(`novadev: unknown option "${a}"\nusage: novadev links [--fix]`);
      process.exit(1);
    }
  }

  const audit = auditLinks(root);

  if (apply && audit.fixes.length > 0) {
    for (const fix of audit.fixes) {
      writeFileSync(fix.path, fix.next);
      console.log(`  ✎ ${fix.label.split(':')[0]} — regenerated`);
    }
    console.log(`links: regenerated ${audit.fixes.length} file(s).`);
  }

  const stale = apply ? [] : audit.fixes;
  if (audit.problems.length === 0 && stale.length === 0 && audit.notes.length === 0) {
    console.log('links: graph is consistent.');
    return;
  }

  if (audit.problems.length > 0) {
    console.log(`PROBLEMS (${audit.problems.length}):`);
    for (const p of audit.problems) console.log(`  ✗ ${p}`);
  }
  if (stale.length > 0) {
    console.log(`STALE derived content (${stale.length}) — run \`novadev links --fix\`:`);
    for (const f of stale) console.log(`  ✗ ${f.label}`);
  }
  if (audit.notes.length > 0) {
    console.log(`notes (${audit.notes.length}):`);
    for (const n of audit.notes) console.log(`  · ${n}`);
  }
  if (audit.problems.length > 0 || stale.length > 0) process.exit(1);
}
