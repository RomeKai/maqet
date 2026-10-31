# Design stage report

Branch `day/design` (from main 494ab75). Nothing pushed or merged. All runs in MME_MODE=replay; no live Meta call was made.

| Step | Status | Commit |
|---|---|---|
| 0 Audit + plan | done | d98db0f |
| 1 Furniture server (place/move/rotate/remove, undo, replay, /agent/edit) | done | 5d31910 |
| 3 Surface materials (`set_surface_material`, catalog finishes, takeoff) | done | 4fb4996 |
| 4 Fit check (door swing, passage < 1.00 m) | done | 9377064 |
| 2 Furniture + finishes in 3D, AR maquette, Design screen | done | d6d6c57, 82c29d5 |
| 5 Render this room (server + button, fake-client tests) | done | see git log |

Gates at the last commit: pytest 539 passed; vitest 93 files / 707 passed; `tsc --noEmit` clean; `npm run build` ok.

## Render cost
One Muse Image call per tap, $0.01 (mme.client.image_generate, n=1). Never automatic. Not exercised live; tested with a fake client only.

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
