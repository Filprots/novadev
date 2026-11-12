# prompt — claims-warn-protected-paths-lock

**Source:** chat-initiated, filed by the agent with /novadev-file-a-todo — 2026-11-12

## Claims become notices; only the project's protected paths stay hard locks

Board (Filipp, 2026-11-12, HQ session), on the eight proposals "robust parallel work, as big companies do it": "I want it all, sounds perfect go on! My whole company waits for it!" (before: "I want to make it really robust how big corps do it!", and: "I feel like we are going wrong way and the batch must be tackled only by a one dev or a coherent team"). Proposal 2. By default an overlapping claim no longer refuses: `work start`, `worktree create`, `worktree claim` and `work claim` print who else is in that file or folder and go on (recorded in the registry so both sides and the lead see it: `worktree list`, `status`). A new setting `protectedPaths` (project `novadev.json`, per repo for super-repos: paths or globs) names where a claim stays a hard, one-owner lock exactly as today (`--allow-overlap` on the lead's decision still passes). The gate's "changed outside the claims" check becomes: a failure only for a changed file under a protected path that this worktree does not hold; elsewhere it lists the files shared with other open worktrees as a notice in the gate output and the MR. A project opts in with a setting (e.g. `claims: "notice"` beside `protectedPaths`); without it claims stay hard locks as in 0.17.0, so no project changes behaviour by upgrading alone.

## Context from the conversation

Why: claims are locks taken in advance; most coordination trouble on 2026-11-12 (refused claims, `--allow-overlap` rounds through the lead, blocked developers) came from them. Companies let two people edit one file and catch conflicts at merge time with tests; "code owners" decide only who reviews. IRRIS has hidden coupling, so a few areas (saved-project format, hydraulics core, payment) stay hard locks. Goes live only together with the merge queue (proposal 3), which is the real guard.

Tests: overlap outside protected paths → both proceed, both listed; overlap under a protected path → refused as today; gate passes with a shared unprotected file and names it; gate fails on an unheld protected file.

Part of one design (proposals 1–8, todos of this batch): the unit of work is the todo — one owner, one worktree, one merge request; a batch is only a group; conflicts are caught when merging (a merge queue), not by locking files in advance; todos carry priority and order. Build order: 1; then 2 with 3; then 4–8. Everything written by 0.17.0 (locks, registry entries, worktrees, batches in work) must keep reading unchanged; new settings are off when absent unless the todo says otherwise.
