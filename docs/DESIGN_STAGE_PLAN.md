# Design stage plan (stage 3, optional, "light")

Branch `day/design`, cut from main 494ab75. Scope per ADR-014 (own toolset, skippable) and ADR-022 (Design is light:
usability checks, a small basic furniture set; differentiation lives in Reform and the Deliver takeoff).

## Audit (what exists at 494ab75)
| Area | State |
|---|---|
| `server/agent/stages.py` | `design` toolset lists `list_catalog, place_furniture, move_item, rotate_item, remove_item, undo`. |
| `server/agent/executor.py` | Only `list_catalog` (dumps the catalog) and `undo` work. `place_furniture/move_item/rotate_item/remove_item` hit `_MISSING_OP` and return `op.not_implemented`. No op in `ops.py`, nothing in `_OPS` replay, no undo branch. |
| `server/agent/tools.py` | Pydantic inputs exist. `PlaceFurnitureInput` has no scale; `MoveItemInput.position` would make the model write coordinates (against ADR-002). |
| `assets/catalog.json` | 12 construction materials with recipes (ADR-024), 5 furniture items (bed, table, chair, stove, wardrobe) + a door-swing clearance. No floor or wall finishes, no furniture type, all `asset_status: pending` (no GLBs; boxes are the plan). |
| Scene model | `Furniture`, `Surface`, `Material` already exist (ADR-001). `rooms.check_furniture` blocks outside-room and overlapping footprints, but its footprint ignores `rotation_deg`. `validate_scene` already warns on door clearance (0.60 m, axis-aligned). |
| `server/export/takeoff.py` | Finishes stage already reads `surfaces` (floor per room, wall side) and names lines from the catalog, so a surface choice flows through with no AI. |
| `server/render/` | Only `snapshot.py` (SVG plan, draws furniture footprints). **There is no Muse Image render path yet**; `mme.client.image_generate` exists (muse-image-1.0, $0.01 per image). |
| `web/src` Design | No screen. `App.tsx` reuses the generic viewport + `ChatSheet` with three chips (bed, fits, remove). `SceneView` and `sceneToMeshes` draw no furniture; the AR maquette (`ar/sceneToMaquette.ts`) already draws furniture as boxes (concept = violet). |
| v0 reference (`captur-ref`) | **No `design*` screen exists.** The closest is `screens/agent.tsx` (3D card, chat bubbles, chips, talk bar, "next stage" footer), already ported as `ReformScreen`. Design reuses that pattern (`docs/UI_PORT_PLAN.md` rules: re-skin, strings in i18n, 48 px targets, tests first). |
| Docs | PRODUCT/DECISIONS: Design = usability checks with a small furniture set, no consumer decorating (CUTLIST). Prices never shipped (ADR-024). |

## Plan (priority order, one commit per step)
1. **Furniture, deterministic (server).** One pure op `ops.edit_design` (furniture + surfaces replaced, validated like any op,
   replayable, undoable). `server/agent/design.py` places in code: item from catalog with real dims (optional `scale`
   within 0.8 to 1.2), chosen room, footprint must lie inside the room, must not touch wall bodies, other items or door
   swing zones; prefers a wall (back flush, rotation snapped to 90 degrees) or room centre by item kind. Tools:
   `place_furniture, move_item, rotate_item, remove_item`; `/agent/edit` accepts them for tap use. Catalog gains
   `type` + `placement`, and sofa and desk (small set).
2. **Furniture, web.** `design/catalog.ts` (type labels and colors, parity-tested against `catalog.json`), boxes plus a type
   label sprite in the 3D view, same boxes in the AR maquette GLB (node name carries the type), `DesignScreen`
   (3D card, room picker, add-item sheet, undo, chat chips mapped to tools).
3. **Surface materials.** Catalog `finishes` (kind `finish`, flat color, no price). `set_surface_material(room, part, material_id)`
   resolves the inward wall sides of the room in code. 3D shows a flat color per finish (floor color, thin wall-side overlay).
   Takeoff finishes stage shows the chosen finish. "Brighter" = lighter wall finish, or the agent suggests a window in Reform.
4. **Fit check.** `rules.py` constants + `scene/fit.py`: item inside a door swing (door width square, both sides) or
   leaving a passage under 1.00 m gets a coded warning (`furniture.blocks_door_swing`, `furniture.narrow_passage`).
5. **Optional:** "Render this room" button: explicit tap, labelled concept/preliminary, `POST /render/room` calls
   `image_generate` once ($0.01), tested with a fake client.

Every string in en and es-AR; phone first; 48 px targets; same layout contract as Reform (only the message list scrolls).

## Out of scope (CUTLIST)
Real GLB models, decorating, generated textures, prices, multi-level furniture, hinge-side door arcs.
