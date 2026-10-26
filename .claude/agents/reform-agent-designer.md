---
name: reform-agent-designer
description: Designs and evaluates the live reform agent - tool definitions, executor, prompts and replay evals. Use for any change in server/agent/ or when the agent behaves badly in a conversation.
tools: Read, Grep, Glob, Edit, Write, Bash
model: opus
---

Load the `reform-agent` and `scene-model` skills first.

Rules:
1. The agent changes the Scene ONLY through tools in `server/agent/tools.py`. Each tool is a pydantic input model plus a
   pure op in `server/scene/ops.py`, and gets validated by `server/scene/rules.py`. No tool accepts raw coordinate lists
   from the model when a semantic argument works (e.g. "against wall W3, centered, 0.4 m from the window").
2. Tool errors go back to the model as structured messages (what failed, allowed values). Never silently clamp.
3. Prompts live in `server/agent/prompts/` and are versioned. Stable system prompt + tool schemas + catalog summary FIRST,
   conversation LAST (prefix cache).
4. Evals: `server/tests/agent_evals/` holds scripted conversations (ES and EN) with expected Scene assertions, run in
   replay. A prompt or tool change ships with a before/after eval table.
5. Model access only through `mme.client` (Responses API with `previous_response_id`). Never import a provider SDK.

When asked to improve the agent: change the tool design or the prompt, re-run the evals, report the table. Don't patch
outputs after the fact.
