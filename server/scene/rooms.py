"""Room re-polygonization (ADR-001/002): derived rooms after every Reform op.

Pure functions. ``repolygonize`` turns wall segments into room polygons with
shapely when importable, else a pure-python face-walk fallback so
``MME_MODE=replay`` never needs network. ``recompute_rooms`` matches the new
polygons against the existing rooms (same id + old centroid inside the new
polygon survives, per human decision), carries explicit add_room polygons,
unassigns dead rooms' furniture/surfaces with a warning, and mints fresh ids
for genuinely new wall-derived polygons. ``check_furniture`` blocks an op
(scene unchanged) when a footprint sits outside its room or overlaps another.
"""

from __future__ import annotations

import math

from server.scene.models import Furniture, Room, Surface
from server.scene.validation import Finding

UNASSIGNED_ROOM_ID = "unassigned"

CODE_FURNITURE_OUTSIDE = "furniture.outside_room"
CODE_FURNITURE_OVERLAP = "furniture.overlap"

_EPS = 1e-9


# --- geometry helpers (pure python, no shapely) --------------------------------


def _ring_area(poly: list[tuple[float, float]]) -> float:
    area = 0.0
    n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        area += x1 * y2 - x2 * y1
    return area / 2.0


def _centroid(poly: list[tuple[float, float]]) -> tuple[float, float]:
    xs = [p[0] for p in poly]
    ys = [p[1] for p in poly]
    return (sum(xs) / len(xs), sum(ys) / len(ys))


def _point_on_segment(
    px: float, py: float, ax: float, ay: float, bx: float, by: float
) -> bool:
    cross = (bx - ax) * (py - ay) - (by - ay) * (px - ax)
    if abs(cross) > _EPS:
        return False
    dot = (px - ax) * (px - bx) + (py - ay) * (py - by)
    return dot <= _EPS


def _point_in_poly(px: float, py: float, poly: list[tuple[float, float]]) -> bool:
    n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        if _point_on_segment(px, py, x1, y1, x2, y2):
            return True
    inside = False
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        if (y1 > py) != (y2 > py) and px < (x2 - x1) * (py - y1) / (y2 - y1 + 1e-12) + x1:
            inside = not inside
    return inside


def _normalize_ring(poly: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """CCW ring, no closing duplicate, rotated to the lexicographically
    smallest point. Deterministic so replay is deterministic."""
    pts = [(float(x), float(y)) for x, y in poly]
    if len(pts) > 1 and pts[0] == pts[-1]:
        pts = pts[:-1]
    cleaned: list[tuple[float, float]] = []
    for p in pts:
        if not cleaned or cleaned[-1] != p:
            cleaned.append(p)
    if len(cleaned) < 3:
        return cleaned
    if _ring_area(cleaned) < 0:
        cleaned = cleaned[::-1]
    start = min(range(len(cleaned)), key=lambda i: cleaned[i])
    return cleaned[start:] + cleaned[:start]


def _rings_equal(a: list[tuple[float, float]], b: list[tuple[float, float]]) -> bool:
    return _normalize_ring(a) == _normalize_ring(b)


# --- polygonize -----------------------------------------------------------------


def _shapely_polygonize(walls: list) -> list[list[tuple[float, float]]]:
    from shapely.geometry import LineString
    from shapely.ops import polygonize, unary_union

    lines = [LineString([tuple(w.a), tuple(w.b)]) for w in walls]
    merged = unary_union(lines)
    polys: list[list[tuple[float, float]]] = []
    for geom in polygonize(merged).geoms:
        ring = [(float(x), float(y)) for x, y in geom.exterior.coords]
        norm = _normalize_ring(ring)
        if len(norm) >= 3 and abs(_ring_area(norm)) > _EPS:
            polys.append(norm)
    return polys


def _fallback_polygonize(walls: list) -> list[list[tuple[float, float]]]:
    """Half-edge face walk on the wall segment graph. Best-effort: exact for
    closed rectangular layouts, may miss faces on open graphs."""

    def key(p: tuple[float, float]) -> tuple[float, float]:
        return (round(float(p[0]), 9), round(float(p[1]), 9))

    adj: dict[tuple[float, float], dict[tuple[float, float], float]] = {}
    for w in walls:
        a, b = key(tuple(w.a)), key(tuple(w.b))
        if a == b:
            continue
        for src, dst in ((a, b), (b, a)):
            angle = math.atan2(dst[1] - src[1], dst[0] - src[0])
            adj.setdefault(src, {})[dst] = angle

    def next_edge(frm: tuple[float, float], to: tuple[float, float]) -> tuple[float, float]:
        options = adj.get(to, {})
        if not options:
            return frm
        back = math.atan2(frm[1] - to[1], frm[0] - to[0])
        # Next edge clockwise from the reverse edge (keeps the face on the left).
        cands = sorted(options.items(), key=lambda kv: kv[1], reverse=True)
        for dst, _ in cands:
            if dst != frm:
                first_non_back = dst
                break
        else:
            return frm
        # Find the candidate right after `back` in clockwise order.
        ordered = [dst for dst, _ in cands]
        angles = [options[d] for d in ordered]
        best: tuple[float, float] | None = None
        best_turn = math.inf
        for dst, ang in zip(ordered, angles):
            if dst == frm and len(ordered) > 1:
                continue
            turn = (back - ang) % (2.0 * math.pi)
            if turn < best_turn:
                best_turn = turn
                best = dst
        return best if best is not None else first_non_back

    seen: set[tuple[tuple[float, float], tuple[float, float]]] = set()
    faces: list[list[tuple[float, float]]] = []
    for src, outs in adj.items():
        for dst in outs:
            if (src, dst) in seen:
                continue
            cycle = [src]
            frm, to = src, dst
            while True:
                seen.add((frm, to))
                cycle.append(to)
                nxt = next_edge(frm, to)
                frm, to = to, nxt
                if (frm, to) in seen or frm == src:
                    if frm == src:
                        seen.add((frm, to))
                    break
                if len(cycle) > len(adj) * 2 + 4:
                    break
            ring = _normalize_ring([(float(x), float(y)) for x, y in cycle])
            if len(ring) >= 3 and _ring_area(ring) > _EPS:
                faces.append(ring)
    # Dedupe identical rings.
    unique: list[list[tuple[float, float]]] = []
    for face in faces:
        if not any(_rings_equal(face, other) for other in unique):
            unique.append(face)
    return unique


def _sort_polys(polys: list[list[tuple[float, float]]]) -> list[list[tuple[float, float]]]:
    return sorted(polys, key=lambda p: (-abs(_ring_area(p)), _centroid(p)))


def repolygonize(walls: list) -> list[list[tuple[float, float]]]:
    """Wall segments -> room polygons, deterministically ordered (area desc,
    then centroid). Shapely when importable, pure-python fallback otherwise."""
    try:
        polys = _shapely_polygonize(walls)
    except Exception:
        polys = _fallback_polygonize(walls)
    return _sort_polys(polys)


# --- recompute ------------------------------------------------------------------


def recompute_rooms(
    old_rooms: list[Room],
    explicit_rooms: list[Room],
    derived_polys: list[list[tuple[float, float]]],
    surfaces: list[Surface],
    furniture: list[Furniture],
) -> tuple[list[Room], list[Surface], list[Furniture], tuple[str, ...]]:
    """Match new polygons against rooms; survivors keep id/name + assignments.

    Candidate polygons = wall-derived + carried explicit room polygons
    (add_room has no walls yet). A room survives iff its id is still present
    and its old centroid falls inside a new polygon. Dead rooms drop their
    furniture/surfaces to ``unassigned`` with one warning per item, never
    reassigned silently. Unmatched derived polygons mint fresh ``rN`` rooms.
    """
    candidates: list[list[tuple[float, float]]] = []
    for poly in derived_polys:
        norm = _normalize_ring([tuple(p) for p in poly])
        if len(norm) >= 3 and not any(_rings_equal(norm, c) for c in candidates):
            candidates.append(norm)
    old_by_id = {r.id: r for r in old_rooms}
    for room in explicit_rooms:
        # Carry the explicit polygon only if wall-derived geometry does not
        # already cover its centroid: a stale polygon must die so a new wall
        # actually splits the room, while a genuinely new add_room polygon
        # (no walls yet) is kept.
        anchor = (
            list(old_by_id[room.id].polygon)
            if room.id in old_by_id
            else list(room.polygon)
        )
        cx, cy = _centroid([(float(x), float(y)) for x, y in anchor])
        if any(_point_in_poly(cx, cy, c) for c in candidates):
            continue
        norm = _normalize_ring([tuple(p) for p in room.polygon])
        if len(norm) >= 3 and not any(_rings_equal(norm, c) for c in candidates):
            candidates.append(norm)

    claimed: set[int] = set()
    new_rooms: list[Room] = []
    dead_ids: list[str] = []

    for room in explicit_rooms:
        old = old_by_id.get(room.id)
        anchor = list(old.polygon) if old is not None else list(room.polygon)
        cx, cy = _centroid([(float(x), float(y)) for x, y in anchor])
        hit: int | None = None
        for i, cand in enumerate(candidates):
            if i in claimed:
                continue
            if _point_in_poly(cx, cy, cand):
                hit = i
                break
        if hit is None:
            if old is not None:
                dead_ids.append(room.id)
            else:
                # Genuinely new room with no usable candidate (e.g.
                # degenerate polygon): keep it as given so add_room never
                # silently drops; validation decides.
                new_rooms.append(room)
            continue
        claimed.add(hit)
        new_poly = candidates[hit]
        if old is not None and _rings_equal(list(old.polygon), new_poly):
            new_rooms.append(old)
        else:
            new_rooms.append(
                Room(
                    id=room.id,
                    name=room.name,
                    polygon=new_poly,
                    function=room.function,
                )
            )

    # Old rooms the op no longer carries are dead too (explicit list is
    # authoritative): their furniture/surfaces must drop to unassigned,
    # never silently follow a minted copy of the polygon.
    explicit_ids = {r.id for r in explicit_rooms}
    for old_id in old_by_id:
        if old_id not in explicit_ids and old_id not in dead_ids:
            dead_ids.append(old_id)

    taken = {r.id for r in new_rooms} | set(dead_ids)
    counter = len(taken) + 1
    for i, cand in enumerate(candidates):
        if i in claimed:
            continue
        while f"r{counter}" in taken:
            counter += 1
        rid = f"r{counter}"
        taken.add(rid)
        counter += 1
        new_rooms.append(Room(id=rid, name=f"Room {rid}", polygon=cand))

    warnings: list[str] = []
    new_surfaces: list[Surface] = []
    for s in surfaces:
        rid = s.target.room_id if s.target.type == "room" else None
        if rid is not None and rid in dead_ids:
            new_surfaces.append(
                s.model_copy(
                    update={
                        "target": s.target.model_copy(
                            update={"room_id": UNASSIGNED_ROOM_ID}
                        )
                    }
                )
            )
            warnings.append(
                f"surface {s.id} moved to unassigned: room {rid} no longer exists"
            )
        else:
            new_surfaces.append(s)

    new_furniture: list[Furniture] = []
    for f in furniture:
        if f.room_id in dead_ids:
            new_furniture.append(f.model_copy(update={"room_id": UNASSIGNED_ROOM_ID}))
            warnings.append(
                f"furniture {f.id} moved to unassigned: room {f.room_id} no longer exists"
            )
        else:
            new_furniture.append(f)

    return new_rooms, new_surfaces, new_furniture, tuple(warnings)


# --- furniture placement ---------------------------------------------------------


def _footprint(f: Furniture) -> tuple[float, float, float, float]:
    w, d, _h = f.size_m
    cx, cy = f.position
    return (cx - w / 2.0, cy - d / 2.0, cx + w / 2.0, cy + d / 2.0)


def check_furniture(scene) -> tuple[tuple[str, ...], tuple[str, ...]]:
    """Errors block the op (scene unchanged); door clearance stays a warning
    from validate_scene and is not duplicated here."""
    errors: list[str] = []
    rooms = {r.id: r for r in scene.rooms}
    boxes: list[tuple[str, tuple[float, float, float, float]]] = []
    for f in scene.furniture:
        if f.room_id == UNASSIGNED_ROOM_ID:
            continue
        room = rooms.get(f.room_id)
        if room is None:
            continue
        poly = [(float(x), float(y)) for x, y in room.polygon]
        min_x, min_y, max_x, max_y = _footprint(f)
        corners = [(min_x, min_y), (min_x, max_y), (max_x, min_y), (max_x, max_y)]
        if not all(_point_in_poly(x, y, poly) for x, y in corners):
            errors.append(
                str(
                    Finding(
                        f"furniture {f.id} footprint outside room {room.id}",
                        CODE_FURNITURE_OUTSIDE,
                        {"furniture_id": f.id, "room_id": room.id},
                    )
                )
            )
        boxes.append((f.id, (min_x, min_y, max_x, max_y)))
    for i in range(len(boxes)):
        for j in range(i + 1, len(boxes)):
            id_a, (ax1, ay1, ax2, ay2) = boxes[i]
            id_b, (bx1, by1, bx2, by2) = boxes[j]
            if not (ax2 <= bx1 + _EPS or bx2 <= ax1 + _EPS or ay2 <= by1 + _EPS or by2 <= ay1 + _EPS):
                errors.append(
                    str(
                        Finding(
                            f"furniture {id_a} footprint overlaps {id_b}",
                            CODE_FURNITURE_OVERLAP,
                            {"furniture_id": id_a, "other_id": id_b},
                        )
                    )
                )
    return tuple(errors), ()
