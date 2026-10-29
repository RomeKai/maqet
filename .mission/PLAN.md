# PLAN — scene-snapshot (stage 1/4: plan)

## Approach
Pure-stdlib deterministic top-view SVG in `server/render/snapshot.py`, no model calls, no new deps.
Public API: `def render_snapshot(scene: Scene, locale: str = 'en') -> str` + `SUPPORTED_LOCALES = ('en', 'es-AR')`.

Pipeline (all deterministic, sorted-by-id order everywhere):
1. Validate locale; raise `ValueError` otherwise.
2. Compute bounds over walls (endpoints ± thickness/2), room polygons, furniture footprints; +0.5 m margin. Empty scene → `viewBox '0 0 100 100'` + Preliminary label only.
3. Fixed scale: 100 px = 1 m. `viewBox="{minx} {miny} {w} {h}"` in meters, SVG units map via a documented `data-px-per-m="100"` on root so the test converts.
4. Walls: for each wall (sorted by id), split centerline into segments at each opening `[offset_m, offset_m+width_m]` clamped to wall length; emit one filled `<polygon>` per solid segment (thickness offset, 3-decimal rounding). Openings referenced by `wall_id`; unknown `wall_id` ignored.
5. Doors: gap (no polygon) + quarter-circle swing `<path>` arc + leaf `<line>`. Windows: gap + two parallel `<line>`s across the gap.
6. Rooms (sorted by id): `<polygon>` outline (fill none/light), centroid `<text>` with name + area. Area via shoelace. en: `f'{area:.1f} m²'`; es-AR: decimal comma (`12,5 m²`). Escape names via `xml.sax.saxutils.escape`.
7. Furniture (sorted by id): rotated rect `<polygon>` footprint from center + size `[w,d]` + `rotation_deg`; concept items get `data-concept="true"` + dashed stroke.
8. Scale bar bottom-left (inside margin): adaptive nice length from {1, 2, 5} × 10^n fitting ≤ 1/4 of width, `<g data-meters="N">` with rect of width N*100 px + `<text>` label (`N m`). North-agnostic: no north arrow.
9. Corner label: en `Preliminary`, es-AR `Preliminar`, top-right `<text data-preliminary>`.
10. Serialize with `xml.etree.ElementTree`, `xml_declaration` omitted or fixed; no timestamps/ids → byte-identical.

Y-flip: plan origin bottom-left (y up) vs SVG y down — flip y (`y_svg = maxy - y`) consistently for all geometry incl. text anchors; note as risk below.

## Files to touch (inside SCOPE only)
- `server/render/__init__.py` (new, empty export)
- `server/render/snapshot.py` (new, the implementation)
- `server/tests/test_snapshot.py` (new, tests below)

No changes to `server/scene/*`, DXF, or web. Reuse `scene_bbox` idea from `server/export/dxf.py` (read-only reference, not import, to keep render dependency-free of export).

## Tests to write (`server/tests/test_snapshot.py`, offline, hand-built Scene fixtures)
1. `test_deterministic_byte_identical` — same Scene twice → identical string.
2. `test_every_room_label_present` — each room name + area string in SVG.
3. `test_scale_bar_matches_meters` — `data-meters` × 100 px == bar rect width; label text correct.
4. `test_openings_produce_gaps` — wall with door: ≥2 segment polygons with gap ≥ opening width; door arc + leaf present; window: gap + 2 parallel lines.
5. `test_valid_xml` — `ET.fromstring(svg)` parses; root tag svg.
6. `test_locale_es_ar` — `Preliminar` + decimal comma; `test_locale_invalid_raises` — ValueError.
7. `test_empty_scene` — valid SVG, viewBox `0 0 100 100`, Preliminary label.

## Risks
- Y-axis flip bugs (text upside-down/misplaced) → decide flip-once convention, cover with a 2-room L-shape fixture test.
- Opening offsets exceeding wall length → clamp, skip degenerate; test it.
- Room area sign (CW vs CCW polygons) → use abs(shoelace).
- Float formatting non-determinism → single `_fmt` 3-decimal helper everywhere.
- Scope creep (styles, classes) → keep minimal attributes the tests assert on (`data-meters`, `data-preliminary`).
