"""Per-wall vertex solver (ADR-025): shared by capture modes B and C.

Pure geometry in meters. Each measured wall is a length constraint on two
shared vertices; walls without a measurement are never forced and stay
``estimated``. Contradictory measures are flagged to the technician and never
silently averaged (ADR-002). Mode B (tapped lengths) and mode C (written
lengths) both enter through ``solve_vertices``; do not fork this logic.
"""

from __future__ import annotations

import math

MAX_SWEEPS = 500
# A sweep whose largest length error is below this (meters) has converged.
CONVERGED_M = 1e-9
# Leftover residual that flags a contradiction: max(absolute, relative).
CONTRADICTION_ABS_M = 0.02
CONTRADICTION_REL = 0.02


def solve_vertices(
    verts_m: list[tuple[float, float]],
    wall_vids: list[tuple[int, int]],
    targets_m: dict[int, float],
    warnings: list[str],
    x_class: list[int] | None = None,
    y_class: list[int] | None = None,
) -> list[tuple[float, float]]:
    """Move shared vertices so measured walls hit their measured lengths.

    Sequential relaxation along each wall axis (``MAX_SWEEPS`` sweeps max,
    stops below ``CONVERGED_M`` residual). Walls without a target follow their
    shared vertices and stay estimated. Large leftover residuals mean
    contradictory measures and are flagged to the technician by appending to
    ``warnings`` -- never silently averaged. ``verts_m`` is not mutated.

    ``x_class`` / ``y_class`` (optional, one id per vertex) tie vertices to a
    shared coordinate: vertices with the same x class always keep the same x
    (a vertical wall), same for y (a horizontal wall). Each class starts at
    the mean of its members. Without them every vertex is free, as before.
    """
    if not targets_m and x_class is None and y_class is None:
        return verts_m
    n = len(verts_m)
    xc = list(x_class) if x_class is not None else list(range(n))
    yc = list(y_class) if y_class is not None else list(range(n))
    xs: dict[int, list[float]] = {}
    ys: dict[int, list[float]] = {}
    for i, (px, py) in enumerate(verts_m):
        xs.setdefault(xc[i], []).append(px)
        ys.setdefault(yc[i], []).append(py)
    cx = {k: sum(v) / len(v) for k, v in xs.items()}
    cy = {k: sum(v) / len(v) for k, v in ys.items()}

    def at(i: int) -> tuple[float, float]:
        return cx[xc[i]], cy[yc[i]]

    for _ in range(MAX_SWEEPS):
        sweep_max = 0.0
        for j, target in targets_m.items():
            u, v = wall_vids[j]
            (ux0, uy0), (vx0, vy0) = at(u), at(v)
            dx, dy = vx0 - ux0, vy0 - uy0
            dist = math.hypot(dx, dy)
            if dist <= 0:
                continue
            err = target - dist
            sweep_max = max(sweep_max, abs(err))
            ux, uy = dx / dist, dy / dist
            cx[xc[u]] -= ux * err / 2
            cy[yc[u]] -= uy * err / 2
            cx[xc[v]] += ux * err / 2
            cy[yc[v]] += uy * err / 2
        if sweep_max < CONVERGED_M:
            break
    for j, target in targets_m.items():
        u, v = wall_vids[j]
        residual = abs(math.dist(at(u), at(v)) - target)
        if residual > max(CONTRADICTION_ABS_M, CONTRADICTION_REL * target):
            warnings.append(
                f"contradiction: wall {j + 1} measures disagree "
                f"(residual {residual:.2f} m), verify with human"
            )
    return [at(i) for i in range(n)]


__all__ = ["solve_vertices"]
