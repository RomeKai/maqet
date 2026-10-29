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
from server.scene.validation import Finding, rooms_overlap_m2

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


def _drop_collinear(poly: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """Remove vertices lying on the segment between their neighbours (wall
    nodes polygonize adds), so shapes compare by geometry, not by vertex list."""
    pts = _normalize_ring(poly)
    changed = True
    while changed and len(pts) > 3:
        changed = False
        for i in range(len(pts)):
            prev, cur, nxt = pts[i - 1], pts[i], pts[(i + 1) % len(pts)]
            if _point_on_segment(cur[0], cur[1], prev[0], prev[1], nxt[0], nxt[1]):
                pts = pts[:i] + pts[i + 1 :]
                changed = True
                break
    return _normalize_ring(pts)


def _same_shape(a: list[tuple[float, float]], b: list[tuple[float, float]]) -> bool:
    return _drop_collinear(a) == _drop_collinear(b)


# --- polygonize -----------------------------------------------------------------


def _shapely_polygonize(walls: list) -> list[list[tuple[float, float]]]:
    from shapely.geometry import LineString
    from shapely.ops import polygonize, unary_union

    lines = [LineString([tuple(w.a), tuple(w.b)]) for w in walls]
    merged = unary_union(lines)
    result = polygonize(merged)
    # shapely 2.x yields a GeometrySequence; older builds a collection with .geoms.
    geoms = getattr(result, "geoms", result)
    polys: list[list[tuple[float, float]]] = []
    for geom in geoms:
        ring = [(float(x), float(y)) for x, y in geom.exterior.coords]
        norm = _normalize_ring(ring)
        if len(norm) >= 3 and abs(_ring_area(norm)) > _EPS:
            polys.append(norm)
    return polys


def _param_along(
    p: tuple[float, float], a: tuple[float, float], b: tuple[float, float]
) -> float:
    dx, dy = b[0] - a[0], b[1] - a[1]
    denom = dx * dx + dy * dy
    if denom == 0.0:
        return 0.0
    return ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / denom


def _segments_cross(
    p1: tuple[float, float],
    p2: tuple[float, float],
    p3: tuple[float, float],
    p4: tuple[float, float],
) -> list[tuple[float, float]]:
    """Single touch point of two non-parallel segments, else []. Collinear
    touches are left to point-on-segment tests in _node_segments."""
    d1x, d1y = p2[0] - p1[0], p2[1] - p1[1]
    d2x, d2y = p4[0] - p3[0], p4[1] - p3[1]
    cross = d1x * d2y - d1y * d2x
    if abs(cross) <= _EPS:
        return []
    ex, ey = p3[0] - p1[0], p3[1] - p1[1]
    t = (ex * d2y - ey * d2x) / cross
    u = (ex * d1y - ey * d1x) / cross
    if -_EPS <= t <= 1.0 + _EPS and -_EPS <= u <= 1.0 + _EPS:
        t = min(max(t, 0.0), 1.0)
        return [(p1[0] + t * d1x, p1[1] + t * d1y)]
    return []


def _node_segments(walls: list) -> list[tuple[tuple[float, float], tuple[float, float]]]:
    """Split wall segments at every crossing, T-touch and collinear overlap
    so the face walk sees shared nodes — a splitting wall whose endpoints
    land mid-edge must actually split the face."""
    segs: list[tuple[tuple[float, float], tuple[float, float]]] = []
    for w in walls:
        a = (float(w.a[0]), float(w.a[1]))
        b = (float(w.b[0]), float(w.b[1]))
        if a != b:
            segs.append((a, b))
    splits: list[set[float]] = [{0.0, 1.0} for _ in segs]
    for i in range(len(segs)):
        a, b = segs[i]
        for j in range(i + 1, len(segs)):
            c, d = segs[j]
            for pt in _segments_cross(a, b, c, d):
                if _point_on_segment(pt[0], pt[1], a[0], a[1], b[0], b[1]):
                    splits[i].add(_param_along(pt, a, b))
                if _point_on_segment(pt[0], pt[1], c[0], c[1], d[0], d[1]):
                    splits[j].add(_param_along(pt, c, d))
            for pt in (c, d):  # T-touches and collinear overlap endpoints
                if _point_on_segment(pt[0], pt[1], a[0], a[1], b[0], b[1]):
                    splits[i].add(_param_along(pt, a, b))
            for pt in (a, b):
                if _point_on_segment(pt[0], pt[1], c[0], c[1], d[0], d[1]):
                    splits[j].add(_param_along(pt, c, d))
    out: list[tuple[tuple[float, float], tuple[float, float]]] = []
    for (a, b), params in zip(segs, splits):
        pts = [
            (a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]))
            for t in sorted(params)
        ]
        for p, q in zip(pts, pts[1:]):
            kp = (round(p[0], 9), round(p[1], 9))
            kq = (round(q[0], 9), round(q[1], 9))
            if kp != kq:
                out.append((p, q))
    return out


def _fallback_polygonize(walls: list) -> list[list[tuple[float, float]]]:
    """Half-edge face walk on the noded wall segment graph. Best-effort:
    exact for closed rectangular layouts, empty on open graphs (every closed
    walk there backtracks, and backtrack spike faces are dropped)."""

    def key(p: tuple[float, float]) -> tuple[float, float]:
        return (round(float(p[0]), 9), round(float(p[1]), 9))

    adj: dict[tuple[float, float], dict[tuple[float, float], float]] = {}
    for a, b in _node_segments(walls):
        ka, kb = key(a), key(b)
        if ka == kb:
            continue
        for src, dst in ((ka, kb), (kb, ka)):
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
            closed = False
            while True:
                seen.add((frm, to))
                cycle.append(to)
                nxt = next_edge(frm, to)
                frm, to = to, nxt
                if frm == src:
                    closed = True
                    break
                if (frm, to) in seen:
                    break  # ran into an already-walked edge: not a new face
                if len(cycle) > len(adj) * 2 + 4:
                    break
            if not closed:
                continue
            body = cycle[:-1]  # closed: last point repeats src
            if len(set(body)) != len(body):
                continue  # backtrack spike revisits a vertex: not a face
            raw = [(float(x), float(y)) for x, y in body]
            # Bounded faces walk CCW (positive area); the unbounded outer face
            # walks CW. Check the sign before _normalize_ring forces CCW.
            if _ring_area(raw) <= _EPS:
                continue
            ring = _normalize_ring(raw)
            if len(ring) >= 3:
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
    except ImportError:
        polys = _fallback_polygonize(walls)
    return _sort_polys(polys)


# --- recompute ------------------------------------------------------------------


def recompute_rooms(
    old_rooms: list[Room],
    explicit_rooms: list[Room],
    derived_polys: list[list[tuple[float, float]]],
    surfaces: list[Surface],
    furniture: list[Furniture],
    old_derived_polys: list[list[tuple[float, float]]] | None = None,
) -> tuple[list[Room], list[Surface], list[Furniture], tuple[str, ...]]:
    """Match new polygons against rooms; survivors keep id/name + assignments.

    Candidate polygons = wall-derived + carried explicit room polygons
    (add_room has no walls yet). A room survives iff its id is still present
    and its old centroid falls inside a new polygon. Dead rooms drop their
    furniture/surfaces to ``unassigned`` with one warning per item, never
    reassigned silently. Unmatched derived polygons mint fresh ``rN`` rooms.

    Only wall-backed rooms (old polygon matches a polygon of the old walls)
    follow re-polygonization. A free-standing footprint (add_room without
    walls) keeps its own polygon unless walls now enclose exactly that shape;
    it is never killed because a walled room claimed the face under it.
    ``old_derived_polys=None`` treats every old room as wall-backed.
    Upper-level rooms (level > 1) sit above the walls: they pass through
    unchanged and never claim or mint a wall face.
    """
    upper = [r for r in explicit_rooms if r.level > 1]
    explicit_rooms = [r for r in explicit_rooms if r.level == 1]
    old_upper_ids = {r.id for r in old_rooms if r.level > 1}
    old_rooms = [r for r in old_rooms if r.level == 1]
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

    def wall_backed(r: Room) -> bool:
        if old_derived_polys is None:
            return True
        poly = [(float(x), float(y)) for x, y in r.polygon]
        return any(_same_shape(poly, d) for d in old_derived_polys)

    for room in explicit_rooms:
        old = old_by_id.get(room.id)
        if old is not None and not wall_backed(old):
            own = [(float(x), float(y)) for x, y in room.polygon]
            exact = next(
                (
                    i
                    for i, cand in enumerate(candidates)
                    if i not in claimed and _same_shape(own, cand)
                ),
                None,
            )
            if exact is not None:
                claimed.add(exact)
            new_rooms.append(room)
            continue
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
                    level=room.level,
                )
            )

    # Old rooms the op no longer carries are dead too (explicit list is
    # authoritative): their furniture/surfaces must drop to unassigned,
    # never silently follow a minted copy of the polygon.
    explicit_ids = {r.id for r in explicit_rooms} | {r.id for r in upper}
    for old_id in [*old_by_id, *sorted(old_upper_ids)]:
        if old_id not in explicit_ids and old_id not in dead_ids:
            dead_ids.append(old_id)
    new_rooms.extend(upper)

    taken = {r.id for r in new_rooms} | set(dead_ids)
    counter = len(taken) + 1
    kept = list(new_rooms)
    for i, cand in enumerate(candidates):
        if i in claimed:
            continue
        # A face under a kept room (e.g. one spanning two wall faces) is
        # that room's floor, not new space: minting it double-counts area.
        probe = Room(id="_probe", name="_probe", polygon=cand)
        if any(rooms_overlap_m2(probe, r) > 0.0 for r in kept):
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
