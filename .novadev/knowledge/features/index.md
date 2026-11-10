<!-- DERIVED by `novadev sync` from the frontmatter of the concepts listed here. Do not edit: it is rewritten. Change a concept, then run `novadev sync`. -->

# close-out

* [● FEAT-0003 — Doctor: a read-only structure check](FEAT-0003-doctor/feature.md) - shipped · Run `novadev doctor` to validate a project's whole .novadev/ tree without changing anything — batch and todo naming, records, test tasks, the link graph, the knowledge bundle, metrics settings, placement, the locks, the deployed version — exiting 1 on problems.
* [● FEAT-0008 — sync: the close-out, and its --check gate](FEAT-0008-sync-close-out/feature.md) - shipped · Run `novadev sync` after every round to measure (if set), regenerate every derived file, archive what is finished, validate the tree, and get two lists — NEXT ACTIONS for the agent and WAITING ON THE HUMAN; `--check` writes nothing and fails, for a hook or CI.
* [● FEAT-0017 — Merge rules for parallel branches, and sync --after-merge](FEAT-0017-merge-rules/feature.md) - shipped · Branches that both record knowledge or regenerate derived files merge without conflicts: deploy writes a .gitattributes block (the log by union, derived files keep ours) and the merge driver, and `novadev sync --after-merge` repairs the log, regenerates and commits.

# knowledge

* [● FEAT-0005 — Features registry and the link graph](FEAT-0005-features-and-links/feature.md) - shipped · Register each capability as knowledge/features/FEAT-NNNN-<slug>/feature.md, search the registry before building (`novadev features`, `--touching <path>` for overlap, `--new <slug>` to scaffold), and get each feature's work.md and tests.md derived from the records and test rounds that name it (`novadev links [--fix]`).
* [● FEAT-0013 — The knowledge bundle (OKF) and the knowledge log](FEAT-0013-knowledge-bundle/feature.md) - shipped · Keep a project's wiki, memories and features as one Open Knowledge Format 0.2 bundle in .novadev/knowledge/ — every concept stamped with who wrote and who checked it and when it is due, every change recorded by `novadev knowledge log`, derived index.md maps, and `novadev knowledge` to search it and list what is stale, drifted or unverified.
* [● FEAT-0016 — Sub-repos: commits in nested repositories](FEAT-0016-sub-repos/feature.md) - shipped · A super-repo lists its nested repositories in "subrepos" (novadev.json); a record names a sub-repo's commit as `irrippr@abc1234` and the sub-repos it changed in `**Repos:**`, and links, work.md and the placement check resolve each commit in its own repository.

# metrics

* [● FEAT-0011 — Metrics hook, debt budget and the wiki budgets block](FEAT-0011-metrics-debt-budget/feature.md) - shipped · Let a project plug in one metrics command whose JSON (known debt, hubs) `novadev sync` stores in metrics/latest.json, compares with the last commit, lists every growth until a record explains it, and gates with a debt budget that only a `## Debt` raise in this round can lift.
* [● FEAT-0012 — Placement check and hubs](FEAT-0012-placement-and-hubs/feature.md) - shipped · Name a project's hubs (from the metrics snapshot or `hubs` in novadev.json) so that every record whose commits changed a hub must say in a `## Placement` section where its new code went, and see with `novadev features --hubs` which features lean on each hub.

# setup

* [● FEAT-0001 — Deploy: the novadev tree, the playbooks and the agent adapters](FEAT-0001-deploy-and-adapters/feature.md) - shipped · Run `novadev deploy` in any project to create or refresh .novadev/ (folders, READMEs, manifest, knowledge bundle seed), the five novadev-* playbooks, and the adapters that route Claude Code, Cursor and AGENTS.md-reading agents to them.
* [● FEAT-0007 — migrate-repo: version-aware layout migrations](FEAT-0007-migrate-repo/feature.md) - shipped · After pulling a newer novadev, run `novadev migrate-repo` in a project to apply every layout migration it has not reached yet, in order, then stamp the new version (`--dry-run` previews, a dirty tree needs `--force`).

# testing

* [● FEAT-0006 — The human-testing queue (totest)](FEAT-0006-totest-queue/feature.md) - shipped · Hand work an agent cannot check to a person as a stepped test plan in totest/<task>/, gate the todo with ai_needstest.md so the batch cannot archive, and see what is waiting with `novadev totest` (or `--json`).
* [● FEAT-0010 — Recording a person's test results](FEAT-0010-test-result-recording/feature.md) - shipped · Walk the test queue with a person (`/novadev-what-to-test`) or take a round they already did (`/novadev-test-review`), and file what they found — verdicts, notes, change requests, screenshots — into the task's test-results/ with `novadev test-result tasks|write|review`, always appending.

# work

* [● FEAT-0002 — Batches and the stock-take: novadev new and novadev status](FEAT-0002-batches-and-status/feature.md) - shipped · Scaffold today's next batch of todo folders with `novadev new`, and see at a glance — or as JSON for a tool — what is in work, which todos are open and in what state, what is postponed, and how the knowledge and metrics stand with `novadev status`.
* [● FEAT-0004 — Archive with a grace period](FEAT-0004-archive-grace-period/feature.md) - shipped · Finished batches are marked with an autogenerated completed.md and kept in todos/ for archiveGraceDays (default 3) before moving to archive/<year>/todos/; reviewed test rounds archive at once; `novadev archive <batch>` or `--done` overrides the grace; the moves happen on the default branch only.
* [● FEAT-0009 — Filing a todo from chat](FEAT-0009-todo-filing/feature.md) - shipped · Turn what a person says in a chat (terminal or phone) into real todo folders — their words as a prompt.md brief, their screenshots copied in — with `/novadev-file-a-todo` and its command half, `novadev file-todo plan` and `file <payload.json>`.
* [● FEAT-0014 — The work lock: waypoints, pause and resume](FEAT-0014-work-lock/feature.md) - shipped · Mark a batch as in work with a lock (todos/<batch>/working.md) that says who holds it and where the work is — `novadev work start`, `waypoint`, `pause` (the command half of /novadev-pause) and `stop` — so a later session resumes from the last waypoint, and status, sync, archive and filing respect it.
* [● FEAT-0015 — novadev todo: one todo at a time, away from the repository](FEAT-0015-todo-command/feature.md) - shipped · Let a tool acting for a person who is away from the repository (a chat bot) list open todos, show one as JSON, append a dated chat addendum with attachments, edit a brief (keeping the old one), or cancel a todo — `novadev todo list|show|addendum|edit|cancel` — under the playbook's intake rules.
