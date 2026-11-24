# prompt — merge-rules-for-parallel-branches

**Source:** chat-initiated, filed by the agent with /novadev-file-a-todo — 2026-11-10

## Merge rules for the log and derived files, written by deploy

Two branches that both touch the knowledge log or derived files (index.md, features' work.md/tests.md, todos' completed.md) conflict. `novadev deploy` should write the .gitattributes rules (log.md merge=union; derived files merge=novadev-derived keeping ours) and the merge driver config, and `novadev sync --after-merge` regenerates and commits the derived files.

## Context from the conversation

From the Paperclip HQ (2026-11-10, docs/team-discipline.md §3 in ~/_work/paperclip): the IRRIS company now runs agents in parallel, each file-changing task in its own worktree across the super-repo ~/_work/IRRIS/_ecosystem and its git-ignored sub-repos repos/* (scripts/irris-worktree in ~/_work/paperclip, super-repo commit 3f7dc9b for the .gitattributes). Today this works by convention around novadev; these todos make novadev understand it. The owner: "think on how you really can change novadev framework to properly work with cases of multi-worktrees across multiple repos" — and yes to filing them here.
