# prompt — batch-path-ownership

**Source:** chat-initiated, filed by the agent with /novadev-file-a-todo — 2026-11-10

## Batches declare the paths they own; overlapping batches cannot run in parallel

One owner per file: a batch declares the paths it will touch (from its features' `touches:`), and `novadev work start` refuses a batch whose paths overlap a batch locked in another worktree (building on `features --touching`).

## Context from the conversation

From the Paperclip HQ (2026-11-10, docs/team-discipline.md §3 in ~/_work/paperclip): the IRRIS company now runs agents in parallel, each file-changing task in its own worktree across the super-repo ~/_work/IRRIS/_ecosystem and its git-ignored sub-repos repos/* (scripts/irris-worktree in ~/_work/paperclip, super-repo commit 3f7dc9b for the .gitattributes). Today this works by convention around novadev; these todos make novadev understand it. The owner: "think on how you really can change novadev framework to properly work with cases of multi-worktrees across multiple repos" — and yes to filing them here.
