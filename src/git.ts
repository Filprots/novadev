// The few read-only questions novadev asks git. Each answers null when git cannot tell — no git,
// not a repository, no commit yet, or the file is not in the last commit — and callers then fall
// back to what the working tree alone says. Nothing here ever changes the repository.
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

/** stdout of a git command run in `root`, or null when it could not run or failed. */
function git(root: string, args: string[]): string | null {
  try {
    const run = spawnSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 30_000,
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
    });
    return run.status === 0 && typeof run.stdout === 'string' ? run.stdout : null;
  } catch {
    return null;
  }
}

/** A file's content in the last commit. `rel` is relative to `root`. */
export function fileAtHead(root: string, rel: string): string | null {
  return git(root, ['show', `HEAD:./${rel.replace(/\\/g, '/')}`]);
}

/**
 * Every file under `rel` (relative to `root`) that differs from the last commit — changed, staged,
 * new or untracked — as absolute paths.
 */
export function changedSinceHead(root: string, rel: string): Set<string> | null {
  const tracked = git(root, ['diff', '--name-only', '-z', '--relative', 'HEAD', '--', rel]);
  const untracked = git(root, ['ls-files', '-z', '--others', '--exclude-standard', '--', rel]);
  if (tracked === null || untracked === null) return null;
  return new Set(
    [...tracked.split('\0'), ...untracked.split('\0')].filter(Boolean).map((path) => resolve(root, path)),
  );
}

/**
 * Every file under `rel` (relative to `root`) that the last commit holds and that has not changed
 * since — not in the index, not in the working tree — as absolute paths. In a repository with no
 * commit yet, nothing is unchanged: the empty set. Null when git cannot tell (no git, not a
 * repository).
 */
export function unchangedSinceHead(root: string, rel: string): Set<string> | null {
  if (git(root, ['rev-parse', '--is-inside-work-tree'])?.trim() !== 'true') return null;
  if (git(root, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']) === null) return new Set();
  const committed = git(root, ['ls-tree', '-r', '-z', '--name-only', 'HEAD', '--', rel]);
  const changed = git(root, ['diff', '--name-only', '-z', '--relative', 'HEAD', '--', rel]);
  if (committed === null || changed === null) return null;
  const moved = new Set(changed.split('\0').filter(Boolean).map((path) => resolve(root, path)));
  return new Set(
    committed
      .split('\0')
      .filter(Boolean)
      .map((path) => resolve(root, path))
      .filter((path) => !moved.has(path)),
  );
}
