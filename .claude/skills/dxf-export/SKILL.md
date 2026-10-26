---
name: dxf-export
description: How Maqet writes AutoCAD-compatible DXF with ezdxf - units, layers, polylines, text, dimensions, and the validation steps. Use when touching server/export or debugging a DXF that opens wrong in AutoCAD.
---

# DXF export conventions (input: the Scene, see `scene-model`)

- Furniture: footprint rectangles (size_m w x d, rotated) on `A-FLOR-FURN`, with a text label; `concept` items get a
  `CONCEPT` suffix. Materials go out as room/surface annotations (`A-ANNO-TEXT`), not hatches, in P0.
- Export is blocked while `scene.scale_confirmed` is false.

- Library: `ezdxf`. Create with `ezdxf.new("R2018", setup=True)`; set `doc.units` explicitly (`ezdxf.units.M` or `ezdxf.units.MM`).
- Convert once at the boundary: internal meters -> export unit via a single `scale` factor. No scattered `* 1000`.
- Rooms: `msp.add_lwpolyline(points, close=True, dxfattribs={"layer": "A-AREA"})`. Walls: offset room polygons with shapely (`buffer` / `difference`) and emit closed polylines on `A-WALL`.
- Layers are created up front from one table (`LAYERS` in `server/export/layers.py`) with name, color, linetype.
- Text: height scaled to plot scale (e.g. 0.25 m for 1:100). Center on room `representative_point()`, not centroid (concave rooms).
- Dimensions: use ezdxf dimension entities fed by measured distances, then `.render()`. Never type a number by hand.
- Doors/windows: openings are cut from walls (boolean difference) and a swing arc is added on `A-DOOR`.
- Brand/guideline data affects layers' colors, text style, title block and furniture blocks - never the geometry rules.

# Verify before declaring done
1. `doc.audit()` returns no errors.
2. `ezdxf.readfile(path)` re-opens the written file; entity count per layer matches expectation.
3. Bounding box (`ezdxf.bbox.extents(msp)`) matches the site within tolerance.
4. Golden-file test: a known Scene produces the same geometry (compare shapely geometries, not file bytes).
5. Manual: open in AutoCAD / a free viewer; check `UNITS` and `DIST` between two known points.

If the installed ezdxf API differs from what you remember, read its docs (search-first) instead of guessing.
