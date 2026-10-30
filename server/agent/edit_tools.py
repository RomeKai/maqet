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
from server.scene import ops
from server.scene.models import Room, Scene, Wall
from server.scene.rules import INTERIOR_WALL_THICKNESS_M

_EPS = 1e-6
Point = tuple[float, float]


class EditError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def _pick(items: list, ref: str | None, selected, kind: str):
    if ref is None and selected is not None and selected.kind.casefold() == kind:
        ref = selected.id
    if ref is None:
        raise EditError("anchor.unknown", f"say which {kind}; Scene unchanged")
    want = ref.strip().casefold()
    hits = [i for i in items if i.id.casefold() == want]
    if kind == "room" and not hits:
        hits = [i for i in items if i.name.casefold() == want]
    if not hits:
        raise EditError("anchor.unknown", f"no {kind} matches {ref!r}; Scene unchanged")
    if len(hits) > 1:
        raise EditError("anchor.ambiguous", f"{len(hits)} {kind}s match {ref!r}; Scene unchanged")
    return hits[0]


def _rect(room: Room) -> tuple[float, float, float, float]:
    xs, ys = [p[0] for p in room.polygon], [p[1] for p in room.polygon]
    x0, y0, x1, y1 = min(xs), min(ys), max(xs), max(ys)
    area = 0.0
    for i, p in enumerate(room.polygon):
        q = room.polygon[(i + 1) % len(room.polygon)]
        area += p[0] * q[1] - q[0] * p[1]
    if abs(abs(area) / 2.0 - (x1 - x0) * (y1 - y0)) > 1e-4:
        raise EditError("room.not_rectangular", f"room {room.id!r} is not a rectangle; Scene unchanged")
    return x0, y0, x1, y1


def _remap(scene: Scene, mapping: Callable[[Point], Point]) -> tuple[list[Wall], list[Room]]:
    walls = [w.model_copy(update={"a": mapping(w.a), "b": mapping(w.b)}) for w in scene.walls]
    rooms = [r.model_copy(update={"polygon": [mapping(p) for p in r.polygon]}) for r in scene.rooms]
    return walls, rooms


def _same(p: Point, q: Point) -> bool:
    return abs(p[0] - q[0]) < _EPS and abs(p[1] - q[1]) < _EPS


def _resize_room(scene: Scene, a: tool_contracts.ResizeRoomInput):
    room = _pick(scene.rooms, a.room, a.selected, "room")
    x0, y0, x1, y1 = _rect(room)
    nx1, ny1 = x0 + a.width_m, y0 + a.depth_m

    def mapping(p: Point) -> Point:
        on_x = abs(p[0] - x1) < _EPS and y0 - _EPS <= p[1] <= y1 + _EPS
        on_y = abs(p[1] - y1) < _EPS and x0 - _EPS <= p[0] <= x1 + _EPS
        return (nx1 if on_x else p[0], ny1 if on_y else p[1])

    walls, rooms = _remap(scene, mapping)
    return walls, list(scene.openings), rooms


def _set_wall_length(scene: Scene, a: tool_contracts.SetWallLengthInput):
    wall = _pick(scene.walls, a.wall, a.selected, "wall")
    length = math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1])
    new_b = (
        wall.a[0] + (wall.b[0] - wall.a[0]) / length * a.length_m,
        wall.a[1] + (wall.b[1] - wall.a[1]) / length * a.length_m,
    )
    old_b = wall.b
    walls, rooms = _remap(scene, lambda p: new_b if _same(p, old_b) else p)
    return walls, list(scene.openings), rooms


def _move_wall(scene: Scene, a: tool_contracts.MoveWallInput):
    wall = _pick(scene.walls, a.wall, a.selected, "wall")
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
    openings = [o.model_copy(update=update) if o.id == op.id else o for o in scene.openings]
    return list(scene.walls), openings, list(scene.rooms)


def _split_room(scene: Scene, a: tool_contracts.SplitRoomInput):
    room = _pick(scene.rooms, a.room, a.selected, "room")
    x0, y0, x1, y1 = _rect(room)
    if a.axis == "x":  # wall runs east-west
        y = y0 + a.at_ratio * (y1 - y0)
        pa, pb = (x0, y), (x1, y)
    else:
        x = x0 + a.at_ratio * (x1 - x0)
        pa, pb = (x, y0), (x, y1)
    taken = {w.id for w in scene.walls}
    n = len(taken) + 1
    while f"w{n}" in taken:
        n += 1
    partition = Wall(
        id=f"w{n}", a=pa, b=pb, thickness_m=INTERIOR_WALL_THICKNESS_M, kind="interior"
    )
    return [*scene.walls, partition], list(scene.openings), list(scene.rooms)


def _rename_room(scene: Scene, a: tool_contracts.RenameRoomInput):
    room = _pick(scene.rooms, a.room, a.selected, "room")
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
