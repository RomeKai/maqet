"""Scene -> DXF export (Day 1 scope: walls + rooms + title block).

Conventions (dxf-export skill): ezdxf R2018 with explicit meter units, ONE
scale factor at the boundary, walls as closed polylines on A-WALL via a
shapely centerline offset, rooms on A-AREA with labels centered on
representative_point(), title block on A-ANNO-TEXT carrying the preliminary
label plus one line per professional-required flag. Export is blocked while
scale_confirmed is false. Full openings (wall cuts + door swing arcs) land
on Day 5.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import date
from pathlib import Path

import ezdxf
from ezdxf import units
from ezdxf.document import Drawing
from ezdxf.enums import TextEntityAlignment
from ezdxf.layouts import Modelspace
from shapely.geometry import LineString, Polygon

from server.export.layers import ensure_layers
from server.scene.models import Room, Scene, Wall
from server.scene.validation import ValidationReport, validate_scene

PRELIMINARY_NOTE = "Preliminary: not a structural certification"
PROFESSIONAL_PREFIX = "Requires a licensed professional: "

EXPORT_UNITS = units.M

# Single boundary conversion: internal meters -> DXF drawing units.
# Every coordinate goes through _m(); never scatter a "* 1000".
SCALE = 1.0

ROOM_LABEL_HEIGHT_M = 0.25  # legible room label at 1:100 plot scale
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


def _wall_footprint(wall: Wall) -> Polygon:
    """Wall centerline offset by half thickness on each side (flat caps)."""
    line = LineString([tuple(wall.a), tuple(wall.b)])
    return line.buffer(wall.thickness_m / 2.0, cap_style="flat")


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


def scene_bbox(scene: Scene) -> tuple[float, float, float, float]:
    """Site extents in meters: wall footprints plus room polygons."""
    boxes = [_wall_footprint(wall).bounds for wall in scene.walls]
    boxes += [_room_shape(room).bounds for room in scene.rooms]
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

    for wall in scene.walls:
        _add_wall(msp, wall)
    for room in scene.rooms:
        _add_room(msp, room)
    _add_title_block(
        msp,
        scene,
        project_name,
        validation.flags,
        date_str or date.today().isoformat(),
    )
    return doc


def save_dxf(
    scene: Scene,
    path: str | Path,
    *,
    project_name: str = "Maqet",
    report: ValidationReport | None = None,
    date_str: str | None = None,
) -> Path:
    """Export, audit, and write the DXF file. Returns the written path."""
    doc = export_dxf(scene, project_name=project_name, report=report, date_str=date_str)
    auditor = doc.audit()
    if auditor.errors:
        raise DXFAuditError(
            f"DXF audit failed with {len(auditor.errors)} error(s): {auditor.errors[0]}"
        )
    out = Path(path)
    doc.saveas(out)
    return out


def _add_wall(msp: Modelspace, wall: Wall) -> None:
    outline = list(_wall_footprint(wall).exterior.coords)[:-1]
    msp.add_lwpolyline(
        [(_m(x), _m(y)) for x, y in outline],
        close=True,
        dxfattribs={"layer": "A-WALL"},
    )


def _add_room(msp: Modelspace, room: Room) -> None:
    shape = _room_shape(room)
    outline = list(shape.exterior.coords)[:-1]
    msp.add_lwpolyline(
        [(_m(x), _m(y)) for x, y in outline],
        close=True,
        dxfattribs={"layer": "A-AREA"},
    )
    center = shape.representative_point()
    label = msp.add_text(
        room.name,
        height=_m(ROOM_LABEL_HEIGHT_M),
        dxfattribs={"layer": "A-AREA"},
    )
    label.set_placement(
        (_m(center.x), _m(center.y)), align=TextEntityAlignment.MIDDLE_CENTER
    )


def _add_title_block(
    msp: Modelspace,
    scene: Scene,
    project_name: str,
    flags: Sequence[str],
    date_str: str,
) -> None:
    min_x, min_y, _, _ = scene_bbox(scene)
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
