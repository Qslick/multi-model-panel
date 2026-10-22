---
description: Convene the multi-model panel (Codex + Gemini + Grok + fresh Claude) on a decision, plan, diff, or completed work
argument-hint: <decision, plan, diff or git ref, or 'completion check'>
disable-model-invocation: true
---

The user has explicitly convened the panel. Invoke the `multi-model-panel` skill via the Skill tool now, before any other response.

- If `$ARGUMENTS` is non-empty, pass it as the skill's `args`; it is the decision, plan, diff, or "completion check" to put before the panel.
- If `$ARGUMENTS` is empty, ask what to put before the panel and stop.

Do not answer the question yourself before the panel has ruled. The skill defines the protocol (identical packet, parallel seats, synthesis, ruling with seat attribution) and must drive it.
