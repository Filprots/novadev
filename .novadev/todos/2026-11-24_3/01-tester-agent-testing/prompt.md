# prompt — tester-agent-testing

**Source:** chat-initiated, filed by the agent with /novadev-file-a-todo — 2026-11-24

## Testing is done by a tester agent, not the human: the builder writes the plan for a tester, the tester builds its tools, runs and reviews; the human only on escalation

I want to shift away from the manual human testing. I want you to switch to test feature and make it for the bots only. So the agent who works on the feature writes what he needs to test for a tester, and tester goes through this and reviews the testing. And only if the tester cannot run the test himself somehow, he reaches out the human. But the main task for a tester is to implement the testing tools, utils, platforms he needs to test it thoroughly, and only ask human for some maybe filling or to minimize his testing in this workflow. So let's shift to this paradigm and then update all the frameworks that are using the novadev with this.

## Context from the conversation

Keep the totest/ layout (one living task per feature, test-plan.md, test-results/, the ai_needstest.md gate, ai_confirmed.md) so existing open rounds in consumer projects keep working; change who walks it. The builder never tests its own round. Escalation to the human is a recorded, per-scenario ask (`novadev test-result escalate`) and is the only testing that shows under WAITING ON THE HUMAN. Roll-out: `novadev deploy` in every project on this machine that uses novadev.
