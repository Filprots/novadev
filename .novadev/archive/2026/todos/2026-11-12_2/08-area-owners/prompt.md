# prompt — area-owners

**Source:** chat-initiated, filed by the agent with /novadev-file-a-todo — 2026-11-12

## Area owners: who builds and who must review each area

Board (Filipp, 2026-11-12, HQ session), on the eight proposals "robust parallel work, as big companies do it": "I want it all, sounds perfect go on! My whole company waits for it!" (before: "I want to make it really robust how big corps do it!", and: "I feel like we are going wrong way and the batch must be tackled only by a one dev or a coherent team"). Proposal 7. Project settings map areas to people: `owners` in `novadev.json` — by feature `area` and/or by path globs (per repo for super-repos) → `owner` (the developer who normally takes work there) and `reviewers` (who must review). `file-todo` (and `todo show`, `status --json`) name the suggested owner for a todo from the features/paths it names; `worktree mr` names the required reviewers for the files the branch changed; `novadev todo review` in team mode refuses an approval that lacks a required reviewer's review (the lead can override with a recorded reason). `novadev owners <path|area>` answers who owns something. Off when the setting is absent.

## Context from the conversation

Why: related todos should go to the same developer (a coherent team owns an area of the product, not a list of files), and a change to a sensitive area needs its owner's eyes — the CODEOWNERS idea. Features already carry `area:` and `touches:`.

Tests: suggestion from area and from path; MR lists reviewers; approval refused without the required reviewer, passes with it or with a recorded override; absent setting changes nothing.

Part of one design (proposals 1–8, todos of this batch): the unit of work is the todo — one owner, one worktree, one merge request; a batch is only a group; conflicts are caught when merging (a merge queue), not by locking files in advance; todos carry priority and order. Build order: 1; then 2 with 3; then 4–8. Everything written by 0.17.0 (locks, registry entries, worktrees, batches in work) must keep reading unchanged; new settings are off when absent unless the todo says otherwise.
