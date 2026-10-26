---
name: scene-model
description: The measured Scene document (single source of truth) - schema, ops, validation, op history and how every output derives from it. Use when touching server/scene, web/src/scene, or anything that reads or writes geometry.
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
  brand_profile_id?
}
```
- Rooms are derived from walls (shapely polygonize) after intake. Keep them in the Scene for naming and targeting.
- `concept: true` marks anything imagined (generated texture or concept piece). Outputs must label it.

# Ops (pure: Scene -> Scene, in server/scene/ops.py)
Design: `set_material`, `place_furniture`, `move_item`, `rotate_item`, `remove_item`, `apply_style` (bundle of the ops above).
Reform (P0-lite): `remove_wall` (interior only), `add_wall` (straight partition between two existing walls); both
re-polygonize rooms, keep surface/furniture assignments where the room survives, and re-validate furniture.
P1: `move_opening`, `resize_opening`, `split_room`, `apply_brand_kit`. Each op:
1. validates its input (pydantic) and the resulting Scene (`rules.py`: no overlaps between furniture footprints,
   clearance ≥ 0.6 m in front of doors, furniture inside its room, wall thickness/door width minimums);
2. returns `(new_scene, OpResult{ok, errors[], changed_ids[]})` and bumps `version`;
3. is recorded in the history: `{op, args, before_version, after_version, actor: "agent"|"user"}`. Undo = replay up to N-1.

# Variants (ADR-013)
`Project { variants: {A: Branch, B: Branch, ...}, chosen?: label }`. `Branch { parent?, fork_at_version, ops: [...] }`.
The Scene of a branch = base Scene + the parent's ops up to the fork + its own ops (materialized and cached by version).
`create_variant(from, label)` costs nothing until it diverges. Exports and the share view always name the variant.

# Derived outputs
| Output | Where | From |
|---|---|---|
| 3D view | web/src/view3d | Scene → meshes (extruded walls minus openings, floor/ceiling polys, furniture GLBs scaled to size_m) |
| AR maquette | web/src/ar | the same three.js scene → GLTFExporter (GLB) → model-viewer (USDZ generated client-side for iOS) |
| Render | server/render | 3D snapshot from a camera preset + materials → Muse Image |
| DXF | server/export | Scene walls/openings/rooms/furniture footprints → ezdxf (see `dxf-export`) |
| Takeoff | server/export/takeoff.py | chosen variant vs captured base → quantities JSON + CSV (ADR-021) |

# Tests that must always exist
- Every op: happy path, invalid input, rule violation (scene unchanged + error), undo restores.
- Determinism: the same op sequence gives an identical Scene (ignore timestamps).
- Round trip: Scene → JSON → Scene is identical. Front and back share the generated TS types.

# Takeoff rules (ADR-021)
- Floor/ceiling: room polygon area, grouped by material and room. Walls: length × ceiling height minus openings, per side and
  material (paint/finish m²).
- Demolished = interior walls present in the base Scene but not in the variant; built = the reverse (metres, and m² of
  partition at ceiling height). Openings added/removed are counted separately.
- Round to 0.1 m² / 0.01 m only when displaying; keep full precision in JSON. Tests compare against hand-computed values on
  `samples/plans/*.truth.json`.
