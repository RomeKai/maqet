---
name: scene-model
description: The measured Scene document (single source of truth) - schema, ops, construction rules and professional-required flags, op history, staged takeoff and how every output derives from it. Use when touching server/scene, server/export/takeoff.py, web/src/scene, or anything that reads or writes geometry.
---

# Scene (meters, origin at the plan's bottom-left, CCW polygons, Z up for 3D)

```
Scene {
  id, version: int, units: "m", scale_confirmed: bool, ceiling_height_m: 2.6
  walls:     [{ id, a: [x,y], b: [x,y], thickness_m, kind: "exterior"|"interior", height_m? }]
  openings:  [{ id, wall_id, kind: "door"|"window", offset_m (from wall.a), width_m, height_m, sill_m? }]
  rooms:     [{ id, name, polygon: [[x,y]...], function?: "living"|"kitchen"|"bedroom"|"bath"|... }]
  surfaces:  [{ id, target: {room_id, part: "floor"|"ceiling"} | {wall_id, side: "left"|"right"}, material_id }]
  furniture: [{ id, catalog_id | concept_id, room_id, position: [x,y], rotation_deg, size_m: [w,d,h], concept: bool }]
  materials: [{ id, source: "catalog"|"generated", catalog_id?, texture_url?, prompt?, tiling_m: [u,v], concept: bool }]
}
```
- Rooms are derived from walls (shapely polygonize) after intake. Keep them in the Scene for naming and targeting.
- `concept: true` marks anything imagined (P1 generated texture or concept piece). Outputs must label it.
- Every output (UI, share link, takeoff, DXF notes) is labelled **preliminary**; Maqet never certifies structural safety (ADR-023).

# Ops (pure: Scene -> Scene, in server/scene/ops.py)
Reform (main agent stage): `add_room`, `add_wall`, `remove_wall`, `add_opening`, `move_opening` (exact set in
`server/agent/stages.py`). They re-polygonize rooms, keep surface/furniture assignments where the room survives,
and re-validate furniture and construction rules.
Design (light, basic furniture for usability checks): `place_furniture`, `move_item`, `rotate_item`, `remove_item`. `set_material` stays an internal op (surfaces and takeoff finishes), not an agent tool in P0.
P1: `resize_opening`, `split_room`. Style presets and `apply_style`/`apply_brand_kit` are in CUTLIST (ADR-022). Each op:
1. validates its input (pydantic) and the resulting Scene (`rules.py`, see below);
2. returns `(new_scene, OpResult{ok, errors[], warnings[], flags[], changed_ids[]})` and bumps `version`;
3. is recorded in the history: `{op, args, before_version, after_version, actor: "agent"|"user"}`. Undo = replay up to N-1.

# Rules (`server/scene/rules.py`, ADR-023): deterministic, never in prompts
- Geometry and usability: no overlaps between furniture footprints, clearance ≥ 0.6 m in front of doors, furniture inside
  its room, wall thickness and door width minimums (door 0.90 m, min 0.80; exterior 0.20 m, interior 0.10 m; ceiling 2.60 m).
- Construction (small, unit-tested set; each value cites its source in the code): minimum habitable room area and side,
  ventilation and natural light (window area / floor area), minimum ceiling height, masonry wall thicknesses, maximum
  unsupported span before a beam or bond beam.
- Violations return as errors (scene unchanged) or warnings. **Professional-required flags** (part of the validation output, not stored geometry): any second
  floor, removing a load-bearing wall, span over the limit, foundations on unknown soil. Flags are shown in
  the app and the share link and written into the takeoff and the DXF notes.

# Variants (ADR-013)
`Project { variants: {A: Branch, B: Branch, ...}, chosen?: label }`. `Branch { parent?, fork_at_version, ops: [...] }`.
The Scene of a branch = base Scene + the parent's ops up to the fork + its own ops (materialized and cached by version).
`create_variant(from, label)` costs nothing until it diverges. Exports and the share view always name the variant.

# Derived outputs
| Output | Where | From |
|---|---|---|
| 3D view | web/src/view3d | Scene → meshes (extruded walls minus openings, floor/ceiling polys, furniture GLBs scaled to size_m) |
| AR maquette | web/src/ar | the same three.js scene → GLTFExporter (GLB) → model-viewer (USDZ generated client-side for iOS) |
| Render | server/render | 3D snapshot of the finished room from a camera preset + materials → Muse Image |
| DXF | server/export | Scene walls/openings/rooms/furniture footprints → ezdxf (see `dxf-export`) |
| Takeoff | server/export/takeoff.py | chosen variant vs captured base + catalog recipes → staged quantities JSON + CSV (ADR-021, ADR-024) |

# Tests that must always exist
- Every op: happy path, invalid input, rule violation (scene unchanged + error), undo restores.
- Determinism: the same op sequence gives an identical Scene (ignore timestamps).
- Round trip: Scene → JSON → Scene is identical. Front and back share the generated TS types.
- Rules: each construction rule has a pass and a fail case; each professional-required flag has a test that raises it.

# Takeoff rules (ADR-021, ADR-024): deterministic, no AI, no prices
- Base quantities (ADR-021): floor/ceiling = room polygon area, grouped by material and room. Walls = length × ceiling height
  minus openings, per side and material (finish m²).
- Demolished = interior walls present in the base Scene but not in the variant; built = the reverse (metres, and m² at
  ceiling height). Openings added/removed are counted separately. Furniture list: dimensions and `concept` flags.
- Construction quantities (ADR-024): Scene geometry × per-material recipes in `assets/catalog.json` (e.g. bricks/m² by brick
  type and wall thickness, mortar, cement bags, sand and gravel m³, steel bars for bond beams, roofing sheets, openings).
  Each recipe carries a source and a waste factor; quantities are labelled estimates.
- Output is split by stage, in this order: `foundations`, `walls`, `bond_beams_roof`, `openings`, `finishes`. JSON for the
  app, CSV for download; the `professional-required` flags and the "preliminary" label are part of the payload.
- Round to 0.1 m² / 0.01 m only when displaying; keep full precision in JSON. Tests compare against hand-computed values on
  the demo inputs' `*.truth.json` (`samples/`, regenerated on Day 1, see `docs/PLAN.md`). P1: user-typed unit prices give a
  per-stage total; Maqet never ships prices.
