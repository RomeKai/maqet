# Design stage report

Branch `day/design` (from main 494ab75). Nothing pushed or merged. All runs in MME_MODE=replay; no live Meta call was made.

| Step | Status | Commit |
|---|---|---|
| 0 Audit + plan | done | d98db0f |
| 1 Furniture server (place/move/rotate/remove, undo, replay, /agent/edit) | done | 5d31910 |
| 3 Surface materials (`set_surface_material`, catalog finishes, takeoff) | done | 4fb4996 |
| 4 Fit check (door swing, passage < 1.00 m) | done | 9377064 |
| 2 Furniture + finishes in 3D, AR maquette, Design screen | done | d6d6c57, 82c29d5 |
| 5 Render this room (server + button, fake-client tests) | done | d1ee550 (button later replaced by In real life) |
| 6 In real life (style picker, master prompt, Design + Present) | done | see git log |

Gates at the last commit: pytest 539 passed; vitest 93 files / 707 passed; `tsc --noEmit` clean; `npm run build` ok.

## Render cost
One Muse Image call per tap, $0.01 (mme.client.image_generate, n=1). Never automatic. Not exercised live; tested with a fake client only.

## In real life
- Image input: Muse Image does have `POST /v1/images/edits` (an `image` input, $0.01 per image, from Meta's Muse Image blog). `mme.client` has no method for it, and the human chose text-only, so it is not used and mme was not touched.
- Text-only path: `server/render/real_life.py` builds one deterministic master prompt in code (stable prefix first): the rest of the house with sizes, the chosen room with size and ceiling, each opening with wall orientation, size and distance from the wall end, each furniture item with type, size, position and facing, floor and wall finishes, a fixed eye-level camera from the door toward the window wall, then the chosen style (minimalist, modern, cozy, rustic, industrial).
- Limitation: layout is approximate. The model gets numbers in words, not geometry.
- Cost: one image per tap, n=1, $0.01. Never automatic; the button is disabled while pending and the cost note is shown.
- No concept label on the image (human decision); the global preliminary footer stays.
- Surfaces: Design sheet and Present ("See it in real life"), same image state. There is no family share page in this repo (only the copy-link button), so nothing there uses the image yet.
- Replaced the earlier concept render button in the Design sheet; `POST /render/room` stays on the server.

## Known gaps
- No `design*` screen exists in captur-ref; DesignScreen follows ReformScreen (v0 `agent.tsx`) patterns.
- Furniture are plain boxes with a type label sprite in the 3D view. In the AR GLB the type is in the node name only (no text in the GLB).
- Door swing is a square of door width on both sides (no hinge side). The passage check is a morphological test (1.00 m disk), so a dead-end gap can also warn.
- Wall finishes are thin slabs on the inward wall side; shared walls get each room's own side.
- Chip "Move the bed to wall 2" assumes a bed was placed; otherwise the agent answers with an error.
- Catalog `es_AR` strings were not touched; the existing file has mojibake in some names (pre-existing).
- Not run: an end-to-end replay of the agent in Design (no recorded model turns), so chat-by-model placement is covered only by the tool/executor tests.

## Phone checklist (only a phone can confirm)
1. Open Design (stage 3) after a captured room: the 3D card fits, only the message list scrolls, "Preliminary" visible.
2. Add > Furniture > Bed: a labelled blue box appears against a wall, not inside it or in the door swing.
3. Placed tab: arrows nudge 10 cm, rotate turns 90 degrees, a blocked move shows a message; push a piece into the door area and see the warning.
4. Finishes: pick a floor and a wall finish: flat colors in 3D; Deliver > finishes lists the chosen names.
5. Chat chips: bed, brighter, move, rotate, remove send sensible requests (needs live model).
6. AR table view shows the boxes and colors.
7. Render button: one tap, one image labelled concept (costs $0.01; do it once).
8. Spanish: switch to es-AR and read every new string; tap targets feel 48 px.

## Round 2 (branch day/design2, from main 875bda8)
- Item sheet (tap a piece in 3D, or the Placed tab): 10 cm nudges, move to wall N, rotate 90, remove; all via /agent/edit (undoable, fit-checked, warnings shown). The selected piece glows.
- Furniture: low-poly primitives per type (`web/src/design/furnitureShapes.ts`), one builder for r3f and the AR GLB; footprint and height stay the catalog values.
- DXF: type symbols (pillow line, chair squares, sofa arms, door line, burner circles) on A-FLOR-FURN at the real pose; labels on A-ANNO-TEXT.
- In real life: inline strip on the Design screen (image opens in a sheet) and above the AR card in Present.
- Wall badges scale with the scene (capped) and stack when they would overlap.
- Agent errors: one plain sentence; raw tool errors under a "Details" disclosure. Prompt rule updated.
- Phone checks added: tap a piece to select; the badge size on a tiny room; furniture shapes read as bed/sofa/table; AR shows the same shapes; Details disclosure on a failed request; open the DXF in AutoCAD and check layers.
