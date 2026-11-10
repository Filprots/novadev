<!-- DERIVED by `novadev sync` from the frontmatter of the concepts listed here. Do not edit: it is rewritten. Change a concept, then run `novadev sync`. -->

# Gotchas

* [A project root is not a worktree top — compare by containment, never by equality](worktree-tops-are-not-project-roots.md) - When code compares a project root (where .novadev/ is) with paths from `git worktree list`, `git rev-parse --show-toplevel` or a registry entry — the project may sit below its repository's top.
* [Bumping NOVADEV_VERSION stops this repository's own novadev until it is migrated](bump-the-version-last.md) - When you work on novadev itself and are about to change NOVADEV_VERSION (src/lib.ts) or package.json's version — do it last in the batch, then migrate-repo and deploy here at once.
