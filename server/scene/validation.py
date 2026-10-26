"""Scene validation: keeps rules.py small (ADR-023).

validate_scene returns a report with errors (scene must not change),
warnings, and professional-required flags. Flags never block geometry —
they travel in the report so every output shows "needs a licensed
professional" where it applies.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from server.scene.models import HABITABLE_FUNCTIONS, Scene
from server.scene.rules import (
    DOOR_CLEARANCE_M,
    EXTERIOR_WALL_THICKNESS_M,
    INTERIOR_WALL_THICKNESS_M,
    MAX_UNSUPPORTED_SPAN_M,
    MIN_CEILING_HEIGHT_M,
    MIN_CORRIDOR_WIDTH_M,
    MIN_DOOR_WIDTH_M,
    MIN_HABITABLE_ROOM_AREA_M2,
    MIN_HABITABLE_ROOM_SIDE_M,
    MIN_WINDOW_TO_FLOOR_RATIO,
    PRO_FLAG_LOAD_BEARING,
    PRO_FLAG_SECOND_FLOOR,
    PRO_FLAG_SOIL,
    PRO_FLAG_SPAN,
)

FLAG_SECOND_FLOOR = PRO_FLAG_SECOND_FLOOR
FLAG_LOAD_BEARING = PRO_FLAG_LOAD_BEARING
FLAG_SPAN = PRO_FLAG_SPAN
FLAG_SOIL = PRO_FLAG_SOIL


@dataclass(frozen=True)
class ValidationContext:
    """Extra facts no geometry alone can prove.

    needs_second_floor: the reform adds a floor above ground level.
    removed_load_bearing_wall: a wall flagged load_bearing=True was removed.
    soil_unknown: foundations would sit on untested soil.
    """

    needs_second_floor: bool = False
    removed_load_bearing_wall: bool = False
    soil_unknown: bool = False


@dataclass(frozen=True)
class ValidationReport:
    errors: tuple[str, ...] = ()
    warnings: tuple[str, ...] = ()
    flags: tuple[str, ...] = ()

    @property
    def ok(self) -> bool:
        return not self.errors


def _polygon_area(poly: list[tuple[float, float]]) -> float:
    area = 0.0
    n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        area += x1 * y2 - x2 * y1
    return abs(area) / 2.0


def _bbox_side(poly: list[tuple[float, float]]) -> float:
    xs = [p[0] for p in poly]
    ys = [p[1] for p in poly]
    return min(max(xs) - min(xs), max(ys) - min(ys))


def _wall_length_m(wall_a: tuple[float, float], wall_b: tuple[float, float]) -> float:
    return math.hypot(wall_b[0] - wall_a[0], wall_b[1] - wall_a[1])


def validate_scene(scene: Scene, ctx: ValidationContext | None = None) -> ValidationReport:
    """Validate a Scene. Pure: reads only, never mutates."""
    context = ctx or ValidationContext()
    errors: list[str] = []
    warnings: list[str] = []
    flags: list[str] = []

    if scene.units != "m":
        errors.append("scene units must be meters")

    if scene.ceiling_height_m < MIN_CEILING_HEIGHT_M:
        errors.append(
            f"ceiling height {scene.ceiling_height_m:.2f} m below minimum "
            f"{MIN_CEILING_HEIGHT_M:.2f} m"
        )

    for room in scene.rooms:
        area = _polygon_area(list(room.polygon))
        if room.function in HABITABLE_FUNCTIONS:
            if area < MIN_HABITABLE_ROOM_AREA_M2:
                errors.append(
                    f"room {room.id} area {area:.2f} m2 below minimum "
                    f"{MIN_HABITABLE_ROOM_AREA_M2:.2f} m2"
                )
            side = _bbox_side(list(room.polygon))
            if side < MIN_HABITABLE_ROOM_SIDE_M:
                errors.append(
                    f"room {room.id} min side {side:.2f} m below minimum "
                    f"{MIN_HABITABLE_ROOM_SIDE_M:.2f} m"
                )
            room_windows = [
                o
                for o in scene.openings
                if o.kind == "window"
                and any(w.id == o.wall_id for w in scene.walls)
                and o.wall_id in _walls_of_room(scene, room.id)
            ]
            window_area = sum(o.width_m * o.height_m for o in room_windows)
            if area > 0 and window_area / area < MIN_WINDOW_TO_FLOOR_RATIO:
                warnings.append(
                    f"room {room.id} window/floor ratio "
                    f"{window_area / area:.2f} below {MIN_WINDOW_TO_FLOOR_RATIO:.2f}"
                )

    for wall in scene.walls:
        min_thickness = (
            EXTERIOR_WALL_THICKNESS_M
            if wall.kind == "exterior"
            else INTERIOR_WALL_THICKNESS_M
        )
        if wall.thickness_m < min_thickness - 1e-9:
            errors.append(
                f"wall {wall.id} thickness {wall.thickness_m:.2f} m below "
                f"minimum {min_thickness:.2f} m for {wall.kind}"
            )
        if _wall_length_m(wall.a, wall.b) > MAX_UNSUPPORTED_SPAN_M:
            flags.append(f"{FLAG_SPAN}:{wall.id}")

    for opening in scene.openings:
        wall = next((w for w in scene.walls if w.id == opening.wall_id), None)
        if wall is None:
            errors.append(f"opening {opening.id} references unknown wall {opening.wall_id}")
            continue
        length = _wall_length_m(wall.a, wall.b)
        if opening.offset_m + opening.width_m > length + 1e-9:
            errors.append(
                f"opening {opening.id} overflows wall {opening.wall_id} "
                f"(offset {opening.offset_m:.2f} + width {opening.width_m:.2f} > "
                f"length {length:.2f})"
            )
        if opening.kind == "door":
            if opening.width_m < MIN_DOOR_WIDTH_M - 1e-9:
                errors.append(
                    f"door {opening.id} width {opening.width_m:.2f} m below minimum "
                    f"{MIN_DOOR_WIDTH_M:.2f} m"
                )
            room = next(
                (r for r in scene.rooms if _point_in_room(opening, wall, r)), None
            )
            if room is not None and not _door_clearance_ok(scene, room, opening, wall):
                warnings.append(
                    f"door {opening.id} clearance below {DOOR_CLEARANCE_M:.1f} m"
                )

    # Corridor heuristic: any narrow non-habitable room narrower than 1 m.
    for room in scene.rooms:
        if room.function not in HABITABLE_FUNCTIONS:
            side = _bbox_side(list(room.polygon))
            if 0 < side < MIN_CORRIDOR_WIDTH_M:
                warnings.append(
                    f"room {room.id} narrow side {side:.2f} m below corridor "
                    f"{MIN_CORRIDOR_WIDTH_M:.2f} m"
                )

    if context.removed_load_bearing_wall:
        flags.append(FLAG_LOAD_BEARING)
    if context.needs_second_floor:
        flags.append(FLAG_SECOND_FLOOR)
    if context.soil_unknown:
        flags.append(FLAG_SOIL)

    return ValidationReport(errors=tuple(errors), warnings=tuple(warnings), flags=tuple(flags))


def _walls_of_room(scene: Scene, room_id: str) -> set[str]:
    # Conservative: every wall counts for every room (rooms are derived from
    # walls; exact adjacency needs shapely polygonize in later phases).
    return {w.id for w in scene.walls} if any(r.id == room_id for r in scene.rooms) else set()


def _point_in_room(opening, wall, room) -> bool:
    # Opening center projected onto the wall segment, tested against the room
    # polygon with a ray-cast. Good enough for validation; DXF/tests use ezdxf.
    ax, ay = wall.a
    bx, by = wall.b
    length = _wall_length_m(wall.a, wall.b)
    if length <= 0:
        return False
    t = (opening.offset_m + opening.width_m / 2.0) / length
    px = ax + (bx - ax) * t
    py = ay + (by - ay) * t
    return _point_in_polygon(px, py, list(room.polygon))


def _point_in_polygon(px: float, py: float, poly: list[tuple[float, float]]) -> bool:
    inside = False
    n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        if (y1 > py) != (y2 > py) and px < (x2 - x1) * (py - y1) / (y2 - y1 + 1e-12) + x1:
            inside = not inside
    return inside


@dataclass(frozen=True)
class _FurnitureBox:
    min_x: float
    min_y: float
    max_x: float
    max_y: float


def _furniture_box(f) -> _FurnitureBox:
    w, d, _h = f.size_m
    cx, cy = f.position
    return _FurnitureBox(cx - w / 2, cy - d / 2, cx + w / 2, cy + d / 2)


def _door_clearance_ok(scene: Scene, room, opening, wall) -> bool:
    # Clear rectangle in front of the door (inside the room) of depth
    # DOOR_CLEARANCE_M must not intersect any furniture footprint.
    ax, ay = wall.a
    bx, by = wall.b
    length = _wall_length_m(wall.a, wall.b)
    if length <= 0:
        return True
    dx, dy = (bx - ax) / length, (by - ay) / length
    nx, ny = -dy, dx  # wall normal; check both sides, worst case passes
    t = (opening.offset_m + opening.width_m / 2.0) / length
    cx, cy = ax + (bx - ax) * t, ay + (by - ay) * t
    hw = opening.width_m / 2.0
    for sign in (1.0, -1.0):
        corner_x = [cx - dx * hw, cx + dx * hw]
        corner_y = [cy - dy * hw, cy + dy * hw]
        xs = corner_x + [x + nx * sign * DOOR_CLEARANCE_M for x in corner_x]
        ys = corner_y + [y + ny * sign * DOOR_CLEARANCE_M for y in corner_y]
        box = _FurnitureBox(min(xs), min(ys), max(xs), max(ys))
        for f in scene.furniture:
            if f.room_id != room.id:
                continue
            fb = _furniture_box(f)
            if not (
                fb.max_x <= box.min_x
                or fb.min_x >= box.max_x
                or fb.max_y <= box.min_y
                or fb.min_y >= box.max_y
            ):
                return False
    return True
