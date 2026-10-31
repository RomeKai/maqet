"""Design stage: deterministic furniture placement (ADR-002).

The model names a catalog item, a room and optionally a wall; code finds the
spot. A footprint is valid when it lies inside the room, touches no wall body,
no other item and no door swing zone. Rotation is snapped to 90 degrees.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

from shapely.geometry import LineString, Point, Polygon

from server.agent.wall_labels import resolve_in_walls
from server.scene.models import Furniture, Room, Scene

CATALOG_PATH = Path(__file__).resolve().parents[2] / "assets" / "catalog.json"
SCALE_MIN, SCALE_MAX = 0.8, 1.2  # AGENTS.md: real dimensions, +-20% only
_GRID_M = 0.1
_PUSH_STEP_M = 0.02
_PUSH_MAX_M = 0.4
_EPS_AREA = 1e-6


class DesignError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def load_catalog() -> dict:
    return json.loads(CATALOG_PATH.read_text(encoding="utf-8"))


def catalog_item(catalog_id: str) -> dict:
    for item in load_catalog()["furniture"]:
        if item["id"] == catalog_id and not item.get("clearance_only"):
            return item
    raise DesignError("catalog.unknown_item", f"no furniture {catalog_id!r} in the catalog; use list_catalog")


def snap90(deg: float) -> float:
    return float((round(deg / 90.0) * 90) % 360)


def footprint(position: tuple[float, float], size: tuple[float, float, float], rot_deg: float) -> Polygon:
    w, d = size[0], size[1]
    t = math.radians(rot_deg)
    c, s = math.cos(t), math.sin(t)
    return Polygon(
        [
            (position[0] + x * c - y * s, position[1] + x * s + y * c)
            for x, y in ((-w / 2, -d / 2), (w / 2, -d / 2), (w / 2, d / 2), (-w / 2, d / 2))
        ]
    )


def _wall_bodies(scene: Scene) -> list[Polygon]:
    return [LineString([w.a, w.b]).buffer(w.thickness_m / 2.0, cap_style=2) for w in scene.walls]


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


def is_valid(scene: Scene, room: Room, poly: Polygon, ignore_id: str | None = None, zones: bool = True) -> bool:
    if not Polygon(room.polygon).buffer(1e-6).contains(poly):
        return False
    if any(poly.intersection(w).area > _EPS_AREA for w in _wall_bodies(scene)):
        return False
    for f in scene.furniture:
        if f.id != ignore_id and poly.intersection(footprint(f.position, f.size_m, f.rotation_deg)).area > _EPS_AREA:
            return False
    if zones and any(poly.intersection(z).area > _EPS_AREA for z in door_swing_zones(scene)):
        return False
    return True


def _edges(room: Room) -> list[tuple[tuple[float, float], tuple[float, float], tuple[float, float], float]]:
    ring = Polygon(room.polygon)
    pts = list(ring.exterior.coords) if ring.exterior.is_ccw else list(ring.exterior.coords)[::-1]
    out = []
    for p, q in zip(pts, pts[1:]):
        length = math.hypot(q[0] - p[0], q[1] - p[1])
        if length < 0.3:
            continue
        d = ((q[0] - p[0]) / length, (q[1] - p[1]) / length)
        out.append((p, d, (-d[1], d[0]), length))  # CCW ring: left normal points inside
    return sorted(out, key=lambda e: -e[3])


def _wall_candidates(room: Room, size, only_wall=None):
    w, depth = size[0], size[1]
    for p, d, n, length in _edges(room):
        if only_wall is not None:
            mid = Point(p[0] + d[0] * length / 2, p[1] + d[1] * length / 2)
            line = LineString([only_wall.a, only_wall.b])
            dwx, dwy = only_wall.b[0] - only_wall.a[0], only_wall.b[1] - only_wall.a[1]
            norm = math.hypot(dwx, dwy) or 1.0
            parallel = abs(d[0] * dwx / norm + d[1] * dwy / norm) > 0.99
            if not parallel or line.distance(mid) > only_wall.thickness_m / 2 + 0.35:
                continue
        rot = snap90(math.degrees(math.atan2(-n[0], n[1])))
        span = max(length - w, 0.0)
        steps = sorted({round(i * _GRID_M, 3) for i in range(int(span / _GRID_M) + 1)} | {round(span, 3)},
                       key=lambda s: abs(s - span / 2))
        for s in steps:
            for k in range(int(_PUSH_MAX_M / _PUSH_STEP_M) + 1):
                off = depth / 2 + k * _PUSH_STEP_M
                yield (
                    (p[0] + d[0] * (s + w / 2) + n[0] * off, p[1] + d[1] * (s + w / 2) + n[1] * off),
                    rot,
                )


def _center_candidates(room: Room, size):
    poly = Polygon(room.polygon)
    c = poly.representative_point()
    minx, miny, maxx, maxy = poly.bounds
    pts = []
    x = minx
    while x <= maxx:
        y = miny
        while y <= maxy:
            pts.append((round(x, 3), round(y, 3)))
            y += _GRID_M
        x += _GRID_M
    pts.sort(key=lambda q: (math.hypot(q[0] - c.x, q[1] - c.y), q))
    for q in pts:
        yield q, 0.0
        yield q, 90.0


def find_spot(scene: Scene, room: Room, size, placement: str, wall_ref: str | None = None, ignore_id: str | None = None):
    only_wall = None
    if wall_ref is not None:
        wid = resolve_in_walls(scene.walls, wall_ref)
        only_wall = next((w for w in scene.walls if w.id == wid), None)
        if only_wall is None:
            raise DesignError("anchor.unknown", f"no wall matches {wall_ref!r}; Scene unchanged")
    sources = [_wall_candidates(room, size, only_wall)]
    if only_wall is None:
        sources = [_center_candidates(room, size)] if placement == "center" else sources
        sources.append(_wall_candidates(room, size)) if placement == "center" else None
        sources.append(_center_candidates(room, size)) if placement != "center" else None
    for source in sources:
        for pos, rot in source:
            sz = (size[0], size[1], size[2]) if rot % 180 == 0 else size
            # rotation is applied by footprint(); sizes stay (w, d, h)
            if is_valid(scene, room, footprint(pos, sz, rot), ignore_id):
                return pos, rot
    raise DesignError("furniture.no_space", f"{room.name} has no free spot for it; Scene unchanged")


def pick_room(scene: Scene, ref: str | None, selected, function_hint: str | None = None) -> Room:
    if ref is None and selected is not None and selected.kind.casefold() == "room":
        ref = selected.id
    if ref is not None:
        want = ref.strip().casefold()
        hits = [r for r in scene.rooms if r.id.casefold() == want or r.name.casefold() == want]
        if len(hits) == 1:
            return hits[0]
        raise DesignError("anchor.unknown", f"no single room matches {ref!r}; say which room; Scene unchanged")
    if len(scene.rooms) == 1:
        return scene.rooms[0]
    hits = [r for r in scene.rooms if function_hint and r.function == function_hint]
    if len(hits) == 1:
        return hits[0]
    raise DesignError("anchor.unknown", "say which room; Scene unchanged")


_FUNCTION_HINT = {"bed": "bedroom", "wardrobe": "bedroom", "stove": "kitchen", "sofa": "living", "table": "dining"}


def new_item_id(scene: Scene, base: str | None) -> str:
    taken = {f.id for f in scene.furniture}
    if base and base not in taken:
        return base
    n = len(taken) + 1
    while f"f{n}" in taken:
        n += 1
    return f"f{n}"


def place(scene: Scene, a) -> tuple[list[Furniture], list[str]]:
    item = catalog_item(a.catalog_id)
    scale = 1.0 if a.scale is None else a.scale
    if not (SCALE_MIN - 1e-9 <= scale <= SCALE_MAX + 1e-9):
        raise DesignError("furniture.scale_out_of_range", f"scale must stay within {SCALE_MIN} to {SCALE_MAX} of the real size")
    dims = item["dims_m"]
    size = (round(dims["w"] * scale, 4), round(dims["d"] * scale, 4), round(dims["h"] * scale, 4))
    room = pick_room(scene, a.room_id or a.room, a.selected, _FUNCTION_HINT.get(item.get("type", "")))
    pos, rot = find_spot(scene, room, size, item.get("placement", "wall"), a.anchor)
    f = Furniture(
        id=new_item_id(scene, a.item_id), catalog_id=item["id"], room_id=room.id,
        position=(round(pos[0], 4), round(pos[1], 4)), rotation_deg=rot, size_m=size,
    )
    return [*scene.furniture, f], [f.id]


def pick_item(scene: Scene, ref: str | None, selected) -> Furniture:
    if ref is None and selected is not None and selected.kind.casefold() in ("furniture", "item"):
        ref = selected.id
    if ref is None or not scene.furniture:
        raise DesignError("anchor.unknown", "say which item; Scene unchanged")
    want = ref.strip().casefold()
    if want in ("last", "latest", "ultimo", "último"):
        return scene.furniture[-1]
    hits = [f for f in scene.furniture if f.id.casefold() == want]
    if not hits:
        types = {i["id"]: i.get("type", "") for i in load_catalog()["furniture"]}
        hits = [f for f in scene.furniture if types.get(f.catalog_id or "", "") == want]
    if len(hits) != 1:
        raise DesignError("anchor.unknown" if not hits else "anchor.ambiguous", f"{len(hits)} items match {ref!r}; Scene unchanged")
    return hits[0]


def _replace(scene: Scene, new: Furniture) -> list[Furniture]:
    return [new if f.id == new.id else f for f in scene.furniture]


def move(scene: Scene, a) -> tuple[list[Furniture], list[str]]:
    f = pick_item(scene, a.item_id or a.item, a.selected)
    room = next((r for r in scene.rooms if r.id == f.room_id), None)
    if a.room is not None:
        room = pick_room(scene, a.room, None)
    if room is None:
        raise DesignError("anchor.unknown", "that item has no room; Scene unchanged")
    if a.position is not None:
        pos, rot = (float(a.position[0]), float(a.position[1])), f.rotation_deg
        if not is_valid(scene, room, footprint(pos, f.size_m, rot), f.id, zones=False):
            raise DesignError("furniture.blocked", "that spot overlaps a wall, another item or leaves the room; Scene unchanged")
    elif a.wall is not None or a.room is not None:
        placement = next((i.get("placement", "wall") for i in load_catalog()["furniture"] if i["id"] == f.catalog_id), "wall")
        pos, rot = find_spot(scene, room, f.size_m, placement, a.wall, f.id)
    else:
        raise DesignError("tool.invalid_args", "give a position, a wall or a room; Scene unchanged")
    return _replace(scene, f.model_copy(update={"position": (round(pos[0], 4), round(pos[1], 4)), "rotation_deg": rot, "room_id": room.id})), [f.id]


def rotate(scene: Scene, a) -> tuple[list[Furniture], list[str]]:
    f = pick_item(scene, a.item_id or a.item, a.selected)
    if a.rotation_deg is not None:
        rot = snap90(a.rotation_deg)
    else:
        rot = snap90(f.rotation_deg + (90.0 if a.delta_deg is None else a.delta_deg))
    room = next((r for r in scene.rooms if r.id == f.room_id), None)
    if room is None or not is_valid(scene, room, footprint(f.position, f.size_m, rot), f.id, zones=False):
        raise DesignError("furniture.blocked", "it does not fit turned that way; move it first; Scene unchanged")
    return _replace(scene, f.model_copy(update={"rotation_deg": rot})), [f.id]


def remove(scene: Scene, a) -> tuple[list[Furniture], list[str]]:
    f = pick_item(scene, a.item_id or a.item, a.selected)
    return [x for x in scene.furniture if x.id != f.id], [f.id]
