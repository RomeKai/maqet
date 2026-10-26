---
name: muse-render
description: How Maqet turns exact geometry into a client-facing realistic image with Muse Image without breaking the measured layout. Use when working on the render feature or its prompts.
---

# Principle: geometry first, pixels second
The DXF/3D model is the source of truth. Muse Image only *dresses* a view that our own renderer produced,
so the client sees the real proportions.

Pipeline:
1. three.js renders the Scene with its real materials (camera presets: `<room>-from-door`, `axon-top`), plus a flat-color pass per
   room function, exported as PNG (`web/src/render/snapshot.ts`).
2. Prompt = BrandProfile (palette, materials, mood) + room function + camera preset. Build it from data, never free text:
   `"{room.function} interior, finishes: {surface materials}, furniture: {items}, {brand.mood?}, keep exact wall layout and
   openings from the reference image, eye-level photo, natural daylight"`.
3. Call `/v1/images/edits` with the snapshot as the reference (verify parameter names in the API reference first).
   If edits can't hold the layout, fall back to `/v1/images/generations` and label the image "mood render, not to scale".
4. Show render next to the 2D plan with a visible "conceptual visualization" label. Honesty beats a wrong promise.

# Cost control
- $0.01 per image. Max 4 variants per click; cache by (snapshot hash + prompt) via the `mme.client` cache.
- Pre-record renders for every sample brief (`MME_HOME=samples/replay`) so the demo works offline.

# Eval (Day 8)
For 3 samples x 2 presets: does the render keep room count, opening positions and proportions? Score 0-2 each by eye,
log in `docs/EVALS.md`. If average < 1.2, switch the UI copy to "mood board" and stop iterating.
