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
) -> tuple[list[Wall], Opening | None, list[str]]:
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
    shared: list[tuple[float, Wall, float, float]] = []  # (length, wall, along_lo, along_hi)
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
            wl = math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1])
            wd = ((wall.b[0] - wall.a[0]) / wl, (wall.b[1] - wall.a[1]) / wl)
            ends = [
                (p[0] + d[0] * t - wall.a[0]) * wd[0] + (p[1] + d[1] * t - wall.a[1]) * wd[1]
                for t in iv
            ]
            shared.append((iv[1] - iv[0], wall, min(ends), max(ends)))
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

    door, warnings = _place_door(scene, shared)
    return new_walls, door, warnings


def _place_door(
    scene: Scene, shared: list[tuple[float, Wall, float, float]]
) -> tuple[Opening | None, list[str]]:
    """Door in a free span of a shared stretch, clear of existing openings."""
    if not shared:
        return None, []
    need = DOOR_WIDTH_M
    for _, wall, lo, hi in sorted(shared, key=lambda x: -x[0]):
        wl = math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1])
        span_lo, span_hi = max(lo, 0.0) + _DOOR_MARGIN_M, min(hi, wl) - _DOOR_MARGIN_M
        blocked = sorted(
            (o.offset_m - _DOOR_MARGIN_M, o.offset_m + o.width_m + _DOOR_MARGIN_M)
            for o in scene.openings
            if o.wall_id == wall.id
        )
        free: list[tuple[float, float]] = []
        cursor = span_lo
        for b_lo, b_hi in blocked:
            if b_lo > cursor:
                free.append((cursor, min(b_lo, span_hi)))
            cursor = max(cursor, b_hi)
        if cursor < span_hi:
            free.append((cursor, span_hi))
        fits = [(f_lo, f_hi) for f_lo, f_hi in free if f_hi - f_lo >= need - _EPS]
        if not fits:
            continue
        mid = (lo + hi) / 2.0
        # Span whose centre is closest to the middle of the shared stretch.
        f_lo, f_hi = min(fits, key=lambda f: abs((f[0] + f[1]) / 2.0 - mid))
        offset = min(max(mid - need / 2.0, f_lo), f_hi - need)
        return (
            Opening(
                id=_unique_opening_id(scene),
                wall_id=wall.id,
                kind="door",
                offset_m=offset,
                width_m=need,
                height_m=_DOOR_HEIGHT_M,
            ),
            [],
        )
    return None, [
        "door.no_free_span: no free span on the shared wall for a door "
        "(windows or doors in the way); add the door by hand"
    ]


def _unique_opening_id(scene: Scene) -> str:
    owned = {o.id for o in scene.openings}
    n = len(owned) + 1
    while f"o{n}" in owned:
        n += 1
    return f"o{n}"
