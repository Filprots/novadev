# prompt — worktree-visible-locks

**Source:** chat-initiated, filed by the agent with /novadev-file-a-todo — 2026-11-10

## Batch locks visible from every worktree

A lock taken with `novadev work start` lives in todos/<batch>/working.md on the current branch, so other worktrees of the same repo cannot see it. Keep locks in the git common dir (`$(git rev-parse --git-common-dir)/novadev/locks/<batch>.json`) so every worktree sees them; `novadev status` lists `git worktree list` with each worktree's branch and locked batch.

## Context from the conversation

From the Paperclip HQ (2026-11-10, docs/team-discipline.md §3 in ~/_work/paperclip): the IRRIS company now runs agents in parallel, each file-changing task in its own worktree across the super-repo ~/_work/IRRIS/_ecosystem and its git-ignored sub-repos repos/* (scripts/irris-worktree in ~/_work/paperclip, super-repo commit 3f7dc9b for the .gitattributes). Today this works by convention around novadev; these todos make novadev understand it. The owner: "think on how you really can change novadev framework to properly work with cases of multi-worktrees across multiple repos" — and yes to filing them here.
