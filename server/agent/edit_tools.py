"""Edit tools for the Reform stage: change the measures of what exists.

Every handler computes the new geometry deterministically (the model only
sends meters and semantic references, ADR-002) and hands it to the single pure
op ``ops.edit_geometry``; rules.py validates the result like any other op.
"""

from __future__ import annotations

import math
from dataclasses import replace
from typing import Callable

from server.agent import tools as tool_contracts
from server.agent.addressing import (
    resolve_wall_target,
    unknown_wall_error,
)
from server.agent.wall_labels import resolve_in_walls
from server.scene import ops
from server.scene.models import Room, Scene, Wall
from server.scene.rules import INTERIOR_WALL_THICKNESS_M, WINDOW_SILL_M

_EPS = 1e-6
Point = tuple[float, float]


class EditError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def _valid(items: list, kind: str) -> str:
    """What exists, so the next call can be right."""
    if kind == "wall":
        return ", ".join(f"wall {i + 1} (id {w.id})" for i, w in enumerate(items)) or "none"
    if kind == "room":
        return ", ".join(f"{r.id}={r.name}" for r in items) or "none"
    return ", ".join(i.id for i in items) or "none"


def _pick_room(scene: Scene, a) -> Room:
    """A room by id/name or "new"/"last" (the most recently added room)."""
    from server.agent.addressing import resolve_room

    if a.room is not None and not any(r.id.casefold() == a.room.strip().casefold() or r.name.casefold() == a.room.strip().casefold() for r in scene.rooms):
        alias = resolve_room(scene, a.room)
        if alias is not None:
            return alias
    return _pick(scene.rooms, a.room, a.selected, "room")


def _pick_wall(scene: Scene, a) -> Wall:
    """A wall by label/id, by room + side, or by tap selection."""
    wid, err = resolve_wall_target(scene, ref=a.wall, room=a.room, side=a.side, selected=a.selected)
    if wid is None:
        raise EditError("anchor.unknown", err or unknown_wall_error(scene, a.wall))
    return next(w for w in scene.walls if w.id == wid)


def _pick(items: list, ref: str | None, selected, kind: str):
    if ref is None and selected is not None and selected.kind.casefold() == kind:
        ref = selected.id
    if ref is None:
        raise EditError("anchor.unknown", f"say which {kind}; Scene unchanged")
    want = ref.strip().casefold()
    hits = [i for i in items if i.id.casefold() == want]
    if kind == "wall" and not hits:  # human label: "wall 3", "3", "muro 3"
        wid = resolve_in_walls(items, ref)
        hits = [i for i in items if i.id == wid] if wid else []
    if kind == "room" and not hits:
        hits = [i for i in items if i.name.casefold() == want]
    if not hits:
        raise EditError("anchor.unknown", f"no {kind} matches {ref!r}; valid {kind}s: {_valid(items, kind)}; Scene unchanged")
    if len(hits) > 1:
        raise EditError("anchor.ambiguous", f"{len(hits)} {kind}s match {ref!r}; Scene unchanged")
    return hits[0]


_MAX_SKEW = math.sin(math.radians(5.0))  # corner angles within 5 degrees of 90
_EDGE_TOL_M = 0.30  # a wall end sits on a room edge when within this distance


class _Frame:
    """A near-rectangular room in its own (possibly slightly rotated/skewed) frame.

    Intake rooms come from sketch centerlines, so they are never exactly
    axis-aligned. ``u`` runs east-ish, ``v`` north-ish (unit vectors); a point
    is ``origin + s*u + t*v`` with 0 <= s <= width, 0 <= t <= depth.
    """

    def __init__(self, origin: Point, u: Point, v: Point, width: float, depth: float) -> None:
        self.origin, self.u, self.v, self.width, self.depth = origin, u, v, width, depth

    def coords(self, p: Point) -> Point:
        dx, dy = p[0] - self.origin[0], p[1] - self.origin[1]
        det = self.u[0] * self.v[1] - self.u[1] * self.v[0]
        return ((dx * self.v[1] - dy * self.v[0]) / det, (self.u[0] * dy - self.u[1] * dx) / det)

    def at(self, s: float, t: float) -> Point:
        return (
            self.origin[0] + s * self.u[0] + t * self.v[0],
            self.origin[1] + s * self.u[1] + t * self.v[1],
        )


def _unit(vx: float, vy: float) -> Point:
    n = math.hypot(vx, vy)
    return (vx / n, vy / n)


def _frame(room: Room) -> _Frame:
    pts = list(room.polygon)
    if len(pts) == 5 and pts[0] == pts[-1]:  # closed ring
        pts = pts[:-1]
    fail = EditError("room.not_rectangular", f"room {room.id!r} is not a rectangle; Scene unchanged")
    if len(pts) != 4:
        raise fail
    horiz: list[Point] = []
    vert: list[Point] = []
    for i, p in enumerate(pts):
        q = pts[(i + 1) % 4]
        dx, dy = q[0] - p[0], q[1] - p[1]
        if math.hypot(dx, dy) < _EPS:
            raise fail
        if abs(dx) >= abs(dy):
            horiz.append((dx, dy) if dx > 0 else (-dx, -dy))
        else:
            vert.append((dx, dy) if dy > 0 else (-dx, -dy))
    if len(horiz) != 2 or len(vert) != 2:
        raise fail
    u = _unit(sum(h[0] for h in horiz), sum(h[1] for h in horiz))
    v = _unit(sum(w[0] for w in vert), sum(w[1] for w in vert))
    if abs(u[0] * v[0] + u[1] * v[1]) > _MAX_SKEW:
        raise fail
    probe = _Frame(pts[0], u, v, 0.0, 0.0)
    st = [probe.coords(p) for p in pts]
    s0, s1 = min(c[0] for c in st), max(c[0] for c in st)
    t0, t1 = min(c[1] for c in st), max(c[1] for c in st)
    origin = probe.at(s0, t0)
    return _Frame(origin, u, v, s1 - s0, t1 - t0)


def _remap(scene: Scene, mapping: Callable[[Point], Point]) -> tuple[list[Wall], list[Room]]:
    walls = [w.model_copy(update={"a": mapping(w.a), "b": mapping(w.b)}) for w in scene.walls]
    rooms = [r.model_copy(update={"polygon": [mapping(p) for p in r.polygon]}) for r in scene.rooms]
    return walls, rooms


def _same(p: Point, q: Point) -> bool:
    return abs(p[0] - q[0]) < _EPS and abs(p[1] - q[1]) < _EPS


def _resize_room(scene: Scene, a: tool_contracts.ResizeRoomInput):
    room = _pick_room(scene, a)
    f = _frame(room)
    d_w, d_d = a.width_m - f.width, a.depth_m - f.depth

    def mapping(p: Point) -> Point:
        s, t = f.coords(p)
        inside = -_EDGE_TOL_M <= s <= f.width + _EDGE_TOL_M and -_EDGE_TOL_M <= t <= f.depth + _EDGE_TOL_M
        if not inside:
            return p
        ds = d_w if s > f.width - _EDGE_TOL_M else 0.0
        dt = d_d if t > f.depth - _EDGE_TOL_M else 0.0
        if ds == 0.0 and dt == 0.0:
            return p
        return (p[0] + ds * f.u[0] + dt * f.v[0], p[1] + ds * f.u[1] + dt * f.v[1])

    walls, rooms = _remap(scene, mapping)
    return walls, list(scene.openings), rooms


def _set_wall_length(scene: Scene, a: tool_contracts.SetWallLengthInput):
    wall = _pick_wall(scene, a)
    length = math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1])
    new_b = (
        wall.a[0] + (wall.b[0] - wall.a[0]) / length * a.length_m,
        wall.a[1] + (wall.b[1] - wall.a[1]) / length * a.length_m,
    )
    old_b = wall.b
    walls, rooms = _remap(scene, lambda p: new_b if _same(p, old_b) else p)
    return walls, list(scene.openings), rooms


def _move_wall(scene: Scene, a: tool_contracts.MoveWallInput):
    wall = _pick_wall(scene, a)
    length = math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1])
    nx, ny = -(wall.b[1] - wall.a[1]) / length, (wall.b[0] - wall.a[0]) / length
    if ny < -_EPS or (abs(ny) <= _EPS and nx < 0):  # positive = north / east
        nx, ny = -nx, -ny
    dx, dy = nx * a.offset_m, ny * a.offset_m
    ends = (wall.a, wall.b)
    walls, rooms = _remap(
        scene,
        lambda p: (p[0] + dx, p[1] + dy) if any(_same(p, e) for e in ends) else p,
    )
    return walls, list(scene.openings), rooms


def _set_opening_size(scene: Scene, a: tool_contracts.SetOpeningSizeInput):
    op = _pick(scene.openings, a.opening, a.selected, "opening")
    update = {
        k: v
        for k, v in (("width_m", a.width_m), ("height_m", a.height_m), ("sill_m", a.sill_m))
        if v is not None
    }
    if op.kind == "window" and op.sill_m is None and "sill_m" not in update:
        update["sill_m"] = WINDOW_SILL_M  # legacy windows drawn at floor level
    openings = [o.model_copy(update=update) if o.id == op.id else o for o in scene.openings]
    return list(scene.walls), openings, list(scene.rooms)


def _split_room(scene: Scene, a: tool_contracts.SplitRoomInput):
    room = _pick_room(scene, a)
    f = _frame(room)
    if a.axis == "x":  # wall runs east-west
        t = a.at_ratio * f.depth
        pa, pb = f.at(0.0, t), f.at(f.width, t)
    else:
        sc = a.at_ratio * f.width
        pa, pb = f.at(sc, 0.0), f.at(sc, f.depth)
    taken = {w.id for w in scene.walls}
    n = len(taken) + 1
    while f"w{n}" in taken:
        n += 1
    partition = Wall(
        id=f"w{n}", a=pa, b=pb, thickness_m=INTERIOR_WALL_THICKNESS_M, kind="interior"
    )
    return [*scene.walls, partition], list(scene.openings), list(scene.rooms)


def _rename_room(scene: Scene, a: tool_contracts.RenameRoomInput):
    room = _pick_room(scene, a)
    if a.name is None and a.function is None:
        raise EditError("tool.invalid_args", "give a new name and/or function; Scene unchanged")
    update = {k: v for k, v in (("name", a.name), ("function", a.function)) if v is not None}
    rooms = [r.model_copy(update=update) if r.id == room.id else r for r in scene.rooms]
    return list(scene.walls), list(scene.openings), rooms


COMPUTE = {
    "resize_room": _resize_room,
    "set_wall_length": _set_wall_length,
    "move_wall": _move_wall,
    "set_opening_size": _set_opening_size,
    "split_room": _split_room,
    "rename_room": _rename_room,
}


def run_edit(scene: Scene, tool: str, parsed):
    """Returns (new_scene, OpResult, undo_snapshot) or raises EditError."""
    walls, openings, rooms = COMPUTE[tool](scene, parsed)
    new_scene, res = ops.edit_geometry(
        scene, tool, walls=tuple(walls), openings=tuple(openings), rooms=tuple(rooms)
    )
    snapshot = {
        "kind": "geometry",
        "walls": [w.model_dump() for w in scene.walls],
        "openings": [o.model_dump() for o in scene.openings],
        "rooms": [r.model_dump() for r in scene.rooms],
    }
    return new_scene, res, snapshot


def attach_history(history: list, record, snapshot: dict) -> None:
    history.append(replace(record, args={**record.args, "_undo": snapshot}))
