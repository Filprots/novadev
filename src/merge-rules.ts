// Merging parallel branches: how novadev's own files merge, and the clean-up after a merge.
//
// Two branches that both record knowledge, or both regenerate a derived file, used to conflict on
// every merge. Two git rules settle it, and `novadev deploy` writes them:
//
//   .gitattributes (a managed block)    the knowledge log merges by UNION — it only ever gains
//                                       entries, so both sides' entries are kept; every file novadev
//                                       derives merges with the `novadev-derived` driver, which
//                                       keeps this side's copy (the next sync rewrites it anyway)
//   the clone's git config              defines that driver (`merge.novadev-derived.driver true`);
//                                       a clone without it falls back to a text merge, and sync says
//                                       so. The config sits in the common git dir: every worktree
//                                       of the clone shares it
//
// After the merge, `novadev sync --after-merge` repairs the log (a union can leave one day in two
// sections), regenerates everything derived, and commits what it changed in `.novadev/` — the one
// commit novadev makes on its own, because that is what the person merging asked for.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT_DIR_NAME } from './lib.ts';
import { parseLog } from './okf.ts';

export const MERGE_DRIVER = 'novadev-derived';
export const GITATTRIBUTES = '.gitattributes';
const BEGIN = '# novadev:begin — managed by `novadev deploy`: how novadev\'s own files merge (see the README, "Parallel work")';
const END = '# novadev:end';

/** The rules, relative to the project root: the log by union, every derived file by the driver. */
export const MERGE_RULES: readonly string[] = [
  `${ROOT_DIR_NAME}/knowledge/log.md merge=union`,
  `${ROOT_DIR_NAME}/knowledge/**/index.md merge=${MERGE_DRIVER}`,
  `${ROOT_DIR_NAME}/knowledge/features/*/work.md merge=${MERGE_DRIVER}`,
  `${ROOT_DIR_NAME}/knowledge/features/*/tests.md merge=${MERGE_DRIVER}`,
  `${ROOT_DIR_NAME}/todos/*/completed.md merge=${MERGE_DRIVER}`,
  `${ROOT_DIR_NAME}/metrics/latest.json merge=${MERGE_DRIVER}`,
];

function block(): string {
  return [BEGIN, ...MERGE_RULES, END].join('\n');
}

/** The project's .gitattributes with novadev's block written in (added at the end, or replaced in place). */
export function withMergeRules(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const begin = lines.findIndex((line) => line.startsWith('# novadev:begin'));
  const end = begin === -1 ? -1 : lines.findIndex((line, i) => i > begin && line.trim() === END);
  if (begin !== -1 && end !== -1) {
    lines.splice(begin, end - begin + 1, ...block().split('\n'));
    return `${lines.join('\n').replace(/\n+$/, '')}\n`;
  }
  const body = text.replace(/\r\n/g, '\n').replace(/\n+$/, '');
  return `${body === '' ? '' : `${body}\n\n`}${block()}\n`;
}

/** True when the project's .gitattributes carries novadev's block. */
export function hasMergeRules(root: string): boolean {
  const path = join(root, GITATTRIBUTES);
  return existsSync(path) && readFileSync(path, 'utf8').split(/\r?\n/).some((line) => line.startsWith('# novadev:begin'));
}

/** Write the block into the project's .gitattributes; true when the file changed. */
export function writeMergeRules(root: string): boolean {
  const path = join(root, GITATTRIBUTES);
  const before = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const after = withMergeRules(before);
  if (after === before) return false;
  writeFileSync(path, after);
  return true;
}

function git(root: string, args: string[]): { ok: boolean; out: string; err: string } {
  try {
    const run = spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: 60_000, windowsHide: true });
    return { ok: run.status === 0, out: (run.stdout ?? '').trim(), err: (run.stderr ?? '').trim() };
  } catch (error) {
    return { ok: false, out: '', err: error instanceof Error ? error.message : String(error) };
  }
}

/** Is the driver defined in this clone's git config? Null outside a repository. */
export function mergeDriverConfigured(root: string): boolean | null {
  if (!git(root, ['rev-parse', '--is-inside-work-tree']).ok) return null;
  return git(root, ['config', '--get', `merge.${MERGE_DRIVER}.driver`]).ok;
}

/**
 * Define the driver in the clone's own git config (`--local`: the common git dir, so every worktree
 * has it). "keep ours": `true` exits 0 and leaves this side's file as it is. Returns whether it
 * wrote anything; null outside a repository.
 */
export function configureMergeDriver(root: string): boolean | null {
  const configured = mergeDriverConfigured(root);
  if (configured === null) return null;
  const current = git(root, ['config', '--local', '--get', `merge.${MERGE_DRIVER}.driver`]);
  if (current.ok && current.out === 'true') return false;
  git(root, ['config', '--local', `merge.${MERGE_DRIVER}.name`, 'novadev derived file: keep ours, novadev sync rewrites it']);
  git(root, ['config', '--local', `merge.${MERGE_DRIVER}.driver`, 'true']);
  return true;
}

// ---------------------------------------------------------------------------
// The log after a union merge
// ---------------------------------------------------------------------------

/**
 * The log with one section per day, newest first — what a union merge can break when both sides
 * added a day, or one side added days the other did not. Each day's entries keep the order they
 * appear in; an entry both sides carry word for word is kept once. Everything before the first
 * day heading stays as it is. Null when there is nothing to repair (or the log has a fence or a
 * malformed heading, which a person should look at).
 */
export function repairLog(text: string): string | null {
  const read = parseLog(text);
  const repairable = read.problems.every((p) => /a second section for|comes after .* the newest day goes first/.test(p));
  if (read.problems.length === 0 || !repairable) return null;
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines.some((line) => /^ {0,3}(`{3,}|~{3,})/.test(line))) return null;
  const head = lines.slice(0, read.sections[0]!.line);
  const days = new Map<string, string[][]>();
  read.sections.forEach((section, i) => {
    const body = lines.slice(section.line + 1, read.sections[i + 1]?.line ?? lines.length);
    const entries: string[][] = [];
    for (const line of body) {
      if (/^[*-][ \t]+/.test(line)) entries.push([line]);
      else if (line.trim() !== '' && entries.length > 0) entries.at(-1)!.push(line);
      else if (line.trim() !== '' && entries.length === 0) entries.push([line]);
    }
    const day = days.get(section.date) ?? [];
    for (const entry of entries) {
      if (!day.some((kept) => kept.join('\n') === entry.join('\n'))) day.push(entry);
    }
    days.set(section.date, day);
  });
  const ordered = [...days.keys()].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  const out = [...head];
  while (out.length > 0 && out.at(-1)!.trim() === '') out.pop();
  for (const date of ordered) {
    out.push('', `## ${date}`, '');
    for (const entry of days.get(date)!) out.push(...entry);
  }
  return `${out.join('\n').replace(/^\n+/, '')}\n`;
}

// ---------------------------------------------------------------------------
// `novadev sync --after-merge`
// ---------------------------------------------------------------------------

/** Why `--after-merge` cannot run here, or null when it can. */
export function afterMergeRefusal(root: string): string | null {
  if (!git(root, ['rev-parse', '--is-inside-work-tree']).ok) return '--after-merge needs a git repository';
  if (git(root, ['rev-parse', '--verify', '--quiet', 'MERGE_HEAD']).ok) {
    return (
      'a merge is still in progress — finish it first (a derived file can take either side: ' +
      '`git checkout --ours -- <file>`; the log keeps both sides\' entries), commit, then run `novadev sync --after-merge`'
    );
  }
  const dirty = git(root, ['status', '--porcelain', '--untracked-files=all', '--', ROOT_DIR_NAME]);
  if (dirty.ok && dirty.out !== '') {
    return `${ROOT_DIR_NAME}/ has uncommitted changes — commit or drop them first, so the commit --after-merge makes holds only what sync derives`;
  }
  return null;
}

/** Repair the log in place; true when it changed. */
export function repairLogFile(nd: string): boolean {
  const path = join(nd, 'knowledge', 'log.md');
  if (!existsSync(path)) return false;
  const repaired = repairLog(readFileSync(path, 'utf8'));
  if (repaired === null) return false;
  writeFileSync(path, repaired);
  return true;
}

/**
 * Commit what this run changed in `.novadev/` — and nothing else: `--only` commits the paths given,
 * whatever else the index holds. The commit runs the repository's hooks like any other.
 */
export function commitAfterMerge(root: string): { committed: boolean; hash: string | null; files: string[]; error: string | null } {
  const changed = git(root, ['status', '--porcelain', '--untracked-files=all', '--', ROOT_DIR_NAME]);
  const files = changed.out === '' ? [] : changed.out.split('\n').map((line) => line.slice(3));
  if (files.length === 0) return { committed: false, hash: null, files, error: null };
  const add = git(root, ['add', '-A', '--', ROOT_DIR_NAME]);
  if (!add.ok) return { committed: false, hash: null, files, error: add.err };
  const message = `novadev sync after merge — ${files.length} file(s) in ${ROOT_DIR_NAME}/ regenerated`;
  const commit = git(root, ['commit', '-q', '--only', '-m', message, '--', ROOT_DIR_NAME]);
  if (!commit.ok) return { committed: false, hash: null, files, error: commit.err || commit.out };
  return { committed: true, hash: git(root, ['rev-parse', '--short', 'HEAD']).out || null, files, error: null };
}
