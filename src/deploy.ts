// `novadev deploy` — create/upgrade the novadev system in the current project.
// Idempotent: framework-managed files are refreshed; user content is never touched.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  NOVADEV_VERSION,
  ROOT_DIR_NAME,
  SKILLS,
  packageDir,
  todayStamp,
} from './lib.ts';

const MARK_BEGIN = '<!-- novadev:begin -->';
const MARK_END = '<!-- novadev:end -->';

const USER_FOLDERS = ['todos', 'archive', 'postponed', 'sparks', 'wiki', 'memories'];

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
  // wiki/INDEX.md is deliberately NOT created: its absence is the signal that an
  // agent must build the wiki via skills/wiki-init.md.

  // 2. Canonical skill playbooks (framework-owned, always refreshed).
  const skillsDir = join(root, 'skills');
  mkdirSync(skillsDir, { recursive: true });
  for (const skill of SKILLS) {
    writeManaged(join(skillsDir, skill.file), readTemplate(templates, `skills/${skill.file}`));
  }

  // 3. Manifest.
  writeManaged(
    join(root, 'novadev.json'),
    JSON.stringify({ novadev: true, version: NOVADEV_VERSION, deployedAt: todayStamp() }, null, 2) +
      '\n',
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
    created.length + refreshed.length === 0 ? '  already up to date.' : '',
    '',
    'Next: commit the changes; an agent should now create the wiki (skills/wiki-init.md) if it is missing.',
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
description: ${skill.description}
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

This project uses novadev (\`${ROOT_DIR_NAME}/\`). Always follow
\`${ROOT_DIR_NAME}/skills/workflow.md\`. Before substantive work, load
\`${ROOT_DIR_NAME}/wiki/INDEX.md\` (create the wiki per
\`${ROOT_DIR_NAME}/skills/wiki-init.md\` if missing) and scan
\`${ROOT_DIR_NAME}/memories/INDEX.md\`. Management playbooks live in
\`${ROOT_DIR_NAME}/skills/\`.
`,
  );
}

function managedSection(): string {
  return `${MARK_BEGIN}
## novadev — structured development system (managed by \`novadev deploy\`, do not edit inside markers)

This project uses **novadev** (\`${ROOT_DIR_NAME}/\`): git-tracked todos, archive,
postponed, sparks, wiki, and memories.

- **Always follow** \`${ROOT_DIR_NAME}/skills/workflow.md\` for any development task —
  it defines todo execution, the ai_completed/ai_failed/ai_progress records, and
  when to auto-write memories.
- **Before substantive work**: load \`${ROOT_DIR_NAME}/wiki/INDEX.md\` (the project
  pre-context). If it is missing, FIRST create the wiki per
  \`${ROOT_DIR_NAME}/skills/wiki-init.md\`.
- **Scan** \`${ROOT_DIR_NAME}/memories/INDEX.md\` for guardrails touching your task.
- Management playbooks (wiki-update, wiki-compact, memories-review, debt-scan)
  live in \`${ROOT_DIR_NAME}/skills/\`.
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
