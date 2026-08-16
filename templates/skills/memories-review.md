# novadev memories-review — actualize the guardrails

<!-- managed by `novadev deploy` — local edits will be overwritten on the next deploy. -->

Memories in `.novadev/memories/` are trusted blindly by future agents — a stale
memory actively misleads. This playbook verifies, refreshes, and prunes them.

**Triggers:** the human asks to review/clean memories; a memory contradicted
reality during other work; periodic hygiene (e.g. when the INDEX grows past ~30
entries).

## Procedure — for EVERY memory file

1. **Re-verify the claim** against the current project: open the files/configs/
   commands the memory talks about and check the fact still holds. A memory about
   a command → run it if safe; about a code trap → read that code.
2. Decide one of four fates:
   - **Still true** → bump `verified:` to today. Done.
   - **True but drifted** (paths renamed, numbers changed, workaround now has a
     better form) → rewrite the body to match reality, bump `verified:`.
   - **Obsolete** (the trap/decision no longer exists, or the repo/wiki now states
     it properly) → DELETE the file. Git keeps the history.
   - **Cannot verify** (needs hardware, an external system, a rare condition) →
     leave `verified:` as is and add a line `unverifiable-since: <date> — <why>`;
     after it stays unverifiable across two reviews, recommend deletion to the
     human.
3. **Judge relevance, not just truth.** A true memory that no longer saves anyone
   time (one-off trivia, superseded workflow) is junk — delete it.
4. **Merge near-duplicates** into the stronger file; delete the weaker; keep slugs
   stable where other records link to them.

## Finish

- Rebuild `INDEX.md`: exactly one line per surviving memory, ordered newest-first,
  each line naming when the memory applies.
- Report to the human: kept / rewritten / deleted / unverifiable counts, and list
  the deletions with one-line reasons.
- Commit.
