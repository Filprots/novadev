# novadev wiki-compact — keep pre-context cheap to load

<!-- managed by `novadev deploy` — local edits will be overwritten on the next deploy. -->

The wiki is loaded at the start of every substantive task, so its size is a tax on
every session. This playbook shrinks it without losing load-bearing knowledge.

**Triggers:** a page well over ~150 lines; overlapping/duplicated content across
pages; an INDEX that takes more than seconds to skim; the human asks to compact.

## Procedure

1. **Measure.** Line-count every page; note the offenders.
2. **Deduplicate.** The same fact stated on two pages keeps ONE home (the page
   whose table in `wiki-init.md` names it); the other page gets at most a one-line
   pointer.
3. **Cut what the repo already says.** Long command listings, config dumps, and
   API details duplicate the repository — replace with the file path and a one-line
   summary. The wiki says WHERE and WHY; the repo says WHAT exactly.
4. **Cut the dead.** Sections about removed features, abandoned plans, or old
   migrations go entirely — git remembers them.
5. **Compress the survivor prose.** Tables and terse sentences over paragraphs;
   every sentence must change what an agent would do.
6. **Do not compact away**: non-obvious decisions and their why, warnings/
   guardrails, and anything a memory or record links to. If a warning fits the
   memories folder better, MOVE it there (create the memory, then delete it here).
7. Bump `updated:` on every touched page; resync `INDEX.md` one-liners; commit.

## The bar

After compaction, a fresh agent reading INDEX + the two pages relevant to a task
should be fully oriented in under a few minutes of reading — and nothing they later
discover in the repo should contradict what they read.
