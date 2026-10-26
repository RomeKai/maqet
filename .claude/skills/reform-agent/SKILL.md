---
name: reform-agent
description: How the live reform agent works - Muse Spark 1.3 tool calling over the Responses API, tool catalog, conversation rules, voice, costs and evals. Use when building or debugging server/agent or web/src/agent.
---

# Loop
1. User message (text, or push-to-talk → `POST /v1/asr/transcribe` → text). Any language: answer in the user's language,
   in text only (no TTS, ADR-017). Keep answers to one or two short lines: the 3D shows the result.
2. `mme.client` Responses call: stable system prompt + tool schemas + compact Scene summary (ids, rooms, current
   materials, furniture) FIRST, the user turn LAST; `previous_response_id` keeps reasoning across turns.
3. The model emits tool calls → `server/agent/executor.py` runs each op on the Scene (validated) → results/errors return
   as tool outputs → loop until the model answers in text (max 6 tool rounds per user turn).
4. The API streams to the PWA: Scene patch (changed ids) + assistant text. The 3D view updates in place.

# Stages and toolsets (ADR-014): the server only exposes the current stage's tools
| Stage | Tools (P0) | P1 |
|---|---|---|
| Capture | (none: deterministic corner/scale editor) | |
| Reform | `remove_wall`, `add_wall`, `undo` | `move_opening`, `resize_opening`, `split_room` |
| Design | `list_catalog`, `set_material`, `place_furniture`, `move_item`, `rotate_item`, `remove_item`, `apply_style`, `undo` | `generate_material`, `concept_piece`, `apply_brand_kit` |
| Present | `create_variant`, `render_view` | |
| Deliver | (none: export buttons) | |

Arguments are semantic, not raw coordinates: `place_furniture(catalog_id, room, anchor="against wall facing window")`,
`remove_wall(between="kitchen", and_="living")`, `add_wall(room, from_wall, to_wall, at_ratio)`.
`apply_style(name)` expands a preset (`assets/styles/*.json`: japandi, industrial, nordic, mediterranean, classic) into
`set_material` + furniture swaps, as ONE undoable step.
The user's tap selection arrives as context (`selected: {kind, id}`). "This" / "esto" refers to it.
Cross-stage requests ("open the kitchen" while in Design): no action; answer with a one-tap suggestion to switch stage.
`render_view` and (P1) `generate_material` cost money: only on explicit request.

# Conversation rules (system prompt)
- Act, then say briefly what changed. Ask only when a request is ambiguous *and* the choice matters
  ("which sofa: 2 or 3 seats?"). Offer 2 options at most.
- Never claim an imagined item is a real product; say "concept".
- Respect rules errors: explain them in plain words and propose the closest valid alternative.
- Never call `render_view` or `generate_material` without an explicit user request (they cost money).

# Costs (Spark 1.3 draft tier during dev, standard for the demo recording)
A typical turn is ~6-10k input tokens (mostly cached prefix) + ~1k output. Track it with tag `agent`. Keep the Scene summary
compact (ids + names, no full polygons).

# Evals (server/tests/agent_evals/, replay)
Scripted conversations with Scene assertions, e.g.
`"piso de roble claro en el living"` → living floor material == catalog oak-light;
`"a 3-seat sofa facing the window"` → one sofa in the living room, front toward the window wall, no rule violations.
Record new fixtures with `MME_MODE=live` (human only), commit them, run in replay forever after.
