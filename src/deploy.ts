// `novadev deploy` — create/upgrade the novadev system in the current project.
// Idempotent: framework-managed files are refreshed; user content is never touched.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  LEGACY_ADAPTER_SLUGS,
  LEGACY_SKILL_FILES,
  NOVADEV_VERSION,
  ROOT_DIR_NAME,
  SKILLS,
  packageDir,
  todayStamp,
} from './lib.ts';

const MARK_BEGIN = '<!-- novadev:begin -->';
const MARK_END = '<!-- novadev:end -->';

const USER_FOLDERS = [
  'todos',
  'archive',
  'postponed',
  'sparks',
  'wiki',
  'memories',
  'features',
  'totest',
];

export function deploy(cwd: string = process.cwd()): void {
  const root = join(cwd, ROOT_DIR_NAME);
  const templates = join(packageDir(), 'templates');
  const created: string[] = [];
  const refreshed: string[] = [];

  if (!existsSync(join(cwd, '.git'))) {
    console.warn(
      'novadev: warning — this directory is not a git repository root. novadev is designed to live in git; run `git init` (or deploy at the repo root).',
    );
  }

  const track = (path: string, existed: boolean) =>
    (existed ? refreshed : created).push(path.replace(cwd + '/', ''));

  const writeManaged = (path: string, content: string) => {
    const existed = existsSync(path);
    if (existed && readFileSync(path, 'utf8') === content) return;
    writeFileSync(path, content);
    track(path, existed);
  };

  // 1. Folder tree + self-describing READMEs.
  mkdirSync(root, { recursive: true });
  writeManaged(join(root, 'README.md'), readTemplate(templates, 'readmes/root.md'));
  for (const folder of USER_FOLDERS) {
    const dir = join(root, folder);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      created.push(`${ROOT_DIR_NAME}/${folder}/`);
    }
    const readme = join(templates, 'readmes', `${folder}.md`);
    if (existsSync(readme)) {
      writeManaged(join(dir, 'README.md'), readFileSync(readme, 'utf8'));
    }
  }

  // memories/INDEX.md is user content — seed it only when missing.
  const memIndex = join(root, 'memories', 'INDEX.md');
  if (!existsSync(memIndex)) {
    writeFileSync(memIndex, '# Memories index\n\n(no memories yet)\n');
    created.push(`${ROOT_DIR_NAME}/memories/INDEX.md`);
  }
  // wiki/INDEX.md and features/INDEX.md are deliberately NOT created: their absence is
  // the signal that an agent must build them, and `novadev sync` says so in NEXT ACTIONS.

  // 2. Canonical skill playbooks (framework-owned, always refreshed).
  const skillsDir = join(root, 'skills');
  mkdirSync(skillsDir, { recursive: true });
  for (const skill of SKILLS) {
    writeManaged(join(skillsDir, skill.file), readTemplate(templates, `skills/${skill.file}`));
  }
  // 2b. Remove the pre-0.7.0 playbooks and their adapters — everything they said now
  // lives in the single gateway skill, and a stale slash command is worse than none.
  const removed: string[] = [];
  for (const file of LEGACY_SKILL_FILES) {
    const path = join(skillsDir, file);
    if (existsSync(path)) {
      rmSync(path);
      removed.push(`${ROOT_DIR_NAME}/skills/${file}`);
    }
  }
  for (const slug of LEGACY_ADAPTER_SLUGS) {
    const dir = join(cwd, '.claude', 'skills', slug);
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
      removed.push(`.claude/skills/${slug}/`);
    }
  }

  // 3. Manifest — merge, never clobber: it carries user settings like archiveGraceDays.
  let manifest: Record<string, unknown> = {};
  try {
    manifest = JSON.parse(readFileSync(join(root, 'novadev.json'), 'utf8'));
  } catch {
    /* first deploy, or unreadable — start fresh */
  }
  writeManaged(
    join(root, 'novadev.json'),
    JSON.stringify(
      { ...manifest, novadev: true, version: NOVADEV_VERSION, deployedAt: todayStamp() },
      null,
      2,
    ) + '\n',
  );

  // 4. Native adapters — thin pointers to the canonical playbooks.
  deployClaudeAdapters(cwd, writeManaged);
  deployCursorAdapter(cwd, writeManaged);

  // 5. Managed sections in the agent entry files.
  for (const entry of ['AGENTS.md', 'CLAUDE.md']) {
    const changed = upsertManagedSection(join(cwd, entry));
    if (changed) refreshed.push(entry);
  }

  const report = [
    `novadev ${NOVADEV_VERSION} deployed into ${ROOT_DIR_NAME}/`,
    created.length ? `  created:  ${created.join(', ')}` : '',
    refreshed.length ? `  updated:  ${refreshed.join(', ')}` : '',
    removed.length ? `  removed:  ${removed.join(', ')}` : '',
    created.length + refreshed.length + removed.length === 0 ? '  already up to date.' : '',
    '',
    'Next: commit the changes, then run `novadev sync` — it does the mechanical work and',
    'tells the agent what is left (starting with building the wiki, if it is missing).',
  ].filter(Boolean);
  console.log(report.join('\n'));
}

function readTemplate(templatesDir: string, rel: string): string {
  return readFileSync(join(templatesDir, rel), 'utf8');
}

function deployClaudeAdapters(cwd: string, writeManaged: (p: string, c: string) => void): void {
  for (const skill of SKILLS) {
    const dir = join(cwd, '.claude', 'skills', skill.slug);
    mkdirSync(dir, { recursive: true });
    const canonical = `${ROOT_DIR_NAME}/skills/${skill.file}`;
    writeManaged(
      join(dir, 'SKILL.md'),
      `---
name: ${skill.slug}
description: ${JSON.stringify(skill.description)}
---

<!-- adapter managed by \`novadev deploy\` — the canonical playbook lives at ${canonical} -->

Read the canonical playbook at \`${canonical}\` in full, then execute it in this
project. That file is the single source of truth; this adapter only routes to it.
`,
    );
  }
}

function deployCursorAdapter(cwd: string, writeManaged: (p: string, c: string) => void): void {
  const dir = join(cwd, '.cursor', 'rules');
  mkdirSync(dir, { recursive: true });
  writeManaged(
    join(dir, 'novadev.mdc'),
    `---
description: novadev structured development system — always-applied workflow
alwaysApply: true
---

<!-- adapter managed by \`novadev deploy\` — canonical content lives in ${ROOT_DIR_NAME}/ -->

This project uses novadev (\`${ROOT_DIR_NAME}/\`). Read
\`${ROOT_DIR_NAME}/skills/novadev.md\` — the single playbook — and run THE LOOP it
defines for any development work here: load pre-context (wiki + memories + features)
→ plan → work → write the ai_ record → hand what you could not verify to the human as
a \`totest/\` task → review their results when they land → update the feature →
memories → wiki → close out with \`novadev sync\`.

The human writes todo briefs; you do everything else. A chat request to
implement/fix/change anything no open todo covers must itself be FILED as a todo.
End every round with \`novadev sync\` and act on its NEXT ACTIONS until clean.
`,
  );
}

function managedSection(): string {
  return `${MARK_BEGIN}
## novadev — structured development system (managed by \`novadev deploy\`, do not edit inside markers)

This project uses **novadev** (\`${ROOT_DIR_NAME}/\`): git-tracked todos, archive,
postponed, sparks, wiki, memories, a features registry, and a human-testing queue.

- **Always follow** \`${ROOT_DIR_NAME}/skills/novadev.md\` — the single playbook. It
  defines THE LOOP you run for any development work here, end to end: load
  pre-context → plan → work → write the ai_ record → hand untestable work to the
  human → review their results → update the feature → memories → wiki → close out.
- **The human writes todo briefs; you do everything else.** Never leave the human to
  remember a command, an archive step, or which check to run.
- **Close every round with \`novadev sync\`**: it regenerates derived links, archives
  what is finished, validates the tree, and prints NEXT ACTIONS. Keep acting on that
  list until it is clean, then report what landed and what is waiting on the human.
${MARK_END}`;
}

/** Insert or replace the marker-delimited section; create the file if missing. Returns true when the file changed. */
function upsertManagedSection(filePath: string): boolean {
  const section = managedSection();
  if (!existsSync(filePath)) {
    writeFileSync(filePath, section + '\n');
    return true;
  }
  const text = readFileSync(filePath, 'utf8');
  const begin = text.indexOf(MARK_BEGIN);
  const end = text.indexOf(MARK_END);
  let next: string;
  if (begin !== -1 && end !== -1 && end > begin) {
    next = text.slice(0, begin) + section + text.slice(end + MARK_END.length);
  } else {
    next = text.trimEnd() + '\n\n' + section + '\n';
  }
  if (next === text) return false;
  writeFileSync(filePath, next);
  return true;
}
