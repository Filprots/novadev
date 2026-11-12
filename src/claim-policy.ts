// What an overlapping claim means in this project (0.18.0).
//
//   "claims": "lock"     (the default, and what every version before did) — one owner per file: an
//                        overlap with another worktree's claims is refused unless --allow-overlap.
//   "claims": "notice"   an overlap is SAID, not refused: both sides go on, and `worktree list`,
//                        `status`, the gate and the merge request name who else is in that path.
//                        Conflicts are caught where they happen — at the merge, by the checks on the
//                        merged result (`novadev worktree queue`).
//   "protectedPaths"     with "notice": the paths (or globs; `<sub-repo>:<path>` for a sub-repo) that
//                        stay one-owner locks exactly as under "lock" — the few areas of a project
//                        whose coupling no merge check sees.
//
// Both settings are read from the MAIN checkout's novadev.json: a task branch cannot loosen the
// rule for itself.
import { dirname } from 'node:path';
import { worktreeList } from './git.ts';
import { type Parsed, novadevDir, pathWithin, readManifest, refuse } from './lib.ts';
import { type ClaimHolder, type Overlap, claimHolders, normalizeClaim, samePlace } from './registry.ts';

export type ClaimPolicy = { mode: 'lock' | 'notice'; protectedPaths: string[] };

/** `"claims"` in novadev.json; absent or null = "lock". */
export function parseClaimsSetting(value: unknown): Parsed<ClaimPolicy['mode']> {
  if (value === undefined || value === null) return { ok: true, value: 'lock' };
  if (value !== 'lock' && value !== 'notice') return refuse('"claims" must be "lock" (one owner per file, the default) or "notice" (an overlap is said, not refused)');
  return { ok: true, value };
}

/** `"protectedPaths"` in novadev.json, each normalised like a claim; absent or null = none. */
export function parseProtectedPaths(root: string, value: unknown): Parsed<string[]> {
  if (value === undefined || value === null) return { ok: true, value: [] };
  if (!Array.isArray(value) || !value.every((p) => typeof p === 'string' && p.trim() !== '')) {
    return refuse('"protectedPaths" must be a list of paths or globs, like ["src/format/", "irrippr:ps/hydraulics/**"]');
  }
  const out: string[] = [];
  for (const raw of value as string[]) {
    const path = normalizeClaim(root, raw);
    if (!path.ok) return refuse(`"protectedPaths": ${path.error.replace(/^claim /, '')}`);
    if (!out.includes(path.value)) out.push(path.value);
  }
  return { ok: true, value: out };
}

/** The checkout whose novadev.json holds the rule: git's first worktree, when the project sits there too. */
export function ruleRoot(root: string): string {
  const main = worktreeList(root)?.[0]?.path;
  return main !== undefined && readManifest(novadevDir(main)) !== null ? main : root;
}

/** The project's claim policy. Throws on a setting that cannot be read (as every other setting does). */
export function claimPolicy(root: string): ClaimPolicy {
  const from = ruleRoot(root);
  const manifest = readManifest(novadevDir(from));
  const mode = parseClaimsSetting(manifest?.claims);
  if (!mode.ok) throw new Error(`novadev.json: ${mode.error}`);
  const paths = parseProtectedPaths(from, manifest?.protectedPaths);
  if (!paths.ok) throw new Error(`novadev.json: ${paths.error}`);
  return { mode: mode.value, protectedPaths: paths.value };
}

const isGlob = (path: string) => /[*?]/.test(path);

/** A glob as a pattern over a whole path: `**` crosses folders, `*` and `?` stay inside one name. */
function globRegex(glob: string): RegExp {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') {
        out += '(?:.*/)?';
        i += 2;
      } else {
        out += '.*';
        i += 1;
      }
    } else if (c === '*') out += '[^/]*';
    else if (c === '?') out += '[^/]';
    else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

/** Is `file` the protected path `pattern`, or inside it? */
function protects(pattern: string, file: string): boolean {
  if (!isGlob(pattern)) return pathWithin(file, pattern);
  const re = globRegex(pattern);
  const parts = file.split('/');
  for (let i = parts.length; i >= 1; i--) if (re.test(parts.slice(0, i).join('/'))) return true;
  return false;
}

/** Could `path` — a file or a folder — hold something `pattern` protects? (A folder above it counts.) */
function reaches(pattern: string, path: string): boolean {
  if (protects(pattern, path)) return true;
  if (!isGlob(pattern)) return pathWithin(pattern, path);
  const want = pattern.split('/');
  const have = path.split('/');
  for (let i = 0; i < have.length; i++) {
    if (i >= want.length) return false;
    if (want[i] === '**') return true;
    if (!globRegex(want[i]!).test(have[i]!)) return false;
  }
  return true;
}

/** The protected path a changed file lies under, or null. Always null under "lock" (every path is one-owner there). */
export function protectedBy(policy: ClaimPolicy, file: string): string | null {
  if (policy.mode !== 'notice') return null;
  return policy.protectedPaths.find((pattern) => protects(pattern, file)) ?? null;
}

/**
 * Overlaps as the policy reads them: `hard` ones are refused unless the lead allowed them
 * (--allow-overlap); `soft` ones are notices. Under "lock" every overlap is hard. Under "notice" an
 * overlap is hard only when the path the two share — the deeper of the two claims — reaches a
 * protected path.
 */
export function judgeOverlaps(policy: ClaimPolicy, overlaps: readonly Overlap[]): { hard: Overlap[]; soft: Overlap[] } {
  if (policy.mode === 'lock') return { hard: [...overlaps], soft: [] };
  const hard: Overlap[] = [];
  const soft: Overlap[] = [];
  for (const overlap of overlaps) {
    const shared = pathWithin(overlap.claim, overlap.theirs) ? overlap.claim : overlap.theirs;
    (policy.protectedPaths.some((pattern) => reaches(pattern, shared)) ? hard : soft).push(overlap);
  }
  return { hard, soft };
}

export function auditClaimPolicy(nd: string): { problems: string[] } {
  const manifest = readManifest(nd);
  const problems: string[] = [];
  const mode = parseClaimsSetting(manifest?.claims);
  if (!mode.ok) problems.push(mode.error);
  const paths = parseProtectedPaths(dirname(nd), manifest?.protectedPaths);
  if (!paths.ok) problems.push(paths.error);
  return { problems: problems.map((p) => `.novadev/novadev.json: ${p}. Until it is fixed, commands that judge claims are refused.`) };
}

/** The line that follows a refusal, by policy. */
export function refusalHint(policy: ClaimPolicy): string {
  return policy.mode === 'notice'
    ? 'These paths are protected ("protectedPaths" in novadev.json): one owner at a time. Ask the lead; --allow-overlap when they decided the two may share.'
    : 'Ask the lead; --allow-overlap when they decided the two may share.';
}

/** A path two worktrees both claim. */
export type SharedClaim = { path: string; between: [string, string]; worktrees: [string, string] };

const holderName = (h: ClaimHolder) => (h.kind === 'worktree' ? `worktree ${h.id}` : `${h.kind} ${h.id}`);

/**
 * Every path claimed from two different worktrees, each pair once — what `worktree list` and
 * `status` show, so both sides and the lead see who shares what. Computed from the registry on
 * every read: nothing to keep in step.
 */
export function sharedClaims(root: string): SharedClaim[] {
  const holders = claimHolders(root, null);
  const out: SharedClaim[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < holders.length; i++) {
    for (let j = i + 1; j < holders.length; j++) {
      const a = holders[i]!;
      const b = holders[j]!;
      if (samePlace(a.worktree, b.worktree)) continue;
      for (const mine of a.claims) {
        for (const theirs of b.claims) {
          if (!pathWithin(mine, theirs) && !pathWithin(theirs, mine)) continue;
          const path = pathWithin(mine, theirs) ? mine : theirs;
          const key = [a.worktree, b.worktree].sort().join('\n') + '\n' + path;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ path, between: [holderName(a), holderName(b)], worktrees: [a.worktree, b.worktree] });
        }
      }
    }
  }
  return out;
}
