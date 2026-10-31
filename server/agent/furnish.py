"""Room designer: deterministic layouts for whole rooms (ADR-002).

The model picks a brief kind, optional occupants and optional extras; every
coordinate comes from here. Rules: the bed head sits against a wall with no
window and no door, centered, nightstands flank it; the wardrobe takes a free
wall; the desk goes by the window; dining chairs surround the table; the sofa
faces the TV unit; door swings and 1.00 m passages stay clear (scene/fit.py).
If something does not fit it is skipped with a reason, and a double bed
downgrades to a single bed with a warning.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from shapely.geometry import LineString, Point, Polygon

from server.agent.design import (
    DesignError,
    catalog_item,
    footprint,
    is_valid,
    new_item_id,
    pick_room,
    snap90,
)
from server.scene.fit import furniture_fit_warnings
from server.scene.models import Furniture, Room, Scene

KINDS = ("double_bedroom", "single_bedroom", "kids_room", "study", "living", "dining", "living_dining")
EXTRAS = ("nightstands", "wardrobe", "desk", "bookshelf", "crib", "armchair", "tv", "coffee_table", "chairs")

_DEFAULT_EXTRAS: dict[str, tuple[str, ...]] = {
    "double_bedroom": ("nightstands", "wardrobe"),
    "single_bedroom": ("nightstands", "wardrobe"),
    "kids_room": ("wardrobe", "desk"),
    "study": ("bookshelf",),
    "living": ("tv", "coffee_table"),
    "dining": ("chairs",),
    "living_dining": ("tv", "coffee_table", "chairs"),
}

BED_DOUBLE = "bed-double-140x190"
BED_SINGLE = "bed-single-90x190"
NIGHTSTAND = "nightstand-45x40"
WARDROBE = "wardrobe-120x60"
DESK = "desk-120x60"
DESK_CHAIR = "chair-45x45"
BOOKSHELF = "bookshelf-80x30"
CRIB = "crib-65x125"
ARMCHAIR = "armchair-80x80"
SOFA = "sofa-3seat-200x90"
TV = "tvunit-140x40"
COFFEE = "coffeetable-90x50"
TABLE4 = "table-90x90"
TABLE6 = "table-160x90"
DINING_CHAIR = "chair-dining-45x50"

_STEP_M = 0.1
_PUSH_STEP_M = 0.02
_PUSH_MAX_M = 0.4
_MIN_LIVING_GAP_M = 2.6


def _front_rot(vx: float, vy: float) -> float:
    """rotation_deg whose local +y (front) points along (vx, vy)."""
    return snap90(math.degrees(math.atan2(-vx, vy)))


@dataclass
class Edge:
    p: tuple[float, float]
    d: tuple[float, float]
    n: tuple[float, float]  # inward normal
    length: float
    door: bool = False
    window: bool = False
    window_s: float | None = None  # window center along the edge

    @property
    def openings(self) -> bool:
        return self.door or self.window


def _room_edges(scene: Scene, room: Room) -> list[Edge]:
    ring = Polygon(room.polygon)
    pts = list(ring.exterior.coords) if ring.exterior.is_ccw else list(ring.exterior.coords)[::-1]
    out: list[Edge] = []
    for p, q in zip(pts, pts[1:]):
        length = math.hypot(q[0] - p[0], q[1] - p[1])
        if length < 0.3:
            continue
        d = ((q[0] - p[0]) / length, (q[1] - p[1]) / length)
        e = Edge(p=p, d=d, n=(-d[1], d[0]), length=length)
        mid = Point(p[0] + d[0] * length / 2, p[1] + d[1] * length / 2)
        for w in scene.walls:
            wl = math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1])
            if wl < 1e-6:
                continue
            wd = ((w.b[0] - w.a[0]) / wl, (w.b[1] - w.a[1]) / wl)
            if abs(wd[0] * d[0] + wd[1] * d[1]) < 0.99:
                continue
            if LineString([w.a, w.b]).distance(mid) > w.thickness_m / 2 + 0.35:
                continue
            for o in scene.openings:
                if o.wall_id != w.id:
                    continue
                c = (w.a[0] + wd[0] * (o.offset_m + o.width_m / 2), w.a[1] + wd[1] * (o.offset_m + o.width_m / 2))
                s = (c[0] - p[0]) * d[0] + (c[1] - p[1]) * d[1]
                if -0.2 <= s <= length + 0.2:
                    if o.kind == "door":
                        e.door = True
                    else:
                        e.window = True
                        e.window_s = s
        out.append(e)
    return out


class Furnisher:
    def __init__(self, scene: Scene, room: Room, occupants: int | None) -> None:
        self.room = room
        self.occupants = occupants
        self.scene = scene
        self.edges = _room_edges(scene, room)
        self.placed: list[Furniture] = []
        self.skipped: list[dict[str, str]] = []
        self.warnings: list[str] = []
        self._base_warn = len(furniture_fit_warnings(scene))
        self.relaxed = False  # accept added fit warnings (reported by the op)

    # -- primitives ---------------------------------------------------------
    def _size(self, cid: str) -> tuple[float, float, float]:
        dm = catalog_item(cid)["dims_m"]
        return (dm["w"], dm["d"], dm["h"])

    def _try(self, cid: str, pos: tuple[float, float], rot: float, soft: bool = False) -> Furniture | None:
        size = self._size(cid)
        if not is_valid(self.scene, self.room, footprint(pos, size, rot)):
            return None
        f = Furniture(
            id=new_item_id(self.scene, None), catalog_id=cid, room_id=self.room.id,
            position=(round(pos[0], 4), round(pos[1], 4)), rotation_deg=rot, size_m=size,
        )
        trial = self.scene.model_copy(update={"furniture": [*self.scene.furniture, f]})
        if not (self.relaxed or soft) and len(furniture_fit_warnings(trial)) > self._base_warn:
            return None
        return f

    def _commit(self, f: Furniture) -> Furniture:
        self.scene = self.scene.model_copy(update={"furniture": [*self.scene.furniture, f]})
        self.placed.append(f)
        return f

    def _centers(self, edge: Edge, w: float, mode: str, near: float | None = None) -> list[float]:
        lo, hi = w / 2 + 0.02, edge.length - w / 2 - 0.02
        if hi < lo:
            return []
        n = int((hi - lo) / _STEP_M) + 1
        cs = sorted({round(lo + i * _STEP_M, 3) for i in range(n)} | {round(hi, 3)})
        if mode == "center":
            return sorted(cs, key=lambda s: abs(s - edge.length / 2))
        if mode == "near" and near is not None:
            return sorted(cs, key=lambda s: abs(s - near))
        return sorted(cs, key=lambda s: min(s - lo, hi - s))  # ends first

    def _at_edge(self, edge: Edge, cid: str, s: float, soft: bool = False) -> Furniture | None:
        size = self._size(cid)
        rot = _front_rot(*edge.n)
        for k in range(int(_PUSH_MAX_M / _PUSH_STEP_M) + 1):
            off = size[1] / 2 + k * _PUSH_STEP_M
            pos = (edge.p[0] + edge.d[0] * s + edge.n[0] * off, edge.p[1] + edge.d[1] * s + edge.n[1] * off)
            f = self._try(cid, pos, rot, soft)
            if f is not None:
                return f
        return None

    def wall_item(self, cid: str, edges: list[Edge], mode: str = "ends") -> tuple[Furniture, Edge, float] | None:
        w = self._size(cid)[0]
        for e in edges:
            for s in self._centers(e, w, mode):
                f = self._at_edge(e, cid, s)
                if f is not None:
                    return self._commit(f), e, s
        return None

    def _edges_by(self, key) -> list[Edge]:
        return sorted(self.edges, key=key)

    def _free_first(self) -> list[Edge]:
        return self._edges_by(lambda e: (e.door, e.window, -e.length))

    def skip(self, item: str, reason: str) -> None:
        self.skipped.append({"item": item, "reason": reason})

    # -- templates ----------------------------------------------------------
    def bedroom(self, kind: str, extras: tuple[str, ...]) -> None:
        free = [e for e in self.edges if not e.openings]
        window = [e for e in self.edges if e.window and not e.door]
        double = kind == "double_bedroom"
        # (bed, candidate walls, accept added fit warnings, warning code)
        plan: list[tuple[str, list[Edge], bool, str | None]] = []
        passage = "furnish.bed_passage: the bed leaves less than 1.00 m beside it; the room is tight"
        nowin = "furnish.bed_wall: no wall without a window and a door fits the bed head; used another wall"
        beds = [BED_DOUBLE, BED_SINGLE] if double else [BED_SINGLE]
        for cid in beds:  # downgrade to a single bed when it fits cleanly and the double does not
            plan += [(cid, free, False, None)]
        for cid in beds:
            plan += [(cid, free, True, passage)]
        for cid in beds:
            plan += [(cid, window, False, nowin), (cid, list(self.edges), False, nowin)]
        for cid in beds:
            plan += [(cid, list(self.edges), True, nowin + "; " + passage)]
        bed = None
        for cid, tier, relaxed, code in plan:
            self.relaxed = relaxed
            got = self.wall_item(cid, sorted(tier, key=lambda e: -e.length), "center")
            self.relaxed = False
            if got is None:
                continue
            bed = got
            if double and cid == BED_SINGLE:
                self.warnings.append("furnish.bed_downgrade: the double bed does not fit this room; placed a single bed instead")
            if code:
                self.warnings.append(code)
            break
        if bed is None:
            self.skip("bed", "no wall has room for a bed that keeps the door and a 1.00 m passage clear")
            return
        self._base_warn = len(furniture_fit_warnings(self.scene))
        bf, edge, s = bed
        if "nightstands" in extras:
            half = bf.size_m[0] / 2 + 0.03
            ns_w = self._size(NIGHTSTAND)[0]
            sides = [-1.0, 1.0] if bf.catalog_id == BED_DOUBLE else [-1.0, 1.0]
            count = 0
            for sign in sides:
                f = self._at_edge(edge, NIGHTSTAND, s + sign * (half + ns_w / 2), soft=True)
                if f is not None:
                    self._commit(f)
                    count += 1
                    if bf.catalog_id != BED_DOUBLE:
                        break  # a single bed gets one
            if count == 0:
                self.skip("nightstands", "no space beside the bed")
        self._extras(extras, edge_used=edge)

    def _extras(self, extras: tuple[str, ...], edge_used: Edge | None = None) -> None:
        free = [e for e in self._free_first() if e is not edge_used] + ([edge_used] if edge_used else [])
        for name, cid in (("wardrobe", WARDROBE), ("desk", DESK), ("bookshelf", BOOKSHELF), ("crib", CRIB), ("armchair", ARMCHAIR)):
            if name not in extras:
                continue
            if name == "desk":
                self.desk()
                continue
            if self.wall_item(cid, free, "ends") is not None:
                continue
            self.relaxed = True
            tight = self.wall_item(cid, free, "ends")
            self.relaxed = False
            if tight is None:
                self.skip(name, "no free wall space that keeps door swings clear")
            else:
                self.warnings.append(f"furnish.tight: the {name} fits but leaves a passage under 1.00 m")

    def desk(self) -> None:
        by_window = self._edges_by(lambda e: (not e.window, e.door, -e.length))
        for e in by_window:
            near = e.window_s if e.window_s is not None else e.length / 2
            w = self._size(DESK)[0]
            for s in self._centers(e, w, "near", near):
                f = self._at_edge(e, DESK, s)
                if f is None:
                    continue
                self._commit(f)
                front = (e.n[0], e.n[1])
                off = f.size_m[1] / 2 + self._size(DESK_CHAIR)[1] / 2 + 0.05
                pos = (f.position[0] + front[0] * off, f.position[1] + front[1] * off)
                ch = self._try(DESK_CHAIR, pos, _front_rot(-front[0], -front[1]), soft=True)
                if ch is not None:
                    self._commit(ch)
                else:
                    self.skip("desk chair", "no space in front of the desk")
                return
        self.skip("desk", "no wall space for a desk")

    def study(self, extras: tuple[str, ...]) -> None:
        self.desk()
        self._extras(tuple(x for x in extras if x != "desk"))

    def living(self, extras: tuple[str, ...]) -> None:
        pair = None
        best = 0.0
        for a in self.edges:
            for b in self.edges:
                if a is b or a.n[0] * b.n[0] + a.n[1] * b.n[1] > -0.99:
                    continue
                dist = abs((b.p[0] - a.p[0]) * a.n[0] + (b.p[1] - a.p[1]) * a.n[1])
                if dist > best + 1e-9:
                    best, pair = dist, (a, b)
        if pair is None:
            got = self.wall_item(SOFA, self._free_first(), "center")
            if got is None:
                self.skip("sofa", "no wall space")
            if "tv" in extras:
                self.skip("tv unit", "no wall opposite the sofa")
            return
        a, b = pair
        tv_edge, sofa_edge = (a, b) if (a.openings, -a.length) <= (b.openings, -b.length) else (b, a)
        sofa = self.wall_item(SOFA, [sofa_edge], "center")
        if sofa is None:
            self.skip("sofa", "no space on the longest wall pair")
            return
        sf, _, s_sofa = sofa
        if "tv" in extras:
            if best < _MIN_LIVING_GAP_M:
                self.warnings.append("furnish.tight_living: the sofa and the TV are closer than 2.6 m")
            if self.wall_item(TV, [tv_edge], "center") is None:
                self.skip("tv unit", "no free span on the wall facing the sofa")
        if "coffee_table" in extras:
            sd = sf.size_m[1]
            cd = self._size(COFFEE)[1]
            off = sd + 0.45 + cd / 2
            pos = (sf.position[0] + sofa_edge.n[0] * (off - sd / 2), sf.position[1] + sofa_edge.n[1] * (off - sd / 2))
            ct = self._try(COFFEE, pos, sf.rotation_deg, soft=True)
            if ct is not None:
                self._commit(ct)
            else:
                self.skip("coffee table", "not enough space between the sofa and the TV")
        if "armchair" in extras:
            rest = [e for e in self._free_first() if e is not sofa_edge and e is not tv_edge]
            if self.wall_item(ARMCHAIR, rest or self._free_first(), "ends") is None:
                self.skip("armchair", "no space")

    def dining(self, extras: tuple[str, ...]) -> None:
        seats = self.occupants or 4
        table_id = TABLE6 if seats >= 5 else TABLE4
        tw, td, _ = self._size(table_id)
        c = Polygon(self.room.polygon).representative_point()
        minx, miny, maxx, maxy = Polygon(self.room.polygon).bounds
        grid = []
        x = minx
        while x <= maxx:
            y = miny
            while y <= maxy:
                grid.append((round(x, 3), round(y, 3)))
                y += _STEP_M
            x += _STEP_M
        grid.sort(key=lambda q: (math.hypot(q[0] - c.x, q[1] - c.y), q))
        want_chairs = "chairs" in extras
        counts = [seats] if not want_chairs else sorted({seats, 4, 2}, reverse=True)
        counts = [n for n in counts if n <= (6 if table_id == TABLE6 else 4) and n <= seats] or [min(seats, 4)]
        for n_chairs in counts:
            for q in grid:
                for rot in (0.0, 90.0):
                    t = self._try(table_id, q, rot, soft=True)
                    if t is None:
                        continue
                    chairs = self._chairs(t, n_chairs) if want_chairs else []
                    if want_chairs and len(chairs) < n_chairs:
                        continue
                    self._commit(t)
                    for ch in chairs:
                        self._commit(ch)
                    if n_chairs < seats:
                        self.warnings.append(f"furnish.fewer_chairs: only {n_chairs} chairs fit around the table")
                    return
        self.skip("dining table", "no free spot in the room for the table and its chairs")

    def _chairs(self, table: Furniture, count: int) -> list[Furniture]:
        r = math.radians(table.rotation_deg)
        u, v = (math.cos(r), math.sin(r)), (-math.sin(r), math.cos(r))
        tw, td, _ = table.size_m
        cw, cd, _ = self._size(DINING_CHAIR)
        long_side = tw >= 1.5
        slots: list[tuple[tuple[float, float], tuple[float, float]]] = []  # (offset dir vector, along-offset)
        for sv in (1.0, -1.0):
            along = (-tw / 4, tw / 4) if long_side else (0.0,)
            for a in along:
                slots.append((((v[0] * sv), (v[1] * sv)), (u[0] * a, u[1] * a)))
        for su in (1.0, -1.0):
            if long_side or True:
                slots.append((((u[0] * su), (u[1] * su)), (0.0, 0.0)))
        out: list[Furniture] = []
        scene_before = self.scene
        try:
            self.scene = self.scene.model_copy(update={"furniture": [*self.scene.furniture, table]})
            for dirv, shift in slots:
                if len(out) >= count:
                    break
                depth = (td if abs(dirv[0] * v[0] + dirv[1] * v[1]) > 0.5 else tw) / 2 + cd / 2 + 0.02
                pos = (table.position[0] + dirv[0] * depth + shift[0], table.position[1] + dirv[1] * depth + shift[1])
                ch = self._try(DINING_CHAIR, pos, _front_rot(-dirv[0], -dirv[1]), soft=True)
                if ch is not None:
                    out.append(ch)
                    self.scene = self.scene.model_copy(update={"furniture": [*self.scene.furniture, ch]})
        finally:
            self.scene = scene_before
        return out


def furnish(scene: Scene, a) -> tuple[list[Furniture], list[str], dict, list[str]]:
    """Returns (new furniture list, changed ids, data) for the executor."""
    if a.brief_kind not in KINDS:
        raise DesignError("tool.invalid_args", f"brief_kind must be one of {', '.join(KINDS)}")
    room = pick_room(scene, a.room_id or a.room, a.selected, {"double_bedroom": "bedroom", "single_bedroom": "bedroom", "kids_room": "bedroom", "study": "study", "living": "living", "dining": "dining", "living_dining": "living"}.get(a.brief_kind))
    base = scene
    removed: list[str] = []
    if a.replace:
        removed = [f.id for f in scene.furniture if f.room_id == room.id]
        base = scene.model_copy(update={"furniture": [f for f in scene.furniture if f.room_id != room.id]})
    extras = _DEFAULT_EXTRAS[a.brief_kind]
    skipped_names: list[str] = []
    if a.items is not None:
        norm = tuple(dict.fromkeys(i.strip().lower().replace(" ", "_").replace("-", "_") for i in a.items))
        known = tuple(i for i in norm if i in EXTRAS)
        skipped_names = [i for i in norm if i not in EXTRAS]
        extras = known
    fz = Furnisher(base, room, a.occupants)
    for name in skipped_names:
        fz.skip(name, f"unknown item; use one of {', '.join(EXTRAS)}")
    kind = a.brief_kind
    if kind in ("double_bedroom", "single_bedroom", "kids_room"):
        fz.bedroom(kind, extras)
    elif kind == "study":
        fz.study(extras)
    elif kind == "living":
        fz.living(extras)
    elif kind == "dining":
        fz.dining(extras)
    else:
        fz.living(tuple(x for x in extras if x != "chairs"))
        fz.dining(("chairs",) if "chairs" in extras else ())
    if not fz.placed:
        raise DesignError("furnish.nothing_fits", f"nothing fits in {room.name}: " + "; ".join(s["reason"] for s in fz.skipped))
    ids = {f.id for f in fz.placed}
    final = fz.scene.furniture
    return list(final), sorted(ids), {
        "room": room.id,
        "kind": kind,
        "replaced": removed,
        "placed": [
            {"id": f.id, "catalog_id": f.catalog_id, "position": list(f.position), "rotation_deg": f.rotation_deg}
            for f in fz.placed
        ],
        "skipped": fz.skipped,
        "warnings": fz.warnings,
    }, fz.warnings
