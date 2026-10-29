"""Wall footprint geometry with opening cuts (dxf-full-export).

All coordinates are meters. The wall-local frame has its origin at
``wall.a`` with +x along the wall; opening cuts are rectangles spanning the
full wall thickness, clamped to the wall segment. An opening fully outside
the wall is ignored (deterministic, never a crash).
"""

from __future__ import annotations

import math

from shapely.geometry import LineString, Polygon
from shapely.ops import unary_union

from server.scene.models import Opening, Wall


def wall_length(wall: Wall) -> float:
    """Centerline length in meters (the measured source of truth)."""
    return math.dist(tuple(wall.a), tuple(wall.b))


def wall_angle_deg(wall: Wall) -> float:
    """Centerline direction in degrees, for rotating adornments with the wall."""
    (ax, ay), (bx, by) = tuple(wall.a), tuple(wall.b)
    return math.degrees(math.atan2(by - ay, bx - ax))


def wall_footprint(wall: Wall) -> Polygon:
    """Wall centerline offset by half thickness on each side (flat caps)."""
    line = LineString([tuple(wall.a), tuple(wall.b)])
    return line.buffer(wall.thickness_m / 2.0, cap_style="flat")


def opening_interval(opening: Opening, length: float) -> tuple[float, float] | None:
    """Opening span clamped to the wall segment, or None when fully outside."""
    start = max(0.0, opening.offset_m)
    end = min(length, opening.offset_m + opening.width_m)
    return (start, end) if end > start else None


def _cut_box(wall: Wall, start: float, end: float, length: float) -> Polygon:
    """Cut rectangle for local span [start, end], twice the wall thickness so
    it always crosses the footprint: an exact-thickness box can leave a
    hairline bridge (or a boundary-touching hole) from float noise. The
    difference with the footprint clips the overshoot."""
    (ax, ay), half = tuple(wall.a), wall.thickness_m
    ux, uy = ((wall.b[0] - ax) / length, (wall.b[1] - ay) / length)
    nx, ny = (-uy, ux)
    return Polygon(
        [
            (ax + ux * start + nx * half, ay + uy * start + ny * half),
            (ax + ux * end + nx * half, ay + uy * end + ny * half),
            (ax + ux * end - nx * half, ay + uy * end - ny * half),
            (ax + ux * start - nx * half, ay + uy * start - ny * half),
        ]
    )


def wall_shapes(wall: Wall, openings: tuple[Opening, ...] = ()) -> list[Polygon]:
    """Footprint minus opening cuts: one Polygon per disjoint part."""
    shape = wall_footprint(wall)
    length = wall_length(wall)
    if length <= 0:
        return [shape]
    cuts = []
    for opening in openings:
        if opening.wall_id != wall.id:
            continue
        interval = opening_interval(opening, length)
        if interval is not None:
            cuts.append(_cut_box(wall, interval[0], interval[1], length))
    if not cuts:
        return [shape]
    result = shape.difference(unary_union(cuts))
    if result.is_empty:
        return []
    if isinstance(result, Polygon):
        return [result]
    return [g for g in result.geoms if isinstance(g, Polygon) and not g.is_empty]


def door_swing(
    wall: Wall, opening: Opening
) -> tuple[tuple[float, float], float, float, float] | None:
    """Quarter-circle swing: hinge at the offset_m end, radius = width.

    Returns (center, radius, start_deg, end_deg), rotated with the wall.
    None for windows or out-of-range openings.
    """
    if opening.kind != "door":
        return None
    length = wall_length(wall)
    if length <= 0:
        return None
    interval = opening_interval(opening, length)
    if interval is None:
        return None
    start, _ = interval
    (ax, ay) = tuple(wall.a)
    ux, uy = ((wall.b[0] - ax) / length, (wall.b[1] - ay) / length)
    angle = wall_angle_deg(wall)
    return ((ax + ux * start, ay + uy * start), opening.width_m, angle, angle + 90.0)


def window_centerline(
    wall: Wall, opening: Opening
) -> tuple[tuple[float, float], tuple[float, float]] | None:
    """Single centerline along the opening, on the wall axis. None otherwise."""
    if opening.kind != "window":
        return None
    length = wall_length(wall)
    if length <= 0:
        return None
    interval = opening_interval(opening, length)
    if interval is None:
        return None
    start, end = interval
    (ax, ay) = tuple(wall.a)
    ux, uy = ((wall.b[0] - ax) / length, (wall.b[1] - ay) / length)
    return (
        (ax + ux * start, ay + uy * start),
        (ax + ux * end, ay + uy * end),
    )
