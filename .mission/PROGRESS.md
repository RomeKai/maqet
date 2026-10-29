# Mission scene-snapshot

## Goal
Implement server/render/snapshot.py: a deterministic top-view SVG of a Scene (no model calls, no new dependencies):
walls as filled polygons with openings cut, door swings, room names and areas (es-AR or en), furniture footprints,
a scale bar in meters, north-agnostic, and a "Preliminary" corner label; fixed viewBox from the Scene bounds with a
margin. Same Scene -> byte-identical SVG. Tests: determinism, every room label present, scale bar length matches
meters, openings produce gaps, valid XML.

## Log

### 2026-10-29 — stage 1/4 plan
- Wrote `.mission/PLAN.md`: stdlib-only `render_snapshot(scene, locale) -> str` design, wall-split openings, fixed 100px=1m scale bar with `data-meters`, y-flip convention, 7 test cases.
- Left: stages 2-4 (implement `server/render/snapshot.py`, write `server/tests/test_snapshot.py`, run gate).
- Gotchas: y-flip must apply to all geometry + text; clamp out-of-range opening offsets; single 3-decimal float formatter for byte-determinism.
