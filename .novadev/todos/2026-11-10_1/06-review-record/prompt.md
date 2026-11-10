# prompt — review-record

**Source:** chat-initiated, filed by the agent with /novadev-file-a-todo — 2026-11-10

## A review record in the chain

Add `ai_review.md` (verdict APPROVE / CHANGES, the checks run with results, the reviewer) to the record chain. In a team mode (novadev.json), a todo counts as completed only with an APPROVE review and a merge commit on the default branch.

## Context from the conversation

From the Paperclip HQ (2026-11-10, docs/team-discipline.md §3 in ~/_work/paperclip): the IRRIS company now runs agents in parallel, each file-changing task in its own worktree across the super-repo ~/_work/IRRIS/_ecosystem and its git-ignored sub-repos repos/* (scripts/irris-worktree in ~/_work/paperclip, super-repo commit 3f7dc9b for the .gitattributes). Today this works by convention around novadev; these todos make novadev understand it. The owner: "think on how you really can change novadev framework to properly work with cases of multi-worktrees across multiple repos" — and yes to filing them here.
