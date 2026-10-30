"""Offline accuracy harness for Mode C.

For every samples/plans/*.proposal.json with a matching *.truth.json,
run the existing deterministic pipeline (cleanup + per-wall solver, exactly
as POST /intake does after the vision call; import, never copy) and compare
the resulting Scene to truth: per-wall length error (m and %), corner
position error, wall count, opening count/kind/width error, closed-loop
yes/no. No model calls.

CLI: python -m server.intake.sketch_eval  -> one table row per sample.
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

from pydantic import BaseModel

from server.intake.cleanup import build_scaled_plan, to_scene
from server.intake.schemas import IntakeProposal
from server.scene.models import Scene

REPO = Path(__file__).resolve().parents[2]
PLANS_DIR = REPO / "samples" / "plans"


class PerWallError(BaseModel):
    truth_m: float
    got_m: float
    error_m: float
    error_pct: float


class SketchReport(BaseModel):
    sample: str
    wall_count_truth: int
    wall_count_got: int
    wall_count_ok: bool
    max_wall_length_error_m: float
    max_wall_length_error_pct: float
    per_wall_errors: list[PerWallError]
    corner_position_error_m: float
    opening_count_truth: int
    opening_count_got: int
    opening_count_ok: bool
    opening_kind_ok: bool
    max_opening_width_error_m: float
    per_opening_width_errors: list[float]
    closed_loop: bool
    closed_loop_truth: bool
    closed_loop_ok: bool


def _wall_lengths_m(scene: Scene) -> list[float]:
    return [math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) for w in scene.walls]


def _wall_corners(scene: Scene) -> list[tuple[float, float]]:
    pts: list[tuple[float, float]] = []
    for w in scene.walls:
        pts.append((float(w.a[0]), float(w.a[1])))
        pts.append((float(w.b[0]), float(w.b[1])))
    # dedup within 1e-6
    uniq: list[tuple[float, float]] = []
    for p in pts:
        if not any(math.dist(p, q) < 1e-6 for q in uniq):
            uniq.append(p)
    return uniq


def _corner_error_m(
    truth_corners: list[tuple[float, float]],
    got_corners: list[tuple[float, float]],
) -> float:
    if not truth_corners and not got_corners:
        return 0.0
    if not truth_corners or not got_corners:
        # max extent as fallback
        all_pts = truth_corners + got_corners
        if not all_pts:
            return 0.0
        xs = [p[0] for p in all_pts]
        ys = [p[1] for p in all_pts]
        return math.hypot(max(xs) - min(xs), max(ys) - min(ys))
    # For each got corner, distance to nearest truth corner; max of those
    max_d = 0.0
    for g in got_corners:
        d = min(math.dist(g, t) for t in truth_corners)
        max_d = max(max_d, d)
    # Also truth -> got for symmetry
    for t in truth_corners:
        d = min(math.dist(t, g) for g in got_corners)
        max_d = max(max_d, d)
    return max_d


def _opening_kind_ok(truth: Scene, got: Scene) -> bool:
    from collections import Counter

    tc = Counter(o.kind for o in truth.openings)
    gc = Counter(o.kind for o in got.openings)
    return tc == gc


def _max_opening_width_error_m(truth: Scene, got: Scene) -> tuple[float, list[float]]:
    if not truth.openings and not got.openings:
        return 0.0, []
    if not truth.openings or not got.openings:
        # If counts differ, report max width among present as error
        all_widths = [o.width_m for o in truth.openings + got.openings]
        return max(all_widths) if all_widths else 0.0, []
    # Match by kind: sort both by (kind, offset_m)
    truth_by_kind: dict[str, list] = {}
    got_by_kind: dict[str, list] = {}
    for o in truth.openings:
        truth_by_kind.setdefault(o.kind, []).append(o)
    for o in got.openings:
        got_by_kind.setdefault(o.kind, []).append(o)
    errs: list[float] = []
    for kind in set(list(truth_by_kind.keys()) + list(got_by_kind.keys())):
        t_list = sorted(truth_by_kind.get(kind, []), key=lambda o: getattr(o, "offset_m", 0))
        g_list = sorted(got_by_kind.get(kind, []), key=lambda o: getattr(o, "offset_m", 0))
        # Pair by order; if counts equal this is stable
        n = min(len(t_list), len(g_list))
        for i in range(n):
            errs.append(abs(t_list[i].width_m - g_list[i].width_m))
        # Unmatched openings contribute their width as error
        if len(t_list) != len(g_list):
            longer = t_list if len(t_list) > len(g_list) else g_list
            for j in range(n, len(longer)):
                errs.append(float(longer[j].width_m))
    return max(errs) if errs else 0.0, errs


def evaluate_scenes(truth: Scene, got: Scene, sample: str = "") -> SketchReport:
    """Compare two Scenes (truth vs got). Pure; no I/O."""
    t_lengths = sorted(_wall_lengths_m(truth))
    g_lengths = sorted(_wall_lengths_m(got))

    # Per-wall errors: pair sorted lengths
    per_wall_errors: list[PerWallError] = []
    max_abs = 0.0
    max_pct = 0.0
    # Only compare up to min count; extra walls are max error
    n = min(len(t_lengths), len(g_lengths))
    for i in range(n):
        t = t_lengths[i]
        g = g_lengths[i]
        e = abs(g - t)
        pct = (e / t * 100.0) if t > 1e-9 else (0.0 if e < 1e-9 else 100.0)
        per_wall_errors.append(PerWallError(truth_m=t, got_m=g, error_m=e, error_pct=pct))
        max_abs = max(max_abs, e)
        max_pct = max(max_pct, pct)
    # Unmatched walls: wall count mismatch -> carry length as error
    if len(t_lengths) != len(g_lengths):
        longer = t_lengths if len(t_lengths) > len(g_lengths) else g_lengths
        for j in range(n, len(longer)):
            per_wall_errors.append(
                PerWallError(truth_m=longer[j], got_m=0.0, error_m=longer[j], error_pct=100.0)
            )
            max_abs = max(max_abs, longer[j])
            max_pct = max(max_pct, 100.0)

    # If no walls at all, errors are 0
    if not t_lengths and not g_lengths:
        max_abs = 0.0
        max_pct = 0.0

    t_corners = _wall_corners(truth)
    g_corners = _wall_corners(got)
    corner_err = _corner_error_m(t_corners, g_corners)

    wall_count_truth = len(truth.walls)
    wall_count_got = len(got.walls)
    opening_count_truth = len(truth.openings)
    opening_count_got = len(got.openings)
    kind_ok = _opening_kind_ok(truth, got)
    max_w_err, per_opening_errs = _max_opening_width_error_m(truth, got)

    closed_truth = len(truth.rooms or []) > 0
    closed_got = len(got.rooms or []) > 0

    return SketchReport(
        sample=sample,
        wall_count_truth=wall_count_truth,
        wall_count_got=wall_count_got,
        wall_count_ok=wall_count_truth == wall_count_got,
        max_wall_length_error_m=max_abs,
        max_wall_length_error_pct=max_pct,
        per_wall_errors=per_wall_errors,
        corner_position_error_m=corner_err,
        opening_count_truth=opening_count_truth,
        opening_count_got=opening_count_got,
        opening_count_ok=opening_count_truth == opening_count_got,
        opening_kind_ok=kind_ok,
        max_opening_width_error_m=max_w_err,
        per_opening_width_errors=per_opening_errs,
        closed_loop=closed_got,
        closed_loop_truth=closed_truth,
        closed_loop_ok=closed_got == closed_truth,
    )


# Alias for test convenience
compare_scenes = evaluate_scenes


def evaluate(sample: str) -> SketchReport:
    """Run deterministic pipeline for a sample and compare to truth."""
    proposal_path = PLANS_DIR / f"{sample}.proposal.json"
    truth_path = PLANS_DIR / f"{sample}.truth.json"
    if not proposal_path.is_file():
        raise FileNotFoundError(f"missing proposal {proposal_path}")
    if not truth_path.is_file():
        raise FileNotFoundError(f"missing truth {truth_path}")

    data = json.loads(proposal_path.read_text(encoding="utf-8"))
    image = data.get("image", {})
    w = int(image.get("w", 1000))
    h = int(image.get("h", 1000))
    proposal = IntakeProposal.model_validate(data["proposal"])

    plan = build_scaled_plan(proposal, w, h)
    got = to_scene(plan, scene_id=sample)

    truth_data = json.loads(truth_path.read_text(encoding="utf-8"))
    truth = Scene.model_validate(truth_data)

    report = evaluate_scenes(truth, got, sample=sample)
    return report


def available_samples() -> list[str]:
    out: list[str] = []
    for p in sorted(PLANS_DIR.glob("*.proposal.json")):
        sample = p.name.removesuffix(".proposal.json")
        if (PLANS_DIR / f"{sample}.truth.json").is_file():
            out.append(sample)
    return out


def main() -> int:
    samples = available_samples()
    if not samples:
        print("no samples with proposal+truth found")
        return 0

    # Header
    header = f"{'sample':<28} {'walls':<9} {'openings':<9} {'wall err%':<10} {'wall err m':<10} {'corner m':<8} {'closed'}"
    print(header)
    print("-" * len(header))
    for sample in samples:
        try:
            r = evaluate(sample)
        except Exception as exc:
            print(f"{sample:<28} ERROR: {exc}")
            continue
        walls_s = f"{r.wall_count_got}/{r.wall_count_truth}"
        openings_s = f"{r.opening_count_got}/{r.opening_count_truth}"
        closed_s = f"{'yes' if r.closed_loop else 'no'}/{'yes' if r.closed_loop_truth else 'no'}"
        print(
            f"{sample:<28} {walls_s:<9} {openings_s:<9} "
            f"{r.max_wall_length_error_pct:<10.2f} {r.max_wall_length_error_m:<10.4f} "
            f"{r.corner_position_error_m:<8.4f} {closed_s}"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
