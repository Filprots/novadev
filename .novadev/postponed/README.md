# postponed — deferred with a trigger

<!-- managed by `novadev deploy`. -->

Work that is real but blocked on a precondition. One file per item:

```markdown
---
title: <what it is, one line>
postponed: <YYYY-MM-DD>
do-when: <the concrete TRIGGER that makes it doable>
discard-if: <the condition that makes it OBSOLETE>
---
<what the work is + where it plugs in, enough to act on later>
```

Agents scan these headers whenever taking stock of open work: trigger met →
surface for promotion to a todo; `discard-if` true or plainly stale → recommend
deletion; otherwise report it as parked. Never let an item rot unread.
