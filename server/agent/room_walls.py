"""Deterministic enclosing walls and connecting door for a new room.

ADR-002: the model asks for a room; this code (not the model) derives the
walls. Edges already covered by an existing wall are reused (never doubled);
only the uncovered stretches become new exterior walls. One door is cut
through the longest shared stretch so the new room is reachable.
"""

from __future__ import annotations

import math

from server.scene.models import Opening, Scene, Wall
from server.scene.rules import DOOR_WIDTH_M, EXTERIOR_WALL_THICKNESS_M

_EPS = 1e-6
_DOOR_HEIGHT_M = 2.10
_DOOR_MARGIN_M = 0.10  # clear wall left on each side of the door


def _interval_on_edge(
    p: tuple[float, float], d: tuple[float, float], length: float, wall: Wall
) -> tuple[float, float] | None:
    """Overlap of a collinear wall with the edge, as [t0, t1] in meters."""
    ts = []
    for pt in (wall.a, wall.b):
        rx, ry = pt[0] - p[0], pt[1] - p[1]
        if abs(rx * d[1] - ry * d[0]) > _EPS:  # not on the edge's line
            return None
        ts.append(rx * d[0] + ry * d[1])
    t0, t1 = max(min(ts), 0.0), min(max(ts), length)
    return (t0, t1) if t1 - t0 > _EPS else None


def _merge(intervals: list[tuple[float, float]]) -> list[tuple[float, float]]:
    merged: list[tuple[float, float]] = []
    for lo, hi in sorted(intervals):
        if merged and lo <= merged[-1][1] + _EPS:
            merged[-1] = (merged[-1][0], max(merged[-1][1], hi))
        else:
            merged.append((lo, hi))
    return merged


def enclosing_walls(
    scene: Scene, polygon: list[tuple[float, float]]
) -> tuple[list[Wall], Opening | None]:
    """Missing walls for ``polygon`` plus a door through the longest shared wall."""
    taken = {w.id for w in scene.walls}
    counter = len(taken) + 1

    def next_id(prefix: str) -> str:
        nonlocal counter
        while f"{prefix}{counter}" in taken:
            counter += 1
        new_id = f"{prefix}{counter}"
        taken.add(new_id)
        return new_id

    new_walls: list[Wall] = []
    best: tuple[float, Wall, tuple[float, float]] | None = None
    n = len(polygon)
    for i in range(n):
        p, q = polygon[i], polygon[(i + 1) % n]
        length = math.hypot(q[0] - p[0], q[1] - p[1])
        if length <= _EPS:
            continue
        d = ((q[0] - p[0]) / length, (q[1] - p[1]) / length)
        covered: list[tuple[float, float]] = []
        for wall in scene.walls:
            iv = _interval_on_edge(p, d, length, wall)
            if iv is None:
                continue
            covered.append(iv)
            if best is None or iv[1] - iv[0] > best[0]:
                mid = (iv[0] + iv[1]) / 2.0
                best = (iv[1] - iv[0], wall, (p[0] + d[0] * mid, p[1] + d[1] * mid))
        cursor = 0.0
        for lo, hi in [*_merge(covered), (length, length)]:
            if lo - cursor > _EPS:
                a = (p[0] + d[0] * cursor, p[1] + d[1] * cursor)
                b = (p[0] + d[0] * lo, p[1] + d[1] * lo)
                new_walls.append(
                    Wall(
                        id=next_id("w"),
                        a=a,
                        b=b,
                        thickness_m=EXTERIOR_WALL_THICKNESS_M,
                        kind="exterior",
                    )
                )
            cursor = max(cursor, hi)

    door: Opening | None = None
    if best is not None and best[0] >= DOOR_WIDTH_M + 2 * _DOOR_MARGIN_M:
        _, wall, (ex, ey) = best
        wl = math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1])
        wd = ((wall.b[0] - wall.a[0]) / wl, (wall.b[1] - wall.a[1]) / wl)
        along = (ex - wall.a[0]) * wd[0] + (ey - wall.a[1]) * wd[1]
        offset = min(max(along - DOOR_WIDTH_M / 2.0, 0.0), wl - DOOR_WIDTH_M)
        door = Opening(
            id=_unique_opening_id(scene),
            wall_id=wall.id,
            kind="door",
            offset_m=offset,
            width_m=DOOR_WIDTH_M,
            height_m=_DOOR_HEIGHT_M,
        )
    return new_walls, door


def _unique_opening_id(scene: Scene) -> str:
    owned = {o.id for o in scene.openings}
    n = len(owned) + 1
    while f"o{n}" in owned:
        n += 1
    return f"o{n}"
