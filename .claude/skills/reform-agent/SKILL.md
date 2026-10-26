---
name: reform-agent
description: How the live reform agent works (the main agent stage of assisted self-build) - Muse Spark 1.3 tool calling over the Responses API, stage toolsets, construction rules and licensed-professional flags, Spanish-first conversation, voice, costs and evals. Use when building or debugging server/agent or web/src/agent.
---

# Loop
1. User message (text, or push-to-talk → `POST /v1/asr/transcribe` → text). The users are a technical assistant and a
   family: **Spanish (es-AR) first**, English also supported. Answer in the user's language, in text only (no TTS,
   ADR-017). Keep answers to one or two short lines: the 3D shows the result.
2. `mme.client` Responses call: stable system prompt + tool schemas + compact Scene summary (ids, rooms, current
   materials, furniture) FIRST, the user turn LAST; `previous_response_id` keeps reasoning across turns.
3. The model emits tool calls → `server/agent/executor.py` runs each op on the Scene (validated) → results/errors return
   as tool outputs → loop until the model answers in text (max 6 tool rounds per user turn).
4. The API streams to the PWA: Scene patch (changed ids) + assistant text. The 3D view updates in place.

# Stages and toolsets (ADR-014, re-scoped by ADR-022): the server only exposes the current stage's tools
Reform is the main agent stage (expansion or improvement of the family's home). Design is light. The exact toolset per
stage is defined in `server/agent/stages.py`; this table is the intent.
| Stage | Tools (P0) | P1 |
|---|---|---|
| Capture | (none: deterministic corner/scale editor) | |
| Reform (main) | `add_room`, `add_wall`, `remove_wall`, `add_opening`, `move_opening`, `undo` | `resize_opening`, `split_room` |
| Design (light, skippable) | `list_catalog`, `place_furniture`, `move_item`, `rotate_item`, `remove_item`, `undo` | `generate_material`, `concept_piece` |
| Present | `create_variant`, `render_view` | |
| Deliver | (none: export buttons) | |

Style presets, `apply_style` and `apply_brand_kit` are in CUTLIST (decorating, ADR-022): do not build them.
Arguments are semantic, not raw coordinates: `add_room(function="bedroom", next_to="kitchen", size_m=[3.0, 3.5])`,
`remove_wall(between="kitchen", and_="living")`, `add_opening(wall, kind="window", at_ratio)`,
`place_furniture(catalog_id, room, anchor="against wall facing window")`.
The user's tap selection arrives as context (`selected: {kind, id}`). "This" / "esto" refers to it.
Cross-stage requests ("place a bed" while in Reform): no action; answer with a one-tap suggestion to switch stage.
`render_view` and (P1) `generate_material` cost money: only on explicit request.

# Construction rules and licensed-professional flags (ADR-023)
- Every tool validates against `server/scene/rules.py` (minimum room area and side, ventilation and light, ceiling height,
  door widths, wall thickness, maximum span before a beam or bond beam). The rules are deterministic code; never put rule
  values in the prompt or let the model decide them.
- A violation returns as a tool error (Scene unchanged) or a warning. The agent explains it in plain words and proposes the
  closest valid alternative ("ese dormitorio queda en 5,8 m², el mínimo es X: ¿lo agrandamos hacia el patio?").
- Professional-required flags come back in the tool result. The agent must say **"needs a licensed professional"**
  (es: "requiere un profesional matriculado") for: any second floor, removing a load-bearing wall, a span over the limit,
  foundations on unknown soil. It still applies the change when the op is valid, but states the flag every time and never
  implies the design is structurally safe or certified. Outputs are preliminary.

# Conversation rules (system prompt)
- Act, then say briefly what changed. Ask only when a request is ambiguous *and* the choice matters
  ("¿la ventana en el muro norte o en el este?" / "which wall: north or east?"). Offer 2 options at most.
- Never claim an imagined item is a real product; say "concept".
- Respect rules errors: explain them in plain words and propose the closest valid alternative.
- Never certify structural safety; surface every professional-required flag (see above).
- Never call `render_view` or `generate_material` without an explicit user request (they cost money).

# Costs (Spark 1.3 draft tier during dev, standard for the demo recording)
A typical turn is ~6-10k input tokens (mostly cached prefix) + ~1k output. Track it with tag `agent`. Keep the Scene summary
compact (ids + names, no full polygons).

# Evals (server/tests/agent_evals/, replay; Spanish and English)
Scripted conversations with Scene assertions, e.g.
`"agregá un dormitorio para mi hija al lado de la cocina"` → one new bedroom room adjacent to the kitchen, no rules errors,
walls and openings added through validated ops;
`"sacá el muro entre la cocina y el living"` → the wall is removed and the professional-required flag is surfaced when the
wall is load-bearing;
`"add a second floor"` → no geometry change, "needs a licensed professional" in the answer.
Record new fixtures with `MME_MODE=live` (human only), commit them, run in replay forever after.
