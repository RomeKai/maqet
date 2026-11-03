"""Place a new room ON an existing wall of the anchor room (bug I / J).

Intake walls are slightly skewed sketch centerlines, so an axis-aligned box on
the anchor's bounding box never lines up with them (parallel duplicate wall,
no door). The room is built in the wall's own frame instead: its shared edge
is a stretch of the chosen wall, exactly collinear, and room_walls.py then
reuses that wall and cuts the door. Deterministic; the model only names a wall
(label or id) or nothing.
"""

from __future__ import annotations

import math

from shapely.geometry import Point as ShPoint
from shapely.geometry import Polygon

from server.agent.wall_labels import resolve_in_walls, wall_label
from server.scene.models import Room, Scene, Wall
from server.scene.validation import rooms_overlap_m2

_NEAR_M = 0.30  # a wall bounds the anchor when its ends/midpoint sit this close
_OVERLAP_M2 = 1e-3

PlanPoint = tuple[float, float]


class PlacementError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def _bounds_anchor(wall: Wall, ring) -> bool:
    mid = ((wall.a[0] + wall.b[0]) / 2.0, (wall.a[1] + wall.b[1]) / 2.0)
    return all(ring.distance(ShPoint(p)) < _NEAR_M for p in (wall.a, wall.b, mid))


def _frame(anchor: Room, wall: Wall) -> tuple[float, PlanPoint, PlanPoint]:
    """(length, direction, outward normal away from the anchor)."""
    length = math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1])
    d = ((wall.b[0] - wall.a[0]) / length, (wall.b[1] - wall.a[1]) / length)
    n = (-d[1], d[0])
    poly = Polygon(anchor.polygon)
    cx, cy = poly.centroid.x, poly.centroid.y
    mid = ((wall.a[0] + wall.b[0]) / 2.0, (wall.a[1] + wall.b[1]) / 2.0)
    if (mid[0] - cx) * n[0] + (mid[1] - cy) * n[1] < 0:  # outward, away from the anchor
        n = (-n[0], -n[1])
    return length, d, n


def _side_rank(anchor: Room, wall: Wall) -> float:
    """East, south, west, north order (clockwise from east) for stable ties."""
    _, _, n = _frame(anchor, wall)
    return (-math.atan2(n[1], n[0])) % (2 * math.pi)


def _rect_on_wall(
    anchor: Room, wall: Wall, size_m: tuple[float, float]
) -> list[PlanPoint]:
    length, d, n = _frame(anchor, wall)
    width, depth = float(size_m[0]), float(size_m[1])
    t0 = max((length - width) / 2.0, 0.0)
    p0 = (wall.a[0] + d[0] * t0, wall.a[1] + d[1] * t0)
    p1 = (p0[0] + d[0] * width, p0[1] + d[1] * width)
    p2 = (p1[0] + n[0] * depth, p1[1] + n[1] * depth)
    p3 = (p0[0] + n[0] * depth, p0[1] + n[1] * depth)
    ring = [p0, p1, p2, p3]
    return ring if Polygon(ring).exterior.is_ccw else ring[::-1]


def _is_free(scene: Scene, ring: list[PlanPoint], level: int) -> bool:
    probe = Room(id="_probe", name="_probe", polygon=ring, level=level)
    return all(rooms_overlap_m2(probe, r) <= _OVERLAP_M2 for r in scene.rooms)


def place_on_wall(
    scene: Scene,
    anchor: Room,
    size_m: tuple[float, float],
    level: int,
    wall_ref: str | None,
) -> tuple[list[PlanPoint], str, list[str]] | None:
    """(polygon, wall_id, warnings) or None when the anchor has no usable wall.

    Raises PlacementError when the user named a wall that cannot take the room.
    """
    ring = Polygon(anchor.polygon).exterior
    if wall_ref is not None:
        wid = resolve_in_walls(scene.walls, wall_ref)
        if wid is None:
            raise PlacementError("anchor.unknown", f"no wall matches {wall_ref!r}; Scene unchanged")
        candidates = [w for w in scene.walls if w.id == wid]
    else:
        candidates = [w for w in scene.walls if _bounds_anchor(w, ring)]
        # Walls without openings first (stable otherwise): a window or door is
        # not hidden, and the connecting door has room.
        candidates.sort(
            key=lambda w: (
                sum(1 for o in scene.openings if o.wall_id == w.id),
                round(_side_rank(anchor, w), 3),
            )
        )
    for wall in candidates:
        if math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]) < 1e-6:
            continue
        rect = _rect_on_wall(anchor, wall, size_m)
        if not _is_free(scene, rect, level):
            continue
        warnings = [f"placement: attached to {wall_label(scene, wall.id)}"]
        kinds = sorted({o.kind for o in scene.openings if o.wall_id == wall.id})
        if kinds:
            warnings.append(
                f"placement: that wall has a {' and a '.join(kinds)}; "
                "it stays as an opening between the rooms and the door goes in a free span"
            )
        return rect, wall.id, warnings
    if wall_ref is not None:
        raise PlacementError(
            "anchor.no_free_side",
            f"{wall_label(scene, candidates[0].id)} has no free space outside; "
            "say another wall; Scene unchanged",
        )
    return None


# --- Upper storeys sit ON the home (never beside it) --------------------------------


def _bbox(poly) -> tuple[float, float, float, float]:
    xs = [float(p[0]) for p in poly]
    ys = [float(p[1]) for p in poly]
    return min(xs), min(ys), max(xs), max(ys)


def _bbox_area(room: Room) -> float:
    x0, y0, x1, y1 = _bbox(room.polygon)
    return (x1 - x0) * (y1 - y0)


def largest_ground_room(scene: Scene) -> Room | None:
    """Biggest level-1 room by bounding box; the default anchor of a storey."""
    ground = [r for r in scene.rooms if r.level == 1]
    return max(ground, key=_bbox_area) if ground else None


def _fit_note(anchor: Room, w: float, h: float) -> list[str]:
    x0, y0, x1, y1 = _bbox(anchor.polygon)
    if w <= x1 - x0 + 1e-9 and h <= y1 - y0 + 1e-9:
        return []
    return [
        f"the {w:g} x {h:g} m upper room is larger than the footprint of {anchor.name!r} "
        f"({x1 - x0:.2f} x {y1 - y0:.2f} m): kept at the requested size, centered on it, "
        "so it overhangs the ground floor; a professional must check the structure"
    ]


def place_over_anchor(
    anchor: Room, size_m: tuple[float, float] | list[float]
) -> tuple[list[PlanPoint], list[str]]:
    """w x h rectangle centered on the anchor's footprint. The size is never
    changed; when it does not fit inside, the note says it overhangs."""
    w, h = float(size_m[0]), float(size_m[1])
    x0, y0, x1, y1 = _bbox(anchor.polygon)
    cx, cy = (x0 + x1) / 2.0, (y0 + y1) / 2.0
    left, bottom = cx - w / 2.0, cy - h / 2.0
    poly = [(left, bottom), (left + w, bottom), (left + w, bottom + h), (left, bottom + h)]
    return poly, _fit_note(anchor, w, h)


def move_over_ground(
    scene: Scene, poly: list[PlanPoint], level: int, anchor: Room | None
) -> tuple[list[PlanPoint], list[str]]:
    """An explicit upper-level polygon that overlaps no ground room floats in
    mid-air: translate it (shape and size untouched) to center on the anchor and
    say so. A polygon already over the home is returned as is."""
    probe = Room(id="_probe", name="_probe", polygon=poly, level=1)
    if any(rooms_overlap_m2(probe, r) > 0.0 for r in scene.rooms if r.level == 1):
        return poly, []
    anchor = anchor or largest_ground_room(scene)
    if anchor is None:
        return poly, []
    px0, py0, px1, py1 = _bbox(poly)
    ax0, ay0, ax1, ay1 = _bbox(anchor.polygon)
    dx = (ax0 + ax1) / 2.0 - (px0 + px1) / 2.0
    dy = (ay0 + ay1) / 2.0 - (py0 + py1) / 2.0
    moved = [(float(x) + dx, float(y) + dy) for x, y in poly]
    notes = [
        f"the level-{level} room did not sit over any ground room, so it was moved "
        f"onto {anchor.name!r} (shape and size unchanged); a storey must stand on the home"
    ]
    return moved, notes + _fit_note(anchor, px1 - px0, py1 - py0)
