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
) -> list[tuple[float, float]]:
    """Move shared vertices so measured walls hit their measured lengths.

    Sequential relaxation along each wall axis (``MAX_SWEEPS`` sweeps max,
    stops below ``CONVERGED_M`` residual). Walls without a target follow their
    shared vertices and stay estimated. Large leftover residuals mean
    contradictory measures and are flagged to the technician by appending to
    ``warnings`` -- never silently averaged. ``verts_m`` is not mutated.
    """
    pos = [list(v) for v in verts_m]
    if not targets_m:
        return verts_m
    for _ in range(MAX_SWEEPS):
        sweep_max = 0.0
        for j, target in targets_m.items():
            u, v = wall_vids[j]
            dx, dy = pos[v][0] - pos[u][0], pos[v][1] - pos[u][1]
            dist = math.hypot(dx, dy)
            if dist <= 0:
                continue
            err = target - dist
            sweep_max = max(sweep_max, abs(err))
            ux, uy = dx / dist, dy / dist
            pos[u][0] -= ux * err / 2
            pos[u][1] -= uy * err / 2
            pos[v][0] += ux * err / 2
            pos[v][1] += uy * err / 2
        if sweep_max < CONVERGED_M:
            break
    for j, target in targets_m.items():
        u, v = wall_vids[j]
        residual = abs(math.dist(pos[u], pos[v]) - target)
        if residual > max(CONTRADICTION_ABS_M, CONTRADICTION_REL * target):
            warnings.append(
                f"contradiction: wall {j} measures disagree "
                f"(residual {residual:.2f} m), verify with human"
            )
    return [(p[0], p[1]) for p in pos]


__all__ = ["solve_vertices"]
