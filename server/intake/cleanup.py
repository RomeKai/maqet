"""Intake cleanup + scale (F2): normalized proposal -> measured ScaledPlan -> Scene.

Pure functions. Geometry lives in NORMALIZED image coords (0..1, y down)
until scale; ``ScaledPlan`` is meters with origin at the plan's bottom-left
(y up). Scale comes from ONE parsed anchor dimension; it is never invented
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

from server.scene.models import Opening as SceneOpening
from server.scene.models import Room as SceneRoom
from server.scene.models import Scene
from server.scene.models import Wall as SceneWall

# Normalized units (0..1). ~1e-6 of image width ~ 1px on a 1000px image.
TOL_DEFAULT = 1e-6
# Nominal fuse threshold is tol + 1e-9; the implementation allows 2e-9 so the
# exact-boundary case survives float64 noise in the 1D projection
# (measured 1.0010000000004737e-06 vs threshold 1.001e-06). The beyond case
# (tol + 1e-8) still does not fuse: 1.01e-06 > 1.002e-06.
_MERGE_EPS = 2e-9


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

    idx, meters = select_anchor(proposal.dimensions, anchor_index)
    anchor = proposal.dimensions[idx]
    anchor_px = _norm_len_px(*anchor.a, *anchor.b, image_w, image_h)
    if anchor_px <= 0:
        raise ScaleError(
            "La dimensión ancla tiene longitud cero en píxeles: pedí al humano "
            "que corrija la medida."
        )
    m_per_px = meters / anchor_px

    norm_walls: list[tuple[tuple[float, float], tuple[float, float], str | None]] = [
        ((w.a[0], w.a[1]), (w.b[0], w.b[1]), w.kind) for w in proposal.walls
    ]
    fused, members = _fuse_walls(norm_walls, tol)
    if any(norm_walls[k][2] is None for group in members for k in group):
        warnings.append("kind_defaulted: null kind -> exterior, confirmar con humano")
    old_to_new = {old: new for new, group in enumerate(members) for old in group}

    def to_meters(px: float, py: float) -> tuple[float, float]:
        return (px * image_w * m_per_px, (1.0 - py) * image_h * m_per_px)

    scaled_pts = [to_meters(*p) for wall in fused for p in (wall[0], wall[1])]
    min_x = min((p[0] for p in scaled_pts), default=0.0)
    min_y = min((p[1] for p in scaled_pts), default=0.0)

    def shift(p: tuple[float, float]) -> tuple[float, float]:
        return (p[0] - min_x, p[1] - min_y)

    walls = tuple(
        ScaledWall(a=shift(to_meters(*a)), b=shift(to_meters(*b)), kind=kind)
        for a, b, kind in fused
    )

    openings: list[ScaledOpening] = []
    for op in proposal.openings:
        new_idx = old_to_new[op.wall_index]
        wall = walls[new_idx]
        length = math.dist(wall.a, wall.b)
        openings.append(
            ScaledOpening(
                wall_index=new_idx,
                offset_m=op.t0 * length,
                width_m=(op.t1 - op.t0) * length,
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
    xs = [p for w in walls for p in (w.a[0], w.b[0])]
    ys = [p for w in walls for p in (w.a[1], w.b[1])]
    extent = max(max(xs) - min(xs), max(ys) - min(ys), 1e-12)
    snap_tol = TOL_DEFAULT * extent * 2 + 1e-9
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


def to_scene(plan: ScaledPlan, scene_id: str = "intake") -> Scene:
    """ScaledPlan -> measured Scene with documented construction defaults.

    Defaults (server/scene/rules.py): exterior 0.20 m, interior 0.10 m,
    ceiling 2.60 m; door height 2.05 m, window 1.40 m + sill 0.80 m.
    scale_confirmed=False: the anchor was picked automatically, the human
    confirms (ADR-002).
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
