# prompt — todo-recipient

**Source:** chat-initiated, filed by the agent with /novadev-file-a-todo — 2026-11-24

## A todo may name its recipient: only that recipient works it; a todo without one is anyone's

Board (Filipp, 2026-11-24, in the IRRISketch headquarters session): "sometimes there is a need to establish a connection from the paperclip to the headquarters session. I feel that we need some mechanism of posting remarks, notes, or some headquarters targeted to-dos. Maybe you can make up a feature for a to-do recipient in a Nova Dev framework. What that will mean, that each Nova Dev to-do will have an optional field of recipient. And in this case, we can freely set up to-dos for headquarters session and then process them in that session. And if no recipient, anyone can process that. Feels like that's a Nova Dev feature. So please, you can edit that framework, which is also mine. So please complete the to-do there, make it, implement it, and update all users of the Nova Dev."

Wanted:
1. A todo has an optional recipient (in its todo.json, beside priority and the "do after" links): who the todo is addressed to. A todo without one is anyone's, exactly as today.
2. It is set when the todo is filed (`novadev file-todo`, a part's `recipient`) and changed or removed later with a command that records who did it and when.
3. Every list shows it (`novadev todo list`, `novadev status`, their JSON, `novadev todo show`, sync's NEXT ACTIONS), and `novadev todo list` can be narrowed to one recipient, so a session can ask "what is addressed to me".
4. `novadev work start` refuses a todo that is addressed to somebody else and says who it is for.
5. A project may name its recipients and what belongs to each (a setting in novadev.json), so a filing to a name nobody answers to is refused instead of waiting forever.
6. The playbooks, the README, the CLI help and the folder README teach it; a project without recipients prints and behaves exactly as before.

## Context from the conversation

The case that started it (IRRISketch, 2026-11-24): the company's Tester found two things about tools that belong to the headquarters session (novadev itself, and the project's ./dev). The company's agents may not change those tools, so today such a note travels on a question card to the board, and the board carries it by hand into a headquarters session. With a recipient the company files a todo addressed to the headquarters session, and that session reads its own list when it starts. The company's lead takes every open ready todo into its run (`novadev todo list --state open`), so a todo for the headquarters session must be visibly not the company's, and a start on it by a company agent must be refused.
