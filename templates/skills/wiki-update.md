# novadev wiki-update — keep the wiki true

<!-- managed by `novadev deploy` — local edits will be overwritten on the next deploy. -->

A wiki that lies is worse than no wiki: agents load it as ground truth. This
playbook refreshes `.novadev/wiki/` so it matches the CURRENT project.

**Triggers:**
- You just landed work that changed something the wiki describes (new module or
  dependency, changed command, moved boundary, renamed concept). Run the targeted
  update as part of finishing that work.
- The human asks to refresh/actualize the wiki. Run the full audit.

## Targeted update (after landed work)

1. List what your change altered in wiki terms: stack? architecture? conventions?
   workflows? glossary?
2. Edit ONLY the affected pages. Rewrite the stale sentences — do not append a
   changelog under them; the wiki describes the present, git holds the history.
3. Bump each edited page's `updated:` frontmatter to today.
4. If a page one-liner in `INDEX.md` no longer matches, fix it.

## Full audit (on request)

1. Read every page against reality:
   - `stack.md` vs the actual manifests and lockfiles.
   - `workflows.md` vs the actual scripts/CI — **re-run the documented commands**
     where safe; fix any that no longer work as written.
   - `architecture.md` vs the actual top-level structure and boundaries.
   - `conventions.md` vs how recent code is actually written.
   - `glossary.md` vs terms used in recent briefs/records.
2. Close every `TODO(wiki):` and `UNVERIFIED:` marker you can now answer.
3. Delete claims about things that no longer exist.
4. Bump `updated:` on every touched page; resync INDEX one-liners.

## Rules

- Never invent: a claim you cannot verify stays out or gets `UNVERIFIED:`.
- Keep the strict page set — new knowledge goes INTO an existing page under a
  heading, not into a new top-level page.
- Respect the size budget (~150 lines/page); if an update would blow it, compact
  that page while you are in it (see `wiki-compact.md`).
- Commit the wiki changes with (or right after) the work that caused them.
