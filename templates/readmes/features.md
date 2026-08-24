# features — what this software does

<!-- managed by `novadev deploy`. -->

The registry of capabilities. One file per feature,
`FEAT-NNNN-<kebab-slug>.md`, with a frontmatter header (`id`, `title`, `status`,
`area`, `created`, `updated`, `tags`, `touches`, and the relationship fields
`depends-on` / `supersedes` / `superseded-by` / `conflicts-with`) and a fixed body:
what it does, how it works, progress log, work links, commits, open questions.

The wiki says how the project is **built**; this says what it **has**. Its absence
is the signal that an agent must create it (`../skills/feature-init.md`).

**Search it before building anything new** — that is what it is for:

```sh
novadev features <query>            # name / area / tags / body
novadev features --touching src/x   # which features already own this code
novadev features --status planned
novadev features --new <slug>       # scaffold the next FEAT-NNNN
```

`INDEX.md` and the `## Work` / `## Commits` sections are **derived** — regenerated
by `novadev links --fix` from the `**Feature:**` / `**Commits:**` lines in todo
records. Never hand-edit inside the `<!-- novadev:*:begin/end -->` markers.

Playbooks: `../skills/feature-init.md` (create), `feature-check.md` (pre-flight a
proposal), `feature-update.md` (keep true after work lands), `links-audit.md`
(validate/repair the graph).
