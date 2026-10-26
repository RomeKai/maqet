"""Intake metrics (F3): compare a fixture proposal against ground truth.

Formula (documented, simple, deterministic):
- segment_overlap_iou: project every wall segment of both sets onto shared
  supports; matched = total length where both cover the same support within
  tolerance; iou = matched / (len_a + len_b - matched). Split walls score 1.0.
- bbox_iou: classic intersection-over-union of bounding boxes.
"""

from __future__ import annotations

import math
from collections.abc import Sequence

from shapely.geometry import Polygon
from shapely.ops import unary_union

_COLLINEAR_TOL = 1e-9


def _segments_on_support(
    segments: list[tuple[tuple[float, float], tuple[float, float]]],
) -> dict[tuple[float, float, float], list[tuple[float, float]]]:
    """Group 1D intervals by quantized support line (nx, ny, c)."""
    groups: dict[tuple[float, float, float], list[tuple[float, float]]] = {}
    for (ax, ay), (bx, by) in segments:
        dx, dy = bx - ax, by - ay
        length = math.hypot(dx, dy)
        if length <= 0:
            continue
        nx, ny = -dy / length, dx / length  # unit normal
        if nx < 0 or (nx == 0 and ny < 0):
            nx, ny = -nx, -ny
        c = nx * ax + ny * ay
        ux, uy = dx / length, dy / length
        key = (round(nx, 9), round(ny, 9), round(c, 9))
        t0 = round(ux * ax + uy * ay, 9)
        t1 = round(ux * bx + uy * by, 9)
        groups.setdefault(key, []).append((min(t0, t1), max(t0, t1)))
    return groups


def _interval_union_length(intervals: list[tuple[float, float]]) -> float:
    total = 0.0
    cur_lo: float | None = None
    cur_hi: float | None = None
    for lo, hi in sorted(intervals):
        if cur_lo is None:
            cur_lo, cur_hi = lo, hi
        elif lo <= cur_hi + _COLLINEAR_TOL:  # type: ignore[operator]
            cur_hi = max(cur_hi, hi)  # type: ignore[arg-type]
        else:
            total += cur_hi - cur_lo  # type: ignore[operator]
            cur_lo, cur_hi = lo, hi
    if cur_lo is not None:
        total += cur_hi - cur_lo  # type: ignore[operator]
    return total


def _interval_intersection_length(
    a: list[tuple[float, float]], b: list[tuple[float, float]]
) -> float:
    total = 0.0
    for alo, ahi in a:
        for blo, bhi in b:
            total += max(0.0, min(ahi, bhi) - max(alo, blo))
    return total


Point = tuple[float, float]
Segment = tuple[Point, Point]


def _total_length(segments: Sequence[Segment]) -> float:
    return sum(math.dist(a, b) for a, b in segments)


def wall_length_ratio(
    fixture_walls_m: Sequence[Segment], truth_walls_m: Sequence[Segment]
) -> float:
    """Total fixture wall length / total truth wall length.

    Diagnoses the bbox_iou (~0.79) vs segment_iou (~0.0) gap on photos:
    photos keep the frame (good bbox) but walls land off-support
    (bad segment overlap). Ratio ~1 means the right amount of wall was
    drawn, just in the wrong place. Guards div-by-zero: empty truth -> 0.0.
    """
    truth_total = _total_length(truth_walls_m)
    if truth_total <= 0:
        return 0.0
    return _total_length(fixture_walls_m) / truth_total


def rooms_area_iou(
    fixture_polys: Sequence[Sequence[Point]], truth_polys: Sequence[Sequence[Point]]
) -> dict[str, float]:
    """Surface IoU over room polygons in meters (polygonize-independent).

    Union/intersection of Polygon sets via shapely; only measured polygons,
    never invented. Empty/empty -> iou 1.0; one empty -> 0.0.
    Returns {"iou", "inter_m2", "fixture_m2", "truth_m2"}.
    """
    fixture_area = sum(Polygon(p).area for p in fixture_polys)
    truth_area = sum(Polygon(p).area for p in truth_polys)
    if not fixture_polys and not truth_polys:
        return {"iou": 1.0, "inter_m2": 0.0, "fixture_m2": 0.0, "truth_m2": 0.0}
    if not fixture_polys or not truth_polys:
        return {
            "iou": 0.0,
            "inter_m2": 0.0,
            "fixture_m2": fixture_area,
            "truth_m2": truth_area,
        }
    fixture_u = unary_union([Polygon(p) for p in fixture_polys])
    truth_u = unary_union([Polygon(p) for p in truth_polys])
    inter = fixture_u.intersection(truth_u).area
    union = fixture_u.union(truth_u).area
    return {
        "iou": (inter / union) if union > 0 else 0.0,
        "inter_m2": inter,
        "fixture_m2": fixture_u.area,
        "truth_m2": truth_u.area,
    }


__all__ = ["bbox_iou", "rooms_area_iou", "segment_overlap_iou", "wall_length_ratio"]


def segment_overlap_iou(
    a: list[tuple[tuple[float, float], tuple[float, float]]],
    b: list[tuple[tuple[float, float], tuple[float, float]]],
) -> dict[str, float]:
    """IoU over coincident wall length. Returns {"iou", "matched", "total_a", "total_b"}."""
    total_a, total_b = _total_length(a), _total_length(b)
    if total_a == 0 and total_b == 0:
        return {"iou": 1.0, "matched": 0.0, "total_a": 0.0, "total_b": 0.0}
    ga, gb = _segments_on_support(a), _segments_on_support(b)
    matched = sum(
        _interval_intersection_length(ga[k], gb[k]) for k in ga.keys() & gb.keys()
    )
    denom = total_a + total_b - matched
    return {
        "iou": (matched / denom) if denom > 0 else 0.0,
        "matched": matched,
        "total_a": total_a,
        "total_b": total_b,
    }


def bbox_iou(
    a: tuple[float, float, float, float], b: tuple[float, float, float, float]
) -> float:
    """Classic box IoU over (minx, miny, maxx, maxy)."""
    ix0, iy0 = max(a[0], b[0]), max(a[1], b[1])
    ix1, iy1 = min(a[2], b[2]), min(a[3], b[3])
    inter = max(0.0, ix1 - ix0) * max(0.0, iy1 - iy0)
    area_a = max(0.0, a[2] - a[0]) * max(0.0, a[3] - a[1])
    area_b = max(0.0, b[2] - b[0]) * max(0.0, b[3] - b[1])
    denom = area_a + area_b - inter
    return inter / denom if denom > 0 else 0.0
