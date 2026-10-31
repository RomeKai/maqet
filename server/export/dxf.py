"""Scene -> DXF export (full: walls + openings + furniture + areas + dims).

Conventions (dxf-export skill): ezdxf R2018 with explicit meter units, ONE
scale factor at the boundary, walls as closed polylines via a shapely
centerline offset with opening cuts, doors get a swing arc on A-DOOR,
windows a centerline on A-GLAZ, furniture footprints with labels on
A-FLOR-FURN (CONCEPT suffix for imagined items), rooms on A-AREA with
labels centered on representative_point() plus an area text on
A-ANNO-TEXT, one measured dimension per wall on A-ANNO-DIMS, title block
on A-ANNO-TEXT carrying the preliminary label plus one line per
professional-required flag. With a base Scene, walls split into status
layers A-WALL-EXST / A-WALL-NEWW / A-WALL-DEMO; without one every wall
stays on plain A-WALL (Day-1 behavior). Rooms with level > 1 go to
"-L<level>" layers (A-AREA-L2, A-ANNO-TEXT-L2) so the ground-floor plan
stays clean; the title block stays on A-ANNO-TEXT. Export is blocked while
scale_confirmed is false.
"""

from __future__ import annotations

import json
import math
from collections.abc import Sequence
from datetime import date
from pathlib import Path

import ezdxf
from ezdxf import units
from ezdxf.document import Drawing
from ezdxf.enums import TextEntityAlignment
from ezdxf.layouts import Modelspace
from shapely.geometry import Polygon

from server.export import dxf_dims, dxf_status, dxf_walls
from server.export.layers import ensure_layers, level_layer
from server.scene.models import Furniture, Opening, Room, Scene, Wall
from server.scene.validation import ValidationReport, validate_scene

PRELIMINARY_NOTE = "Preliminary: not a structural certification"
PROFESSIONAL_PREFIX = "Requires a licensed professional: "

EXPORT_UNITS = units.M

# Single boundary conversion: internal meters -> DXF drawing units.
# Every coordinate goes through _m(); never scatter a "* 1000".
SCALE = 1.0

ROOM_LABEL_HEIGHT_M = 0.25  # legible room label at 1:100 plot scale
ROOM_AREA_HEIGHT_M = 0.18
ROOM_AREA_DY_M = 0.35  # area text sits just below the room name
FURN_LABEL_HEIGHT_M = 0.15
TITLE_TEXT_HEIGHT_M = 0.18
TITLE_LINE_STEP_M = 0.35
TITLE_BELOW_SITE_M = 1.0


class ScaleNotConfirmedError(ValueError):
    """Export blocked: the Scene scale is not confirmed yet."""


class DXFAuditError(ValueError):
    """The exported document failed the ezdxf audit."""


def _m(value: float) -> float:
    """Convert meters to drawing units through the single SCALE factor."""
    return value * SCALE


def _openings_by_wall(openings: Sequence[Opening]) -> dict[str, list[Opening]]:
    """Group openings per wall id (deterministic input order preserved)."""
    grouped: dict[str, list[Opening]] = {}
    for opening in openings:
        grouped.setdefault(opening.wall_id, []).append(opening)
    return grouped


def _room_shape(room: Room) -> Polygon:
    """Room polygon as a valid shapely shape.

    Raises ValueError when a self-intersecting polygon cannot be repaired
    to a single Polygon (buffer(0) may return a MultiPolygon, which has no
    exterior ring to export).
    """
    poly = Polygon([tuple(point) for point in room.polygon])
    if not poly.is_valid:
        repaired = poly.buffer(0)
        if not isinstance(repaired, Polygon):
            raise ValueError(
                f"room {room.id} polygon is self-intersecting "
                "and cannot be repaired to a single polygon"
            )
        poly = repaired
    return poly


def scene_bbox(
    scene: Scene, base_scene: Scene | None = None
) -> tuple[float, float, float, float]:
    """Site extents in meters: wall footprints plus room polygons.

    With a base scene, demolished-only (DEMO) walls join the union so the
    title block sits below the full exported extent.
    """
    boxes = [dxf_walls.wall_footprint(wall).bounds for wall in scene.walls]
    boxes += [_room_shape(room).bounds for room in scene.rooms]
    if base_scene is not None:
        current_ids = {wall.id for wall in scene.walls}
        boxes += [
            dxf_walls.wall_footprint(wall).bounds
            for wall in base_scene.walls
            if wall.id not in current_ids
        ]
    if not boxes:
        raise ValueError("cannot compute extents of an empty scene")
    return (
        min(b[0] for b in boxes),
        min(b[1] for b in boxes),
        max(b[2] for b in boxes),
        max(b[3] for b in boxes),
    )


def export_dxf(
    scene: Scene,
    *,
    project_name: str = "Maqet",
    report: ValidationReport | None = None,
    date_str: str | None = None,
    base_scene: Scene | None = None,
) -> Drawing:
    """Build the DXF document for a scale-confirmed Scene."""
    if not scene.scale_confirmed:
        raise ScaleNotConfirmedError(
            "export blocked: confirm the plan scale before exporting DXF"
        )
    validation = report if report is not None else validate_scene(scene)

    doc = ezdxf.new("R2018", setup=True)
    doc.units = EXPORT_UNITS
    ensure_layers(doc)
    msp = doc.modelspace()

    openings = _openings_by_wall(scene.openings)
    base_openings = _openings_by_wall(base_scene.openings) if base_scene else {}
    current_ids = {wall.id for wall in scene.walls}
    for wall, layer in dxf_status.wall_layers(scene, base_scene):
        wall_openings = (
            openings.get(wall.id, [])
            if wall.id in current_ids
            else base_openings.get(wall.id, [])
        )
        for part in dxf_walls.wall_shapes(wall, tuple(wall_openings)):
            _add_outline(msp, part, layer)
        for opening in wall_openings:
            _add_opening_adornment(msp, wall, opening)
    for room in scene.rooms:
        _add_room(msp, room)
    for item in scene.furniture:
        _add_furniture(msp, item)
    for wall in scene.walls:
        dxf_dims.add_wall_dimension(msp, wall)
    _add_title_block(
        msp,
        scene,
        project_name,
        _active_flags(validation.flags, scene.professional_flags),
        date_str or date.today().isoformat(),
        base_scene,
    )
    return doc


def save_dxf(
    scene: Scene,
    path: str | Path,
    *,
    project_name: str = "Maqet",
    report: ValidationReport | None = None,
    date_str: str | None = None,
    base_scene: Scene | None = None,
) -> Path:
    """Export, audit, and write the DXF file. Returns the written path."""
    doc = export_dxf(
        scene,
        project_name=project_name,
        report=report,
        date_str=date_str,
        base_scene=base_scene,
    )
    auditor = doc.audit()
    if auditor.errors:
        raise DXFAuditError(
            f"DXF audit failed with {len(auditor.errors)} error(s): {auditor.errors[0]}"
        )
    out = Path(path)
    doc.saveas(out)
    return out


def _add_outline(msp: Modelspace, shape: Polygon, layer: str) -> None:
    outline = list(shape.exterior.coords)[:-1]
    msp.add_lwpolyline(
        [(_m(x), _m(y)) for x, y in outline],
        close=True,
        dxfattribs={"layer": layer},
    )


def _add_opening_adornment(msp: Modelspace, wall: Wall, opening: Opening) -> None:
    swing = dxf_walls.door_swing(wall, opening)
    if swing is not None:
        center, radius, start_deg, end_deg = swing
        msp.add_arc(
            (_m(center[0]), _m(center[1])),
            _m(radius),
            start_deg,
            end_deg,
            dxfattribs={"layer": "A-DOOR"},
        )
    centerline = dxf_walls.window_centerline(wall, opening)
    if centerline is not None:
        (sx, sy), (ex, ey) = centerline
        msp.add_line(
            (_m(sx), _m(sy)),
            (_m(ex), _m(ey)),
            dxfattribs={"layer": "A-GLAZ"},
        )


def _add_room(msp: Modelspace, room: Room) -> None:
    shape = _room_shape(room)
    outline = list(shape.exterior.coords)[:-1]
    area_layer = level_layer(msp.doc, "A-AREA", room.level)
    text_layer = level_layer(msp.doc, "A-ANNO-TEXT", room.level)
    msp.add_lwpolyline(
        [(_m(x), _m(y)) for x, y in outline],
        close=True,
        dxfattribs={"layer": area_layer},
    )
    center = shape.representative_point()
    label = msp.add_text(
        room.name,
        height=_m(ROOM_LABEL_HEIGHT_M),
        dxfattribs={"layer": area_layer},
    )
    label.set_placement(
        (_m(center.x), _m(center.y)), align=TextEntityAlignment.MIDDLE_CENTER
    )
    area = msp.add_text(
        f"{shape.area:.1f} m2",
        height=_m(ROOM_AREA_HEIGHT_M),
        dxfattribs={"layer": text_layer},
    )
    area.set_placement(
        (_m(center.x), _m(center.y - ROOM_AREA_DY_M)),
        align=TextEntityAlignment.MIDDLE_CENTER,
    )


def _furniture_corners(item: Furniture) -> list[tuple[float, float]]:
    """Footprint corners: w x d rectangle rotated about its center."""
    width_m, depth_m, _ = item.size_m
    hx, hy = width_m / 2.0, depth_m / 2.0
    theta = math.radians(item.rotation_deg)
    cos_t, sin_t = math.cos(theta), math.sin(theta)
    cx, cy = item.position
    return [
        (cx + lx * cos_t - ly * sin_t, cy + lx * sin_t + ly * cos_t)
        for lx, ly in ((-hx, -hy), (hx, -hy), (hx, hy), (-hx, hy))
    ]


def _catalog_types() -> dict[str, str]:
    from server.export.takeoff import CATALOG_PATH

    data = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    return {f["id"]: f.get("type", "") for f in data["furniture"]}


def _symbol(kind: str, w: float, d: float) -> tuple[list[tuple[tuple[float, float], tuple[float, float]]], list[tuple[tuple[float, float], float]]]:
    """Plan symbol in local meters (u along width, v along depth; back at -v). (lines, circles)."""
    hw, hd = w / 2.0, d / 2.0

    def rect(u0: float, v0: float, u1: float, v1: float):
        return [((u0, v0), (u1, v0)), ((u1, v0), (u1, v1)), ((u1, v1), (u0, v1)), ((u0, v1), (u0, v0))]

    if kind == "bed":
        pillow = rect(-hw + 0.08, -hd + 0.08, hw - 0.08, -hd + 0.38)
        return [*pillow, ((-hw, -hd + 0.45), (hw, -hd + 0.45))], []
    if kind == "table":
        chairs = []
        for u in (-w / 4.0, w / 4.0):
            for sv in (-1.0, 1.0):
                v = sv * (hd + 0.25)
                chairs += rect(u - 0.2, v - 0.2, u + 0.2, v + 0.2)
        return chairs, []
    if kind == "chair":
        return [((-hw, -hd + 0.06), (hw, -hd + 0.06))], []
    if kind == "sofa":
        return [((-hw, -hd + 0.2), (hw, -hd + 0.2)), ((-hw + 0.15, -hd + 0.2), (-hw + 0.15, hd)), ((hw - 0.15, -hd + 0.2), (hw - 0.15, hd))], []
    if kind == "wardrobe":
        return [((0.0, -hd), (0.0, hd)), ((-hw, hd - 0.05), (hw, hd - 0.05))], []
    if kind == "desk":
        return [((-hw, -hd + 0.05), (hw, -hd + 0.05))], []
    if kind == "stove":
        return [], [((su * w / 4.0, sv * d / 4.0), min(w, d) * 0.12) for su in (-1.0, 1.0) for sv in (-1.0, 1.0)]
    return [], []


def _add_furniture(msp: Modelspace, item: Furniture) -> None:
    attrs = {"layer": "A-FLOR-FURN"}
    corners = _furniture_corners(item)
    msp.add_lwpolyline([(_m(x), _m(y)) for x, y in corners], close=True, dxfattribs=attrs)
    cx, cy = item.position
    theta = math.radians(item.rotation_deg)
    cos_t, sin_t = math.cos(theta), math.sin(theta)

    def world(u: float, v: float) -> tuple[float, float]:
        return (_m(cx + u * cos_t - v * sin_t), _m(cy + u * sin_t + v * cos_t))

    lines, circles = _symbol(_catalog_types().get(item.catalog_id or "", ""), item.size_m[0], item.size_m[1])
    for p, q in lines:
        msp.add_line(world(*p), world(*q), dxfattribs=attrs)
    for c, r in circles:
        msp.add_circle(world(*c), _m(r), dxfattribs=attrs)
    name = item.catalog_id or item.concept_id or item.id
    text = msp.add_text(
        f"{name} CONCEPT" if item.concept else name,
        height=_m(FURN_LABEL_HEIGHT_M),
        dxfattribs={"layer": "A-ANNO-TEXT"},
    )
    text.set_placement((_m(cx), _m(cy)), align=TextEntityAlignment.MIDDLE_CENTER)


def _active_flags(report_flags: Sequence[str], persisted: Sequence[str]) -> list[str]:
    """Report flags plus persisted Scene codes not already covered (a span
    finding reads "<code>:<wall>", so match on the code prefix)."""
    flags = list(report_flags)
    for code in persisted:
        if not any(f == code or f.startswith(f"{code}:") for f in flags):
            flags.append(code)
    return flags


def _add_title_block(
    msp: Modelspace,
    scene: Scene,
    project_name: str,
    flags: Sequence[str],
    date_str: str,
    base_scene: Scene | None = None,
) -> None:
    min_x, min_y, _, _ = scene_bbox(scene, base_scene)
    lines = [
        f"Project: {project_name}",
        f"Date: {date_str}",
        "Units: meters",
        "Scale 1:100 (1 unit = 1 m)",
        PRELIMINARY_NOTE,
        *(f"{PROFESSIONAL_PREFIX}{flag}" for flag in flags),
    ]
    x = _m(min_x)
    y = _m(min_y) - _m(TITLE_BELOW_SITE_M)
    for line in lines:
        text = msp.add_text(
            line,
            height=_m(TITLE_TEXT_HEIGHT_M),
            dxfattribs={"layer": "A-ANNO-TEXT"},
        )
        text.set_placement((x, y), align=TextEntityAlignment.LEFT)
        y -= _m(TITLE_LINE_STEP_M)
