# prompt — records-from-before-a-repository-move

**Source:** chat-initiated, filed by the agent with /novadev-file-a-todo — 2026-11-24

## A project that moved repositories: old records' commits and `**Repos:**` lines flood sync's NEXT ACTIONS

Board (Filipp, 2026-11-24, in the IRRISketch headquarters session), on the finding that `novadev sync` in IRRISketch lists 1,594 next actions of which 1,455 are leftovers of the move to one repository: "yes clean them! there is too much."

The two kinds:
1. 667 lines "commit <hash> (<todo>) is not in this repository's history": records written while the projects were separate repositories. Their commits live in those old repositories; this repository's history starts later. 662 are from batches before 2026-11-17, 5 from that day.
2. 788 lines "<todo>: **Repos:** names \"irrippr\", which is not a sub-repo — add its folder to \"subrepos\" in novadev.json, or correct the name": since the move the project has no sub-repos (`"subrepos": []`), its former sub-repos are plain folders, and records still say which folders a todo touched — about 40 new lines a day.

Wanted: a project can say (a) from which day its records' commits are in this repository, so older records are not asked for commits it cannot have, and (b) that it has no sub-repos, so a `**Repos:**` line is not judged. A commit that is really missing from a record dated after that day is still listed, and a project that says neither behaves exactly as before.

## Context from the conversation

Agents are told to work sync's NEXT ACTIONS in at most three passes; a list that is 91% leftovers hides the 140 real items (open todos, records without a feature line, test results to review). `placementSince` is the precedent: records dated before it are not checked for a `## Placement` section.
