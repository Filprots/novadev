---
type: Decision
title: "\"The builder never tests its own round\" is a playbook rule, not a code check — actors name a model, not a session"
description: "When you are tempted to make novadev refuse a test result or an escalation because its `by` equals the builder's actor (`**Built by:**` in ai_needstest.md)."
tags: [tester, builder, actor, test-result, escalate, built-by, independence]
created: 2026-11-24
sources:
  - id: made
    resource: todo:2026-11-24_3/01-tester-agent-testing
    title: testing moved from the human to a tester agent
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-24T19:17:08+01:00 }
stale_after: 2027-05-23T19:17:08+01:00
---
A tester must be an agent that did not build the work, but novadev does not enforce it in code.[^made]

**Why:** an actor is `<tool>/<model>` (`claude-code/claude-opus-5-5`), so the builder and a
legitimate tester in a fresh session or a sub-agent usually carry the SAME actor; a session id
does not help either (a sub-agent shares its parent's `CLAUDE_CODE_SESSION_ID`). A check on
`by` would refuse exactly the testers the design wants. What makes a tester independent is a
fresh context, which no file shows.

**How to apply:** keep the rule in the playbooks (`novadev-work` phase 5, `novadev-test`), and
keep the traceability instead: `**Built by:**` in `ai_needstest.md`, `**Tested by:**` in each
result and in `ai_confirmed.md`. If a project ever needs it enforced, give testers their own
actor (e.g. `paperclip/tester`) and check against that — not against the model.
