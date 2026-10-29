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
### 2026-10-29 — stage 2/4 build
- TDD: wrote `server/tests/test_snapshot.py` first (12 tests), then `server/render/snapshot.py` + `__init__.py`. DONE WHEN green: `python -m pytest -q server/tests/test_snapshot.py` → 11 passed.
- Implementation notes: ET-based SVG, meters as user units, `data-px-per-m="100"`, adaptive {1,2,5}×10ⁿ scale bar with `data-meters`, y-flip `Y=min+max-y`, door swing sweep derived from cross product (viewBox y grows down, so the sign convention is SVG-space).
- Full suite: 233 passed, 10 skipped; 2 pre-existing `test_voice` replay-fixture failures (missing cached ASR responses, unrelated — my change is purely additive, no existing files touched).
- Gotchas: viewBox y-min is plan `miny` (0.5 m margin), so scale bar sits at large SVG y; don't confuse plan-top with SVG-bottom. Sweep flag only valid in SVG space.
- Left: stages 3-4 (review, gate/docs).
### 2026-10-29 — stage 3/4 harden
- Added 7 edge-case tests to `server/tests/test_snapshot.py` from PLAN.md risks: L-shape Y-flip convention (pins viewBox `-0.500 -0.500 5.000 5.000` + flipped polygon points and 12.0 m²), overlapping openings merge into one gap (no sliver, both arcs still drawn), full-wall opening leaves zero wall polygons, CW polygon area matches CCW, all-degenerate walls render the empty-SVG contract, window lines span the opening width (1.2 m), door swing arc radius equals opening width and its SVG-arc center lands on the leaf hinge (spec F.6.5, sweep 1='positive-angle' in SVG space).
- No implementation changes needed: all 18 tests passed first run; no real bugs found. Combined all-degenerate-walls-empty behavior was already covered by the `math.isinf` guard (bounds `grow` skips degenerate walls since build stage).
- Snapshot suite: 18 passed. Full suite: 240 passed, 10 skipped, 2 failed — the same pre-existing `test_voice` replay-fixture failures from stage 2 (missing cached ASR responses), unrelated additive change.
- Gotchas: `_svg_arc_center` test helper derives the arc center per SVG spec F.6.5 with sweep=1 meaning positive-angle direction; keeps the sweep-sign convention tested independent of the implementation's cross-product math.
- Left: stage 4 (gate/docs).
