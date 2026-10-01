// The few read-only questions novadev asks git. Each answers null when git cannot tell — no git,
// not a repository, no commit yet, or the file is not in the last commit — and callers then fall
// back to what the working tree alone says. Nothing here ever changes the repository.
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

/** stdout of a git command run in `root` (with `input` on its stdin), or null when it could not run or failed. */
function git(root: string, args: string[], input?: string): string | null {
  try {
    const run = spawnSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      input,
      stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'ignore'],
      timeout: 30_000,
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
    });
    return run.status === 0 && typeof run.stdout === 'string' ? run.stdout : null;
  } catch {
    return null;
  }
}

/** True when `root` is inside a git work tree (and git runs at all). */
function inRepository(root: string): boolean {
  return git(root, ['rev-parse', '--is-inside-work-tree'])?.trim() === 'true';
}

/** A file's content in the last commit. `rel` is relative to `root`. */
export function fileAtHead(root: string, rel: string): string | null {
  return git(root, ['show', `HEAD:./${rel.replace(/\\/g, '/')}`]);
}

/**
 * Every file under `rel` (relative to `root`) that the last commit holds and that has not changed
 * since — not in the index, not in the working tree — as absolute paths. In a repository with no
 * commit yet, nothing is unchanged: the empty set. Null when git cannot tell (no git, not a
 * repository).
 */
export function unchangedSinceHead(root: string, rel: string): Set<string> | null {
  if (!inRepository(root)) return null;
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

/**
 * The files each commit changed, as paths relative to `root` — only files inside it — keyed by the
 * hash as it was given (a record may shorten it). A merge counts what it brought in over its first
 * parent; a move counts both its old and its new path. A hash git does not know as a commit is left
 * out: another repository's commit, a typo, or a short hash two objects share. So is a commit whose
 * parent a shallow clone did not fetch: git would list every file of the project as changed by it.
 * Null when git cannot tell (no git, not a repository).
 */
export function commitPaths(root: string, hashes: readonly string[]): Map<string, string[]> | null {
  if (!inRepository(root)) return null;
  const given = [...new Set(hashes)].filter((hash) => /^[0-9a-f]{4,64}$/i.test(hash));
  const out = new Map<string, string[]>();
  if (given.length === 0) return out;

  // One call resolves every hash: "<full hash> commit <size>", or "<hash> missing" / "ambiguous".
  const checked = git(root, ['cat-file', '--batch-check'], given.join('\n') + '\n');
  if (checked === null) return null;
  const full = new Map<string, string>();
  checked.split('\n').forEach((line, i) => {
    const match = /^([0-9a-f]{40,64}) commit \d+$/.exec(line.trim());
    if (match && given[i] !== undefined) full.set(given[i]!, match[1]!);
  });
  if (full.size === 0) return out;

  // One more call lists the files of all of them, with each commit's parents. -z keeps every file
  // name exactly as it is.
  const shallow = git(root, ['rev-parse', '--is-shallow-repository'])?.trim() === 'true';
  const listed = git(
    root,
    [
      '-c', 'core.quotePath=false',
      'log', '--no-walk=unsorted', '--stdin', '-z', '--format=%x01%H%x02%P',
      '--name-only', '--relative', '--no-renames', '-m', '--first-parent',
    ],
    [...new Set(full.values())].join('\n') + '\n',
  );
  if (listed === null) return null;
  const files = new Map<string, Set<string>>();
  for (const chunk of listed.split('\x01').slice(1)) {
    const [head = '', ...names] = chunk.split('\0');
    const [sha = '', parents = ''] = head.split('\x02');
    // In a shallow clone, a commit with no parent is (almost always) one whose parent was not
    // fetched, not a real first commit: what it changed is unknown.
    if (shallow && parents.trim() === '') continue;
    const set = files.get(sha.trim()) ?? new Set<string>();
    for (const name of names) {
      const path = name.replace(/^\n/, '');
      if (path !== '') set.add(path);
    }
    files.set(sha.trim(), set);
  }
  for (const [hash, sha] of full) {
    const changed = files.get(sha);
    if (changed) out.set(hash, [...changed].sort());
  }
  return out;
}
