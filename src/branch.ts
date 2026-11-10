// Where finished work may be archived: on the project's DEFAULT branch only.
//
// Archiving moves folders (todos/<batch> → archive/<year>/todos/<batch>, a reviewed test round →
// archive/<year>/totest/…). When parallel branches each run `novadev sync`, each moves the same
// folders, and the two moves conflict when the branches merge. So the move happens in one place —
// the branch the work lands on — and a task branch only says what the default branch will archive.
//
// The default branch is `"defaultBranch"` in novadev.json when the project names one, else what git
// says (`defaultBranch` in git.ts). Outside git, or when git cannot tell, archiving works as it
// always did.
import { defaultBranch, headSummary } from './git.ts';
import { type Parsed, novadevDir, readManifest, refuse } from './lib.ts';

/** `"defaultBranch"` in novadev.json: a branch name, or null (absent, null: git decides). */
export function parseDefaultBranchSetting(value: unknown): Parsed<string | null> {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== 'string' || value.trim() === '' || /\s/.test(value.trim())) {
    return refuse('"defaultBranch" must be a branch name, like "main" — or null to let git say');
  }
  return { ok: true, value: value.trim() };
}

/** The project's default branch: the setting, else git's answer. Null outside git, or when git cannot tell. */
export function projectDefaultBranch(root: string): string | null {
  const setting = parseDefaultBranchSetting(readManifest(novadevDir(root))?.defaultBranch);
  return defaultBranch(root, setting.ok ? setting.value : null);
}

export type ArchivePlace = {
  /** May finished work move into the archive here? */
  allowed: boolean;
  /** The branch checked out (null: detached, or not in git). */
  branch: string | null;
  defaultBranch: string | null;
  /** Why not, in a few words — null when allowed. */
  why: string | null;
};

/** Whether this checkout is the place where finished work is archived. */
export function archivePlace(root: string): ArchivePlace {
  const summary = headSummary(root);
  if (summary === null) return { allowed: true, branch: null, defaultBranch: null, why: null };
  const def = projectDefaultBranch(root);
  if (def === null || summary.branch === def) return { allowed: true, branch: summary.branch, defaultBranch: def, why: null };
  return {
    allowed: false,
    branch: summary.branch,
    defaultBranch: def,
    why: summary.branch === null ? `HEAD is detached, not on ${def}` : `this is branch ${summary.branch}, not ${def}`,
  };
}
