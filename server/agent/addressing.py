"""Room-aware addressing: the model names rooms and sides, code finds the wall (bug X).

Wall numbers change whenever a room is added, so a model that guesses "wall 9"
fails. Instead every wall-taking tool accepts ``room`` + ``side`` (north, south,
east, west, exterior, shared), and ``"new"`` / ``"last"`` resolve to the most
recently added room. Everything here is deterministic (ADR-002); errors list
what DOES exist so the next call can be right.
"""

from __future__ import annotations

import math
import re
from typing import Any

from shapely.geometry import Point as ShPoint
from shapely.geometry import Polygon

from server.agent.wall_labels import resolve_in_walls, wall_label, wall_orientation
from server.scene.models import Room, Scene, Wall

_NEAR_M = 0.30  # a wall bounds a room when its ends and midpoint sit this close to the outline
_SIDES = {
    "north": "north", "norte": "north", "n": "north",
    "south": "south", "sur": "south", "s": "south",
    "east": "east", "este": "east", "e": "east",
    "west": "west", "oeste": "west", "w": "west",
    "exterior": "exterior", "outside": "exterior", "outer": "exterior",
    "shared": "shared", "interior": "shared", "inside": "shared", "compartida": "shared",
}
_NEW_WORDS = ("new", "last", "latest", "recent", "nuev", "últim", "ultim", "reciente")
_SIDE_IN_TEXT = re.compile(
    r"\b(north|south|east|west|norte|sur|este|oeste|exterior|shared)\b", re.IGNORECASE
)
_OF = re.compile(r"\b(?:of|de|del|in|en)\b\s+(?:the\s+|la\s+|el\s+)?(.+)$", re.IGNORECASE)


def _length(wall: Wall) -> float:
    return math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1])


def _mid(wall: Wall) -> tuple[float, float]:
    return ((wall.a[0] + wall.b[0]) / 2.0, (wall.a[1] + wall.b[1]) / 2.0)


def room_walls(scene: Scene, room: Room) -> list[Wall]:
    """Walls that bound the room (ends and midpoint on its outline)."""
    ring = Polygon(room.polygon).exterior
    return [
        w
        for w in scene.walls
        if all(ring.distance(ShPoint(p)) < _NEAR_M for p in (w.a, w.b, _mid(w)))
    ]


def rooms_of_wall(scene: Scene, wall: Wall) -> list[Room]:
    return [r for r in scene.rooms if any(w.id == wall.id for w in room_walls(scene, r))]


def side_of(room: Room, wall: Wall) -> str:
    """north/south/east/west of the wall relative to the room's centre (plan y = north)."""
    c = Polygon(room.polygon).centroid
    mx, my = _mid(wall)
    dx, dy = abs(wall.b[0] - wall.a[0]), abs(wall.b[1] - wall.a[1])
    if dx >= dy:
        return "north" if my > c.y else "south"
    return "east" if mx > c.x else "west"


def resolve_room(scene: Scene, ref: str | None) -> Room | None:
    """Room by id, name, or "new"/"last" (the most recently added room)."""
    if ref is None or not ref.strip() or not scene.rooms:
        return None
    want = ref.strip().casefold()
    for room in scene.rooms:
        if room.id.casefold() == want or room.name.casefold() == want:
            return room
    if any(word in want for word in _NEW_WORDS):
        named = [r for r in scene.rooms if r.name.casefold() in want]
        return named[-1] if named else scene.rooms[-1]
    hits = [r for r in scene.rooms if want in r.name.casefold() or r.name.casefold() in want]
    return hits[0] if len(hits) == 1 else None


def _room_wall_listing(scene: Scene, room: Room) -> str:
    walls = room_walls(scene, room)
    parts = [
        f"wall {scene.walls.index(w) + 1} ({side_of(room, w)}, {_length(w):.1f} m)" for w in walls
    ]
    return f"valid walls of {room.name}: " + (", ".join(parts) or "none")


def unknown_room_error(scene: Scene, ref: str | None) -> str:
    rooms = ", ".join(f"{r.id}={r.name}" for r in scene.rooms) or "none"
    return (
        f"no room matches {ref!r}; valid rooms: {rooms} "
        '("new" = the last added room); Scene unchanged'
    )


def unknown_wall_error(scene: Scene, ref: str | None, room: Room | None = None) -> str:
    if room is not None:
        return f"wall {ref!r} does not exist; {_room_wall_listing(scene, room)}; Scene unchanged"
    walls = ", ".join(wall_label(scene, w.id) for w in scene.walls) or "none"
    return f"wall {ref!r} does not exist; valid walls: {walls}; Scene unchanged"


def wall_on_side(scene: Scene, room: Room, side: str) -> tuple[Wall | None, str | None]:
    """The wall of `room` on a side, or (None, actionable error)."""
    key = _SIDES.get(side.strip().casefold())
    if key is None:
        return None, (
            f"unknown side {side!r}; use north, south, east, west, exterior or shared; "
            f"{_room_wall_listing(scene, room)}; Scene unchanged"
        )
    walls = room_walls(scene, room)
    if key in ("north", "south", "east", "west"):
        hits = [w for w in walls if side_of(room, w) == key]
    else:
        shared = [w for w in walls if len(rooms_of_wall(scene, w)) > 1]
        hits = shared if key == "shared" else [w for w in walls if w not in shared]
    if not hits:
        return None, f"{room.name} has no {key} wall; {_room_wall_listing(scene, room)}; Scene unchanged"
    if len(hits) > 1 and key in ("exterior", "shared"):
        listing = ", ".join(wall_label(scene, w.id) for w in hits)
        return None, (
            f"{room.name} has several {key} walls ({listing}); "
            "say a side (north/south/east/west) instead; Scene unchanged"
        )
    return max(hits, key=_length), None


def resolve_wall_target(
    scene: Scene,
    *,
    ref: str | None = None,
    room: str | None = None,
    side: str | None = None,
    selected: Any = None,
) -> tuple[str | None, str | None]:
    """(wall id, None) or (None, error); (None, None) when nothing names a wall.

    Order: explicit ref (id or label), room + side, tap selection.
    """
    room_obj: Room | None = None
    if room is not None and room.strip():
        room_obj = resolve_room(scene, room)
        if room_obj is None:
            return None, unknown_room_error(scene, room)
    if ref is not None and ref.strip():
        wid = resolve_in_walls(scene.walls, ref)
        if wid is not None:
            return wid, None
        # "north wall of the new bedroom": a description instead of a label
        found = _SIDE_IN_TEXT.search(ref)
        if found is not None:
            of = _OF.search(ref)
            target = room_obj or (resolve_room(scene, of.group(1)) if of else None)
            if target is None and "new" in ref.casefold() and scene.rooms:
                target = scene.rooms[-1]
            if target is not None:
                wall, err = wall_on_side(scene, target, found.group(1))
                return (wall.id, None) if wall is not None else (None, err)
        return None, unknown_wall_error(scene, ref, room_obj)
    if room_obj is not None:
        if side is None or not side.strip():
            return None, (
                f"say which side of {room_obj.name}; "
                f"{_room_wall_listing(scene, room_obj)}; Scene unchanged"
            )
        wall, err = wall_on_side(scene, room_obj, side)
        return (wall.id, None) if wall is not None else (None, err)
    if selected is not None and str(getattr(selected, "kind", "")).casefold() == "wall":
        wid = resolve_in_walls(scene.walls, selected.id)
        if wid is not None:
            return wid, None
    return None, None


def wall_table(scene: Scene) -> list[dict[str, Any]]:
    """Current walls: label, orientation, length, room(s), openings. Sent after every op."""
    rows = []
    for index, wall in enumerate(scene.walls):
        rows.append(
            {
                "label": f"wall {index + 1}",
                "id": wall.id,
                "orientation": wall_orientation(scene, wall),
                "length_m": round(_length(wall), 2),
                "kind": wall.kind,
                "rooms": [r.name for r in rooms_of_wall(scene, wall)],
                "openings": [
                    {
                        "id": o.id,
                        "kind": o.kind,
                        "offset_m": round(o.offset_m, 2),
                        "width_m": round(o.width_m, 2),
                    }
                    for o in scene.openings
                    if o.wall_id == wall.id
                ],
            }
        )
    return rows
