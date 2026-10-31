"""Furniture fit check (ADR-023 style): coded warnings, never blocking.

An item inside a door swing, or leaving a passage narrower than
MIN_CORRIDOR_WIDTH_M, is flagged. Values live in rules.py.
"""

from __future__ import annotations

import math

from shapely.geometry import LineString, Polygon
from shapely.ops import unary_union

from server.scene.models import Scene
from server.scene.rules import (
    CODE_FURNITURE_DOOR_SWING,
    CODE_FURNITURE_NARROW_PASSAGE,
    MIN_CORRIDOR_WIDTH_M,
)
from server.scene.validation import Finding

_MIN_POCKET_M2 = 0.25
_MIN_POCKET_LONG_SIDE_M = 0.8
_EPS = 1e-6


def door_swing_zones(scene: Scene) -> list[Polygon]:
    """Square of side = door width on both sides of every door (conservative leaf swing)."""
    walls = {w.id: w for w in scene.walls}
    zones: list[Polygon] = []
    for o in scene.openings:
        wall = walls.get(o.wall_id)
        if o.kind != "door" or wall is None:
            continue
        length = math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1])
        if length <= 0:
            continue
        dx, dy = (wall.b[0] - wall.a[0]) / length, (wall.b[1] - wall.a[1]) / length
        p0 = (wall.a[0] + dx * o.offset_m, wall.a[1] + dy * o.offset_m)
        p1 = (p0[0] + dx * o.width_m, p0[1] + dy * o.width_m)
        nx, ny = -dy * o.width_m, dx * o.width_m
        zones.append(Polygon([(p0[0] - nx, p0[1] - ny), (p1[0] - nx, p1[1] - ny), (p1[0] + nx, p1[1] + ny), (p0[0] + nx, p0[1] + ny)]))
    return zones


def _footprint(f) -> Polygon:
    w, d, _ = f.size_m
    t = math.radians(f.rotation_deg)
    c, s = math.cos(t), math.sin(t)
    return Polygon(
        [
            (f.position[0] + x * c - y * s, f.position[1] + x * s + y * c)
            for x, y in ((-w / 2, -d / 2), (w / 2, -d / 2), (w / 2, d / 2), (-w / 2, d / 2))
        ]
    )


def furniture_fit_warnings(scene: Scene) -> list[Finding]:
    out: list[Finding] = []
    zones = door_swing_zones(scene)
    walls = [LineString([w.a, w.b]).buffer(w.thickness_m / 2.0, cap_style=2) for w in scene.walls]
    for f in scene.furniture:
        fp = _footprint(f)
        if any(fp.intersection(z).area > _EPS for z in zones):
            out.append(
                Finding(
                    f"furniture {f.id} blocks a door swing",
                    CODE_FURNITURE_DOOR_SWING,
                    {"furniture_id": f.id},
                )
            )
    half = MIN_CORRIDOR_WIDTH_M / 2.0
    for room in scene.rooms:
        items = [(f, _footprint(f)) for f in scene.furniture if f.room_id == room.id]
        if not items:
            continue
        free = Polygon(room.polygon).difference(unary_union([*walls, *(p for _, p in items)]))
        opened = free.buffer(-half, join_style=2).buffer(half, join_style=2)
        pockets = free.difference(opened.buffer(0.01))
        geoms = list(getattr(pockets, "geoms", [pockets]))
        for pocket in geoms:
            if pocket.is_empty or pocket.area < _MIN_POCKET_M2:
                continue
            rect = pocket.minimum_rotated_rectangle
            xs = list(rect.exterior.coords)
            sides = sorted(math.dist(xs[i], xs[i + 1]) for i in range(2))
            if sides[1] < _MIN_POCKET_LONG_SIDE_M:
                continue
            near = min(items, key=lambda it: it[1].distance(pocket))[0]
            out.append(
                Finding(
                    f"passage next to {near.id} is narrower than {MIN_CORRIDOR_WIDTH_M:.2f} m",
                    CODE_FURNITURE_NARROW_PASSAGE,
                    {"furniture_id": near.id, "room_id": room.id},
                )
            )
    return out
