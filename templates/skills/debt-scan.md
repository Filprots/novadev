# novadev debt-scan — turn technical debt into todos

<!-- managed by `novadev deploy` — local edits will be overwritten on the next deploy. -->

This playbook sweeps the project for accumulated technical debt and files the
confirmed findings as a fresh batch of novadev todo briefs. It is **scan-and-file
only** — fixing anything is a later batch the human schedules.

**Trigger:** the human asks to find tech debt / audit the codebase / fill a batch
from what is rotting.

## Where to look (all of these, not just the code)

1. **The code**: TODO/FIXME/HACK markers; dead code and unused exports; duplicated
   logic; suppressed warnings and type-system escape hatches; failing/skipped/
   flaky tests; deprecated API usage; outdated dependencies with known issues;
   violations of the project's own `wiki/conventions.md`.
2. **The records**: `.novadev/` records (todos + archive) that mention "follow-up",
   "known limitation", "deferred", "workaround" — debt the project already
   confessed to but never scheduled.
3. **Postponed items** whose `do-when` trigger is now satisfied — surface them for
   promotion (per the workflow rule) rather than duplicating them as new briefs.
4. **The wiki**: open `TODO(wiki):` / `UNVERIFIED:` markers; documented workflows
   that no longer work.
5. **Memories** of kind `guardrail`/`gotcha` describing workarounds whose proper
   fix never happened.

## Verify before filing

Each candidate finding must be CONFIRMED against the current code (open the file,
check the smell is real and still present) — a debt brief that sends a future agent
to a non-existent problem is itself debt. Drop what you cannot confirm.

## File the findings

1. Create a new batch: `novadev new` (or hand-create `todos/YYYY-MM-DD_N/`).
2. One todo folder per coherent finding (group tiny same-area items), named
   `NN-<slug>` in rough priority order, each with a brief `prompt.md`:

```markdown
# <one-line title>

**Debt kind:** <marker-rot | duplication | dead-code | test-gap | suppression |
  dependency | convention-violation | confessed-follow-up | broken-doc | …>
**Evidence:** <file paths + line refs, record/memory links — enough to relocate it>
**Why it costs:** <what it slows, risks, or blocks>
**Suggested fix:** <one paragraph, honest about size>
```

3. If the sweep was bounded (folders skipped, categories not checked), say so in a
   `00-program` note in the batch — a scan that silently claims completeness is
   itself misleading.
4. Report to the human: findings count by kind, the batch path, and the top 3 items
   you would fix first and why. Commit the new batch.
