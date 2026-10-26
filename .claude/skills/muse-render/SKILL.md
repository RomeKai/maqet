---
name: muse-render
description: How Maqet turns exact geometry into a realistic image of the finished room for the family with Muse Image, without altering the measured layout. Use when working on the render feature or its prompts.
---

# Principle: geometry first, pixels second
The Scene is the source of truth. Muse Image only *dresses* a view that our own renderer produced, so the family sees
the finished room (the proposed expansion built and finished) in real proportions. It never alters geometry.

Pipeline:
1. three.js renders the Scene with its real materials (camera presets: `<room>-from-door`, `axon-top`), plus a flat-color pass per
   room function, exported as PNG (`web/src/render/snapshot.ts`).
2. Prompt = room function + surface materials + camera preset. Materials are modest and realistic, taken from the
   construction catalog (plastered and painted brick walls, cement or ceramic floor, sheet roof), never luxury finishes.
   Build it from data, never free text:
   `"{room.function} interior of a modest home, finishes: {surface materials}, furniture: {basic items}, keep exact wall
   layout and openings from the reference image, eye-level photo, natural daylight"`.
3. Call `/v1/images/edits` with the snapshot as the reference (verify parameter names in the API reference first).
   If edits can't hold the layout, fall back to `/v1/images/generations` and label the image "mood render, not to scale".
4. Show the render next to the 2D plan with a visible "conceptual visualization" label and the "preliminary" label.
   Honesty beats a wrong promise: the image is not a construction document.

# Cost control
- $0.01 per image. Max 4 variants per click; cache by (snapshot hash + prompt) via the `mme.client` cache.
- Pre-record renders for every demo input (`MME_HOME=samples/replay`) so the demo works offline.

# Eval (Day 8)
For the 3 demo inputs x 2 camera presets: does the render keep room count, opening positions and proportions? Score 0-2 each by eye,
log in `docs/EVALS.md`. If average < 1.2, switch the UI copy to "mood board" and stop iterating.
