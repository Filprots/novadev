// Sub-repositories: independent git repositories nested inside the project (a super-repo whose
// `repos/*` are clones it ignores), and how a record names a commit in one of them.
//
//   "subrepos": ["repos/*", "vendor/engine"]      in .novadev/novadev.json
//
// Each entry is a folder, relative to the project root; one ending in `/*` stands for every folder
// in it that is a repository of its own. A sub-repo is named by its folder's name (`repos/irrippr`
// → `irrippr`), and a record names a commit in it as `irrippr@abc1234`:
//
//   **Commits:** 4f2a9c1, irrippr@abc1234, irrisketch_locales@9e8d7c6
//   **Repos:** irrippr, irrisketch_locales
//
// A bare hash is a commit of the project's own repository, as always. `**Repos:**` names the
// sub-repos the todo changed; `novadev links` checks both lines against the setting and asks each
// commit of the repository it names.
import { join } from 'node:path';
import { commitPaths, isRepositoryTop } from './git.ts';
import { type Parsed, byCodePoint, comparablePath, listDirs, novadevDir, readManifest, refuse } from './lib.ts';

export type Subrepo = { name: string; /** Relative to the project root, with "/". */ rel: string; /** Absolute. */ path: string };

/** `"subrepos"` in novadev.json: a list of folders (`dir/*` for every repository in `dir`), or null/absent. */
export function parseSubreposSetting(value: unknown): Parsed<string[]> {
  if (value === undefined || value === null) return { ok: true, value: [] };
  const example = 'like ["repos/*"]';
  if (!Array.isArray(value)) return refuse(`"subrepos" must be a list of folders, ${example}`);
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.trim() === '') return refuse(`"subrepos" must be a list of folders, ${example}`);
    const rel = comparablePath(entry.trim().replace(/\\/g, '/'));
    if (rel === '' || rel.startsWith('/') || rel.split('/').includes('..') || /^[A-Za-z]:/.test(rel)) {
      return refuse(`"subrepos": "${entry}" must be a folder inside the project`);
    }
    if (rel.slice(0, -1).includes('*') || (rel.includes('*') && !rel.endsWith('/*'))) {
      return refuse(`"subrepos": "${entry}" — only a last "/*" is understood ("repos/*")`);
    }
    out.push(rel);
  }
  return { ok: true, value: out };
}

export type SubrepoList = { repos: Subrepo[]; problems: string[]; notes: string[] };

const cache = new Map<string, SubrepoList>();

/** The sub-repos the project names, found on disk; asked once per project per run. */
export function listSubrepos(root: string): SubrepoList {
  const known = cache.get(root);
  if (known) return known;
  const out: SubrepoList = { repos: [], problems: [], notes: [] };
  const setting = parseSubreposSetting(readManifest(novadevDir(root))?.subrepos);
  if (!setting.ok) {
    out.problems.push(`novadev.json: ${setting.error}`);
  } else {
    const seen = new Map<string, string>();
    for (const entry of setting.value) {
      const folders = entry.endsWith('/*')
        ? listDirs(join(root, entry.slice(0, -2))).map((name) => `${entry.slice(0, -2)}/${name}`)
        : [entry];
      for (const rel of folders) {
        const path = join(root, rel);
        if (!isRepositoryTop(path)) {
          if (!entry.endsWith('/*')) out.notes.push(`novadev.json: "subrepos" names ${rel}, which is not a git repository here`);
          continue;
        }
        const name = rel.split('/').at(-1)!;
        const twin = seen.get(name);
        if (twin !== undefined) {
          if (twin !== rel) out.problems.push(`novadev.json: "subrepos" finds two repositories named ${name} (${twin}, ${rel}) — a record could not tell them apart`);
          continue;
        }
        seen.set(name, rel);
        out.repos.push({ name, rel, path });
      }
    }
    out.repos.sort((a, b) => byCodePoint(a.name, b.name));
  }
  cache.set(root, out);
  return out;
}

/** Forget what `listSubrepos` found (a test, or a command that just made a worktree). */
export function forgetSubrepos(): void {
  cache.clear();
}

/** One commit a record names: `repo` is null for the project's own repository. `text` is how it was written. */
export type CommitRef = { repo: string | null; hash: string; text: string };

const COMMIT_REF = /(?<![\w.@-])(?:([A-Za-z0-9][\w.-]*)@)?([0-9a-f]{7,40})(?![\w@])/g;

/** The commits a `**Commits:**` value names, in order, each once: `abc1234` and `irrippr@abc1234`. */
export function commitRefsIn(value: string): CommitRef[] {
  const out: CommitRef[] = [];
  const seen = new Set<string>();
  for (const m of value.matchAll(COMMIT_REF)) {
    const repo = m[1] ?? null;
    const hash = m[2]!;
    const text = repo === null ? hash : `${repo}@${hash}`;
    if (seen.has(text)) continue;
    seen.add(text);
    out.push({ repo, hash, text });
  }
  return out;
}

/** The repositories a `**Repos:**` value names. */
export function repoNamesIn(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[,\s]+/)
        .map((name) => name.replace(/[`*]/g, '').trim())
        .filter((name) => name !== '' && name !== 'none' && name !== '-'),
    ),
  ];
}

/**
 * The files each commit changed, as paths relative to the PROJECT root — a sub-repo's paths with its
 * folder in front (`repos/irrippr/ps/a.js`) — keyed by the commit as it was written. A commit of a
 * repository the project does not name, or that its repository does not know, is left out. Null
 * when the project's own repository cannot tell.
 */
export function commitChanges(root: string, refs: readonly CommitRef[]): Map<string, string[]> | null {
  const out = new Map<string, string[]>();
  const own = refs.filter((ref) => ref.repo === null);
  const ownChanged = commitPaths(root, own.map((ref) => ref.hash));
  if (ownChanged === null) return null;
  for (const ref of own) {
    const files = ownChanged.get(ref.hash);
    if (files) out.set(ref.text, files);
  }
  const { repos } = listSubrepos(root);
  for (const repo of repos) {
    const mine = refs.filter((ref) => ref.repo === repo.name);
    if (mine.length === 0) continue;
    const changed = commitPaths(repo.path, mine.map((ref) => ref.hash), true);
    if (changed === null) continue;
    for (const ref of mine) {
      const files = changed.get(ref.hash);
      if (files) out.set(ref.text, files.map((file) => `${repo.rel}/${file}`));
    }
  }
  return out;
}
