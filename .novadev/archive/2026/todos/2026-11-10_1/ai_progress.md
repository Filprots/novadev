# ai_progress — batch 2026-11-10_1 (the plan, and the decisions that govern it)

**Date:** 2026-11-10

## Decisions settled with the human (2026-11-10, one round)

1. **Lock place (01):** BOTH. `todos/<batch>/working.md` stays (the trail and the pause record stay
   in git and travel with the branch). Every `novadev work` command also writes a small entry to
   `<git-common-dir>/novadev/locks/<batch>.json`, which every worktree reads. `work start` refuses a
   batch that is live in another worktree. `status` lists `git worktree list` with each worktree's
   branch and locked batch.
2. **Merged = (06):** in team mode, a todo is merged when every hash on its record's `**Commits:**`
   line is reachable from the default branch (a sub-repo's `repo@hash` from that repo's default
   branch). A record that names no commit counts once the record itself is committed on the default
   branch.
3. **Commits:** one commit per todo on master as each lands and passes the tests; the first commit
   holds the deployed novadev files + the wiki and the registry (done: 5fea3d8). The 0.16.0 bump and
   the docs go in the last commit. Never push.

## Waves (by dependency, not folder order)

1. **04** archive only on the default branch: adds the default-branch question to `src/git.ts`
   (`"defaultBranch"` in novadev.json, else origin/HEAD, else main/master). 06 and 07 use it.
2. **02** `repo@hash` and `**Repos:**`: `"subrepos"` in novadev.json; `links`, `placement` and
   `work.md` resolve a commit in its own repository. 06 and 07 use it.
3. **03** merge rules: `deploy` writes a managed block into `.gitattributes` (log.md union; the
   derived files merge=novadev-derived) and the driver into the clone's git config;
   `sync --after-merge` repairs the log (one section per day, newest first), regenerates, commits.
4. **01 + 05** one seam: the registry in the git common dir carries the lock AND its claims; `work
   start` refuses an overlap with a batch locked in another worktree. Claims come from `--claim`,
   `novadev work claim`, and the `touches:` of the features the batch's files name.
5. **06** `ai_review.md` (APPROVE / CHANGES) + `novadev todo review`; `"team": true` makes
   completed = APPROVE + merged (decision 2).
6. **07** `novadev worktree create|list|status|gate|mr|sync|merge|remove`, built on 01/02/03/05;
   the worktree registry sits beside the locks.
7. Release 0.16.0: README, CLI help, the playbook, docs tests.

## Builder decisions (inside the briefs)

- New settings are optional and absent = off (no migration): `defaultBranch`, `subrepos`, `team`,
  `worktree`.
- novadev's git WRITES stay out of `src/git.ts` (read-only by its contract): the after-merge commit
  and the worktree command own their writes.
