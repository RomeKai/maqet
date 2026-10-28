"""Intake cleanup + scale (F2): normalized proposal -> measured ScaledPlan -> Scene.

Pure functions. Geometry lives in NORMALIZED image coords (0..1, y down)
until scale; ``ScaledPlan`` is meters with origin at the plan's bottom-left
(y up). ADR-025 mode C: every wall with an associated written length
(``IntakeDimension.wall_index``) is scaled to that length directly; walls
without one keep the global anchor factor as an initial guess and stay
``estimated``. The global factor is never stored as truth -- each measured
wall carries its own ``measured_length_m``. Scale is never invented
(ADR-002): ambiguous or missing anchors raise ScaleError asking the human.

Epsilon convention: TOL_DEFAULT ~ 1e-6 in NORMALIZED units. Two endpoints
fuse when their distance is <= tol + _MERGE_EPS (2e-9 absorbs float64 noise
at the boundary; the test pins the tol + 1e-9 boundary case). Collinear walls
on the same support fuse when their 1D gap is <= tol + _MERGE_EPS.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from typing import Literal

from server.intake.solver import solve_vertices
from server.scene.models import Opening as SceneOpening
from server.scene.models import Room as SceneRoom
from server.scene.models import Scene
from server.scene.models import Wall as SceneWall

# Normalized units (0..1). ~1e-6 of image width ~ 1px on a 1000px image.
TOL_DEFAULT = 1e-6
# Endpoints within this normalized distance merge into ONE shared vertex
# (sketch corners miss by a few % of image width; the phone 3x8 case misses
# by ~0.042 diagonal). Used ONLY for vertex clustering and room-loop snap:
# _fuse_walls keeps TOL_DEFAULT so the epsilon boundary tests still pin the
# collinear-fuse behavior.
ENDPOINT_SNAP_TOL = 0.05
# Nominal fuse threshold is tol + 1e-9; the implementation allows 2e-9 so the
# exact-boundary case survives float64 noise in the 1D projection
# (measured 1.0010000000004737e-06 vs threshold 1.001e-06). The beyond case
# (tol + 1e-8) still does not fuse: 1.01e-06 > 1.002e-06.
_MERGE_EPS = 2e-9
# A dimension is parallel to a wall when their directions agree within this.
_PARALLEL_COS = 0.9659  # cos(15 deg): sketches wobble, walls do not bend
# A wall_index=null dimension joins a wall at most this far away (normalized
# units, ~15% of image width): further is a guess, and guesses are the
# human's job (ADR-002).
_NULL_ASSIGN_MAX_DIST = 0.15
# A dimension belongs to an opening span (not the wall) when their 1D overlap
# covers most of BOTH: a wall-length line crossing an opening is long, an
# opening label is short. One-sided overlap is not enough.
_OPENING_OVERLAP_MIN = 0.5


def _unit(dx: float, dy: float) -> tuple[float, float]:
    length = math.hypot(dx, dy)
    if length <= 0:
        return (1.0, 0.0)
    return (dx / length, dy / length)


def _overlap(lo0: float, hi0: float, lo1: float, hi1: float) -> float:
    return max(0.0, min(hi0, hi1) - max(lo0, lo1))


# Provenance a measured wall may carry when it comes out of intake (ADR-025).
MeasuredProvenance = Literal["measured_tape", "written_on_sketch"]


class ScaleError(ValueError):
    """No usable scale anchor: ask the human to correct or confirm a dimension."""


_DIM_RE = re.compile(
    r"(?P<num>\d+(?:[.,]\d+)?)\s*(?P<unit>m(?:etros?)?\b)?\s*(?P<total>total\b)?",
    re.IGNORECASE,
)


def parse_dimension_meters(text: str) -> float | None:
    """Parse a transcribed measurement ("3,50", "2.80 m", "6,00 total") to meters.

    Returns None when no number is found. Comma and point decimals both work.
    """
    if not text or not text.strip():
        return None
    match = _DIM_RE.search(text.strip().replace("_", " "))
    if match is None:
        return None
    try:
        return float(match.group("num").replace(",", "."))
    except ValueError:
        return None


def select_anchor(
    dimensions: object, anchor_index: int | None = None
) -> tuple[int, float]:
    """Pick the ONE scale anchor. Returns (dimension_index, meters).

    Preference: explicit anchor_index > text with "total" > text with "m" >
    bare number; ties break by longest pixel span. Nothing parseable ->
    ScaleError asking the human (ADR-002: the AI proposes, the human corrects).
    """
    from server.intake.schemas import IntakeDimension

    dims = list(dimensions)  # type: ignore[arg-type]
    if not dims:
        raise ScaleError(
            "No hay dimensiones escritas en el plano: pedí al humano que "
            "corrija o confirme una medida conocida (p. ej. '6,00 m')."
        )
    if anchor_index is not None:
        if not 0 <= anchor_index < len(dims):
            raise ScaleError(f"anchor_index {anchor_index} fuera de rango")
        dim = dims[anchor_index]
        value = parse_dimension_meters(dim.text)
        if value is None:
            raise ScaleError(
                "La dimensión elegida no tiene un número legible: pedí al "
                "humano que la corrija."
            )
        return anchor_index, value
    scored: list[tuple[int, int, float, float]] = []  # (rank, -span, idx, val)
    for i, dim in enumerate(dims):
        assert isinstance(dim, IntakeDimension)
        value = parse_dimension_meters(dim.text)
        if value is None:
            continue
        lowered = dim.text.lower()
        rank = 2 if "total" in lowered else (1 if "m" in lowered else 0)
        span = math.dist(dim.a, dim.b)
        scored.append((rank, span, i, value))
    if not scored:
        raise ScaleError(
            "Ninguna dimensión escrita es legible: pedí al humano que corrija "
            "o confirme una medida conocida."
        )
    scored.sort(key=lambda s: (s[0], s[1]), reverse=True)
    _, _, best_idx, best_val = scored[0]
    return best_idx, best_val


@dataclass(frozen=True)
class ScaledWall:
    a: tuple[float, float]
    b: tuple[float, float]
    kind: str  # "exterior" | "interior"
    # Written length in meters when a dimension annotates this wall
    # (ADR-025 mode C). None = estimated from the global guess.
    measured_m: float | None = None


@dataclass(frozen=True)
class ScaledOpening:
    wall_index: int
    offset_m: float
    width_m: float
    kind: str


@dataclass(frozen=True)
class ScaledRoom:
    polygon: tuple[tuple[float, float], ...]


@dataclass(frozen=True)
class ScaledPlan:
    """Measured plan, meters, origin bottom-left. scale_confirmed=False: auto anchor."""

    walls: tuple[ScaledWall, ...]
    openings: tuple[ScaledOpening, ...]
    rooms: tuple[ScaledRoom, ...] = ()
    warnings: tuple[str, ...] = ()
    scale_m_per_px: float = 1.0
    anchor_index: int = 0
    anchor_meters: float = 0.0
    width_m: float = 0.0
    height_m: float = 0.0


def _norm_len_px(ax: float, ay: float, bx: float, by: float, w: int, h: int) -> float:
    return math.hypot((bx - ax) * w, (by - ay) * h)


def _fuse_walls(
    walls: list[tuple[tuple[float, float], tuple[float, float], str | None]],
    tol: float,
) -> tuple[list[tuple[tuple[float, float], tuple[float, float], str]], list[list[int]]]:
    """Fuse collinear same-support walls whose 1D gap <= tol + _MERGE_EPS.

    Returns (fused walls with resolved kind, members per fused wall).
    Perpendicular or offset walls never fuse. Never invents segments:
    fused extent = union of inputs.
    """
    remaining = list(range(len(walls)))
    fused: list[tuple[tuple[float, float], tuple[float, float], str]] = []
    members: list[list[int]] = []
    while remaining:
        i = remaining.pop(0)
        (ax, ay), (bx, by), kind = walls[i]
        group = [i]
        dx, dy = bx - ax, by - ay
        seg_len = math.hypot(dx, dy)
        ux, uy = (dx / seg_len, dy / seg_len) if seg_len > 0 else (1.0, 0.0)
        t0, t1 = 0.0, seg_len
        kinds = [kind]
        changed = True
        while changed:
            changed = False
            for j in list(remaining):
                (cx, cy), (ex, ey), kkind = walls[j]
                # Same support: both endpoints within tol of the line.
                if (
                    abs((cx - ax) * uy - (cy - ay) * ux) > tol + _MERGE_EPS
                    or abs((ex - ax) * uy - (ey - ay) * ux) > tol + _MERGE_EPS
                ):
                    continue
                tc = (cx - ax) * ux + (cy - ay) * uy
                te = (ex - ax) * ux + (ey - ay) * uy
                lo, hi = min(tc, te), max(tc, te)
                cur_lo, cur_hi = min(t0, t1), max(t0, t1)
                gap = max(0.0, cur_lo - hi, lo - cur_hi)
                if gap > tol + _MERGE_EPS:
                    continue
                t0, t1 = min(cur_lo, lo), max(cur_hi, hi)
                group.append(j)
                kinds.append(kkind)
                remaining.remove(j)
                changed = True
        lo, hi = min(t0, t1), max(t0, t1)
        pa = (ax + ux * lo, ay + uy * lo)
        pb = (ax + ux * hi, ay + uy * hi)
        resolved = "exterior" if any(k in (None, "exterior") for k in kinds) else "interior"
        fused.append((pa, pb, resolved))
        members.append(sorted(group))
    return fused, members


def _cluster_vertices(
    fused: list[tuple[tuple[float, float], tuple[float, float], str]],
    tol: float,
    *,
    snap_tol: float = ENDPOINT_SNAP_TOL,
) -> tuple[list[tuple[float, float]], list[tuple[int, int]]] :
    """Shared endpoints within tol + _MERGE_EPS get one vertex id (union-find).

    ``snap_tol`` merges near-miss sketch corners (endpoint gap <= snap_tol)
    into one shared vertex BEFORE loop detection, so a hand-drawn loop whose
    last corner misses the first stays closed. Collinear fusion in
    ``_fuse_walls`` still uses ``tol`` only.
    """
    pts = [p for wall in fused for p in (wall[0], wall[1])]
    parent = list(range(len(pts)))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def _linked(i: int, j: int, limit: float) -> bool:
        return math.dist(pts[i], pts[j]) <= limit + _MERGE_EPS and find(i) != find(j)

    # Exact shares first (boundary behavior pinned by the epsilon tests).
    for i in range(len(pts)):
        for j in range(i + 1, len(pts)):
            if _linked(i, j, tol):
                parent[find(i)] = find(j)
    # Then snap near-miss sketch corners, chained transitively.
    for i in range(len(pts)):
        for j in range(i + 1, len(pts)):
            if _linked(i, j, snap_tol):
                parent[find(i)] = find(j)
    compact: dict[int, int] = {}
    verts: list[tuple[float, float]] = []
    vids: list[tuple[int, int]] = []
    for j in range(len(fused)):
        pair = []
        for k in (2 * j, 2 * j + 1):
            root = find(k)
            if root not in compact:
                members = [m for m in range(len(pts)) if find(m) == root]
                mx = sum(pts[m][0] for m in members) / len(members)
                my = sum(pts[m][1] for m in members) / len(members)
                compact[root] = len(verts)
                verts.append((mx, my))
            pair.append(compact[root])
        vids.append((pair[0], pair[1]))
    return verts, vids


def build_scaled_plan(
    proposal: object,
    image_w: int,
    image_h: int,
    *,
    tol: float = TOL_DEFAULT,
    anchor_index: int | None = None,
) -> ScaledPlan:
    """Cleanup + scale a proposal into meters. Pure; raises ScaleError, never invents."""
    from server.intake.schemas import IntakeProposal

    assert isinstance(proposal, IntakeProposal)
    warnings: list[str] = []

    norm_walls: list[tuple[tuple[float, float], tuple[float, float], str | None]] = [
        ((w.a[0], w.a[1]), (w.b[0], w.b[1]), w.kind) for w in proposal.walls
    ]
    fused, members = _fuse_walls(norm_walls, tol)
    if any(norm_walls[k][2] is None for group in members for k in group):
        warnings.append("kind_defaulted: null kind -> exterior, confirm with human")
    old_to_new = {old: new for new, group in enumerate(members) for old in group}

    # Anchor before measures: the anchor factor turns drawn lengths into
    # meters, so an opening label can be told apart from a wall measure by
    # MAGNITUDE (a 1.50 m label on an 8 m wall is the door, not the wall).
    # Global factor survives ONLY as the solver initial guess, never as
    # stored truth: measured walls override it during relaxation.
    idx, meters = select_anchor(proposal.dimensions, anchor_index)
    anchor = proposal.dimensions[idx]
    anchor_px = _norm_len_px(*anchor.a, *anchor.b, image_w, image_h)
    if anchor_px <= 0:
        raise ScaleError(
            "La dimensión ancla tiene longitud cero en píxeles: pedí al humano "
            "que corrija la medida."
        )
    m_per_px = meters / anchor_px

    # Per-wall measures: map each associated dimension (F1 wall_index in
    # pre-fuse proposal coords) onto its fused wall. Unparseable texts are
    # dropped with a warning; contradictions between several measures on the
    # same wall are flagged to the technician, never silently averaged.
    #
    # Two special cases before a dimension becomes a wall measure:
    # - an opening label: a dimension whose span sits on an opening span of
    #   the same wall AND whose value is much smaller than the wall (e.g.
    #   "1.50m" next to a door on an 8 m wall) is that opening's WIDTH, not
    #   the wall length. It must never fight the wall measure (the W2/W4
    #   bug: the opening label won the min() and the wall shrank to it).
    #   A wall-sized value overlapping an opening span is NOT a label: it
    #   stays a wall measure and any conflict goes through the loud path.
    # - a null wall_index: the model saw a length but no wall. Assign it to
    #   the nearest parallel wall; when nothing is parallel, warn loudly and
    #   drop it (never invent a wall for a number, ADR-002).
    opening_widths: dict[int, list[tuple[int, float]]] = {}  # new wall idx -> [(opening pos, m)]
    for pos, op in enumerate(proposal.openings):
        if 0 <= op.wall_index < len(proposal.walls):
            opening_widths.setdefault(old_to_new[op.wall_index], []).append((pos, op.t0, op.t1))
    opening_labels: dict[int, float] = {}  # opening pos -> width in meters

    def _assign_null(value: float, dim: object) -> int | None:
        dim_a = (dim.a[0], dim.a[1])  # type: ignore[attr-defined]
        dim_b = (dim.b[0], dim.b[1])  # type: ignore[attr-defined]
        dux, duy = _unit(dim_b[0] - dim_a[0], dim_b[1] - dim_a[1])
        best: int | None = None
        best_dist = _NULL_ASSIGN_MAX_DIST
        for j, ((ax, ay), (bx, by), _kind) in enumerate(fused):
            wux, wuy = _unit(bx - ax, by - ay)
            if abs(dux * wux + duy * wuy) < _PARALLEL_COS:
                continue
            mx, my = (dim_a[0] + dim_b[0]) / 2, (dim_a[1] + dim_b[1]) / 2
            dist = abs((mx - ax) * wuy - (my - ay) * wux)
            t = (mx - ax) * wux + (my - ay) * wuy
            seg_len = math.hypot(bx - ax, by - ay)
            if dist < best_dist and -0.1 * seg_len <= t <= 1.1 * seg_len:
                best, best_dist = j, dist
        return best

    wall_measures: dict[int, list[float]] = {}
    for dim in proposal.dimensions:
        value = parse_dimension_meters(dim.text)
        if value is None:
            continue
        new_idx: int | None
        if dim.wall_index is None:
            new_idx = _assign_null(value, dim)
            if new_idx is None:
                warnings.append(
                    f"unassigned: '{dim.text}' is parallel to no wall, "
                    "confirm with human"
                )
                continue
        elif dim.wall_index >= len(proposal.walls):
            continue
        else:
            new_idx = old_to_new[dim.wall_index]
        (ax, ay), (bx, by), _kind = fused[new_idx]
        seg_len = math.hypot(bx - ax, by - ay)
        if seg_len > 0 and new_idx in opening_widths:
            wux, wuy = (bx - ax) / seg_len, (by - ay) / seg_len
            lo = (dim.a[0] - ax) * wux + (dim.a[1] - ay) * wuy
            hi = (dim.b[0] - ax) * wux + (dim.b[1] - ay) * wuy
            lo, hi = min(lo, hi), max(lo, hi)
            dim_len = hi - lo
            # Wall-length guess from the anchor factor: a label naming the
            # opening is a fraction of it; a wall-sized value is not a label.
            wall_guess_m = seg_len * image_w * m_per_px
            if value < 0.9 * wall_guess_m:
                for pos, t0, t1 in opening_widths[new_idx]:
                    o_lo, o_hi = t0 * seg_len, t1 * seg_len
                    o_len = o_hi - o_lo
                    inter = _overlap(lo, hi, o_lo, o_hi)
                    if (
                        dim_len > 0
                        and o_len > 0
                        and inter / dim_len >= _OPENING_OVERLAP_MIN
                        and inter / o_len >= _OPENING_OVERLAP_MIN
                    ):
                        opening_labels[pos] = value
                        warnings.append(
                            f"opening: wall {new_idx} "
                            f"{proposal.openings[pos].kind} width {value:.2f} m "
                            "from written label, verify with human"
                        )
                        new_idx = None
                        break
        if new_idx is None:
            continue
        wall_measures.setdefault(new_idx, []).append(value)

    def _opposite_parallel_wall(new_idx: int) -> int | None:
        (ax, ay), (bx, by), _kind = fused[new_idx]
        wux, wuy = _unit(bx - ax, by - ay)
        cx, cy = (ax + bx) / 2, (ay + by) / 2
        best: int | None = None
        best_cross = 0.0
        for j, ((jx0, jy0), (jx1, jy1), _k) in enumerate(fused):
            if j == new_idx:
                continue
            jux, juy = _unit(jx1 - jx0, jy1 - jy0)
            if abs(wux * jux + wuy * juy) < _PARALLEL_COS:
                continue
            cross = abs((jx0 - cx) * wuy - (jy0 - cy) * wux)
            if cross > best_cross:
                best, best_cross = j, cross
        return best

    targets_m: dict[int, float] = {}
    for new_idx, values in wall_measures.items():
        if len(values) == 1:
            targets_m[new_idx] = values[0]
            continue
        lo, hi = min(values), max(values)
        if hi - lo <= max(0.02, 0.02 * lo):
            targets_m[new_idx] = sum(values) / len(values)
            continue
        # Genuine conflict: side with the opposite parallel wall when one
        # value agrees with it; otherwise set NO target (the wall stays
        # estimated for the human) and carry both values in the warning.
        opp = _opposite_parallel_wall(new_idx)
        opp_vals = wall_measures.get(opp, []) if opp is not None else []
        picked: float | None = None
        for candidate in (lo, hi):
            if any(
                abs(candidate - o) <= max(0.02, 0.02 * candidate)
                for o in opp_vals
            ):
                picked = candidate
                break
        if picked is not None:
            targets_m[new_idx] = picked
            warnings.append(
                f"contradiction: wall {new_idx} has conflicting measures "
                f"{lo:.2f} m vs {hi:.2f} m, keeping {picked:.2f} m "
                f"(matches opposite wall {opp}), verify with human"
            )
        else:
            warnings.append(
                f"contradiction: wall {new_idx} has conflicting measures "
                f"{lo:.2f} m vs {hi:.2f} m, leaving unmeasured, verify with human"
            )

    verts_norm, wall_vids = _cluster_vertices(fused, tol)
    verts_guess = [
        (px * image_w * m_per_px, (1.0 - py) * image_h * m_per_px)
        for px, py in verts_norm
    ]
    solved = solve_vertices(verts_guess, wall_vids, targets_m, warnings)
    min_x = min((p[0] for p in solved), default=0.0)
    min_y = min((p[1] for p in solved), default=0.0)

    def shift(p: tuple[float, float]) -> tuple[float, float]:
        return (p[0] - min_x, p[1] - min_y)

    walls = tuple(
        ScaledWall(
            a=shift(solved[u]),
            b=shift(solved[v]),
            kind=kind,
            measured_m=targets_m.get(j),
        )
        for j, ((u, v), (_, _, kind)) in enumerate(zip(wall_vids, fused))
    )
    estimated = [str(j) for j, w in enumerate(walls) if w.measured_m is None]
    if estimated:
        warnings.append(
            f"estimated: walls {', '.join(estimated)} have no written length, "
            "confirm with human"
        )

    openings: list[ScaledOpening] = []
    for pos, op in enumerate(proposal.openings):
        new_idx = old_to_new[op.wall_index]
        wall = walls[new_idx]
        length = math.dist(wall.a, wall.b)
        width = opening_labels.get(pos, (op.t1 - op.t0) * length)
        openings.append(
            ScaledOpening(
                wall_index=new_idx,
                offset_m=op.t0 * length,
                width_m=width,
                kind=op.kind,
            )
        )

    rooms = _polygonize_rooms(walls, warnings)

    return ScaledPlan(
        walls=walls,
        openings=tuple(openings),
        rooms=rooms,
        warnings=tuple(warnings),
        scale_m_per_px=m_per_px,
        anchor_index=idx,
        anchor_meters=meters,
        width_m=image_w * m_per_px,
        height_m=image_h * m_per_px,
    )


def _polygonize_rooms(
    walls: tuple[ScaledWall, ...], warnings: list[str]
) -> tuple[ScaledRoom, ...]:
    """Rooms from closed wall loops (shapely polygonize). Open loops -> () + warning."""
    if len(walls) < 3:
        warnings.append("rooms_empty: no closed loop found, verify walls with human")
        return ()
    try:
        from shapely.geometry import LineString
        from shapely.ops import polygonize, snap
    except ImportError:  # pragma: no cover
        warnings.append("rooms_empty: shapely unavailable")
        return ()
    lines = [LineString([w.a, w.b]) for w in walls]
    # Close loops by snapping endpoints within tolerance: tolerance is in
    # normalized units, walls are in meters, so convert via wall extent.
    # Matches the ENDPOINT_SNAP_TOL vertex clustering above so a snapped loop
    # also polygonizes.
    xs = [p for w in walls for p in (w.a[0], w.b[0])]
    ys = [p for w in walls for p in (w.a[1], w.b[1])]
    extent = max(max(xs) - min(xs), max(ys) - min(ys), 1e-12)
    snap_tol = ENDPOINT_SNAP_TOL * extent + 1e-9
    merged = lines[0]
    for line in lines[1:]:
        merged = snap(merged.union(line), merged, snap_tol)
    polys = [p for p in polygonize(merged) if p.area > 0]
    if not polys:
        warnings.append("rooms_empty: no closed loop found, verify walls with human")
        return ()
    return tuple(
        ScaledRoom(polygon=tuple((float(x), float(y)) for x, y in p.exterior.coords))
        for p in polys
    )


def to_scene(
    plan: ScaledPlan,
    scene_id: str = "intake",
    measured_provenance: MeasuredProvenance = "written_on_sketch",
) -> Scene:
    """ScaledPlan -> measured Scene with documented construction defaults.

    Defaults (server/scene/rules.py): exterior 0.20 m, interior 0.10 m,
    ceiling 2.60 m; door height 2.05 m, window 1.40 m + sill 0.80 m.
    scale_confirmed=False: the anchor was picked automatically, the human
    confirms (ADR-002). Per-wall provenance: measured walls carry
    ``measured_provenance`` (mode C ``written_on_sketch`` by default; mode B
    passes ``measured_tape``) + measured_length_m, the rest stay estimated.
    """
    from server.scene import rules

    walls = tuple(
        SceneWall(
            id=f"w{i}",
            a=[w.a[0], w.a[1]],
            b=[w.b[0], w.b[1]],
            thickness_m=(
                rules.EXTERIOR_WALL_THICKNESS_M
                if w.kind == "exterior"
                else rules.INTERIOR_WALL_THICKNESS_M
            ),
            kind=w.kind,  # type: ignore[arg-type]
            provenance=(
                measured_provenance if w.measured_m is not None else "estimated"
            ),
            measured_length_m=w.measured_m,
        )
        for i, w in enumerate(plan.walls)
    )
    openings = tuple(
        SceneOpening(
            id=f"o{i}",
            wall_id=f"w{op.wall_index}",
            kind=op.kind,  # type: ignore[arg-type]
            offset_m=op.offset_m,
            width_m=op.width_m,
            height_m=2.05 if op.kind == "door" else 1.40,
            **({} if op.kind == "door" else {"sill_m": 0.80}),
        )
        for i, op in enumerate(plan.openings)
    )
    rooms = tuple(
        SceneRoom(
            id=f"r{i}",
            name=f"room-{i + 1}",
            polygon=[[x, y] for x, y in room.polygon],
        )
        for i, room in enumerate(plan.rooms)
    )
    return Scene(
        id=scene_id,
        units="m",
        scale_confirmed=False,
        ceiling_height_m=rules.DEFAULT_CEILING_HEIGHT_M,
        walls=list(walls),
        openings=list(openings),
        rooms=list(rooms),
    )


__all__ = [
    "ENDPOINT_SNAP_TOL",
    "TOL_DEFAULT",
    "ScaleError",
    "ScaledOpening",
    "ScaledPlan",
    "ScaledRoom",
    "ScaledWall",
    "build_scaled_plan",
    "parse_dimension_meters",
    "select_anchor",
    "to_scene",
]
