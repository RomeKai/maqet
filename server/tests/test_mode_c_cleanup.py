"""Mode C cleanup: corners, orthogonal snap, dedup, close loop, snap warning.

RED first: uses the replay sample for the 3x8 rectangle sketch.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import pytest

from server.intake.schemas import IntakeProposal

PLANS = Path(__file__).resolve().parents[2] / "samples" / "plans"
PROPOSAL_PATH = PLANS / "croquis_3x8_door_window.proposal.json"


def _load_proposal() -> tuple[IntakeProposal, int, int]:
    raw = json.loads(PROPOSAL_PATH.read_text(encoding="utf-8"))
    return IntakeProposal.model_validate(raw["proposal"]), raw["image"]["w"], raw["image"]["h"]


def _wall_angle_deg(ax: float, ay: float, bx: float, by: float) -> float:
    return math.degrees(math.atan2(by - ay, bx - ax))


def test_3x8_rectangle_no_diagonal_and_four_walls() -> None:
    """3x8 sketch: after cleanup there are exactly 4 walls, no diagonal."""
    from server.intake.cleanup import build_scaled_plan

    proposal, w, h = _load_proposal()
    plan = build_scaled_plan(proposal, w, h)
    assert len(plan.walls) == 4, f"expected 4 walls (no diagonal), got {len(plan.walls)}"
    lengths = sorted(math.dist(ww.a, ww.b) for ww in plan.walls)
    assert lengths == pytest.approx([3.0, 3.0, 8.0, 8.0], abs=0.05)
    # corners form a closed loop
    assert len(plan.rooms) == 1


def test_snap_makes_walls_near_orthogonal() -> None:
    """Orthogonal snap: walls that were 0.7-5 deg off become closer to axis."""
    from server.intake.cleanup import _orthogonal_snap, TOL_DEFAULT

    raw = [((w.a[0], w.a[1]), (w.b[0], w.b[1]), w.kind) for w in _load_proposal()[0].walls]
    snapped = _orthogonal_snap(raw, TOL_DEFAULT, [])
    for (ax, ay), (bx, by), _ in snapped:
        ang = _wall_angle_deg(ax, ay, bx, by) % 360
        nearest = round(ang / 90) * 90
        delta = abs((ang - nearest + 180) % 360 - 180)
        assert delta < 0.5, f"snapped wall not orthogonal: {ang:.2f} delta {delta:.2f}"


def test_merge_corners_within_tolerance_via_vertex_clustering() -> None:
    """Endpoints within ENDPOINT_SNAP_TOL (0.05) cluster into one vertex."""
    from server.intake.cleanup import ENDPOINT_SNAP_TOL, TOL_DEFAULT, _cluster_vertices

    walls = [
        ((0.10, 0.10), (0.90, 0.10), "exterior"),
        ((0.90, 0.10), (0.90, 0.90), "exterior"),
        ((0.90, 0.90), (0.10, 0.90), "exterior"),
        ((0.10, 0.90), (0.12, 0.10), "exterior"),  # gap 0.02 < 0.05
    ]
    verts, vids = _cluster_vertices(walls, TOL_DEFAULT, snap_tol=ENDPOINT_SNAP_TOL)
    # first wall start and last wall end should share a vertex
    assert vids[0][0] == vids[3][1], f"near-miss corners not merged: {vids}"
    assert len(verts) == 4


def test_drop_zero_length_wall() -> None:
    from server.intake.cleanup import build_scaled_plan

    proposal = IntakeProposal.model_validate(
        {
            "input_kind": "sketch",
            "walls": [
                {"a": [0.10, 0.10], "b": [0.90, 0.10], "kind": "exterior"},
                {"a": [0.90, 0.10], "b": [0.90, 0.90], "kind": "exterior"},
                {"a": [0.90, 0.90], "b": [0.10, 0.90], "kind": "exterior"},
                {"a": [0.10, 0.90], "b": [0.10, 0.10], "kind": "exterior"},
                {"a": [0.50, 0.50], "b": [0.50, 0.50], "kind": "exterior"},
            ],
            "openings": [],
            "labels": [],
            "dimensions": [{"text": "8,00 m", "a": [0.0, 0.02], "b": [1.0, 0.02], "wall_index": 0}],
        }
    )
    plan = build_scaled_plan(proposal, 1000, 1000)
    assert len(plan.walls) == 4


def test_drop_duplicate_wall() -> None:
    from server.intake.cleanup import build_scaled_plan

    proposal = IntakeProposal.model_validate(
        {
            "input_kind": "sketch",
            "walls": [
                {"a": [0.10, 0.10], "b": [0.90, 0.10], "kind": "exterior"},
                {"a": [0.90, 0.10], "b": [0.90, 0.90], "kind": "exterior"},
                {"a": [0.90, 0.90], "b": [0.10, 0.90], "kind": "exterior"},
                {"a": [0.10, 0.90], "b": [0.10, 0.10], "kind": "exterior"},
                {"a": [0.10, 0.10], "b": [0.90, 0.10], "kind": "exterior"},
            ],
            "openings": [],
            "labels": [],
            "dimensions": [{"text": "8,00 m", "a": [0.0, 0.02], "b": [1.0, 0.02], "wall_index": 0}],
        }
    )
    plan = build_scaled_plan(proposal, 1000, 1000)
    assert len(plan.walls) == 4


def test_close_loop_when_ends_within_tolerance() -> None:
    from server.intake.cleanup import build_scaled_plan

    proposal = IntakeProposal.model_validate(
        {
            "input_kind": "sketch",
            "walls": [
                {"a": [0.10, 0.10], "b": [0.90, 0.10], "kind": "exterior"},
                {"a": [0.90, 0.10], "b": [0.90, 0.90], "kind": "exterior"},
                {"a": [0.90, 0.90], "b": [0.10, 0.90], "kind": "exterior"},
                {"a": [0.10, 0.90], "b": [0.12, 0.10], "kind": "exterior"},
            ],
            "openings": [],
            "labels": [],
            "dimensions": [{"text": "8,00 m", "a": [0.0, 0.02], "b": [1.0, 0.02], "wall_index": 0}],
        }
    )
    plan = build_scaled_plan(proposal, 1000, 1000)
    assert len(plan.rooms) == 1, f"loop not closed: {plan.warnings}"


def test_diagonal_wall_is_kept_with_warning() -> None:
    """Angled walls are real geometry (chamfer): kept, not silently dropped."""
    from server.intake.cleanup import CODE_DIAGONAL_KEPT, build_scaled_plan

    proposal = IntakeProposal.model_validate(
        {
            "input_kind": "sketch",
            "walls": [
                {"a": [0.10, 0.10], "b": [0.90, 0.10], "kind": "exterior"},
                {"a": [0.90, 0.10], "b": [0.90, 0.90], "kind": "exterior"},
                {"a": [0.90, 0.90], "b": [0.10, 0.90], "kind": "exterior"},
                {"a": [0.10, 0.90], "b": [0.10, 0.10], "kind": "exterior"},
                {"a": [0.10, 0.10], "b": [0.90, 0.90], "kind": "exterior"},
            ],
            "openings": [],
            "labels": [],
            "dimensions": [{"text": "8,00 m", "a": [0.0, 0.02], "b": [1.0, 0.02], "wall_index": 0}],
        }
    )
    plan = build_scaled_plan(proposal, 1000, 1000)
    assert len(plan.walls) == 5
    assert any(CODE_DIAGONAL_KEPT in w for w in plan.warnings)


def test_pentagon_with_chamfer_keeps_five_walls() -> None:
    """Pentagon sketch with one 45 deg chamfer wall keeps 5 walls + warning."""
    from server.intake.cleanup import CODE_DIAGONAL_KEPT, build_scaled_plan

    proposal = IntakeProposal.model_validate(
        {
            "input_kind": "sketch",
            "walls": [
                {"a": [0.10, 0.10], "b": [0.80, 0.10], "kind": "exterior"},
                {"a": [0.80, 0.10], "b": [0.90, 0.20], "kind": "exterior"},  # 45 deg chamfer
                {"a": [0.90, 0.20], "b": [0.90, 0.90], "kind": "exterior"},
                {"a": [0.90, 0.90], "b": [0.10, 0.90], "kind": "exterior"},
                {"a": [0.10, 0.90], "b": [0.10, 0.10], "kind": "exterior"},
            ],
            "openings": [],
            "labels": [],
            "dimensions": [{"text": "8,00 m", "a": [0.0, 0.02], "b": [1.0, 0.02], "wall_index": 0}],
        }
    )
    plan = build_scaled_plan(proposal, 1000, 1000)
    assert len(plan.walls) == 5, f"chamfer wall dropped, got {len(plan.walls)}"
    assert any(CODE_DIAGONAL_KEPT in w for w in plan.warnings), f"no diagonal warning: {plan.warnings}"


def test_snap_warning_over_ten_percent() -> None:
    """When snapping changes a wall by >10%, a warning code must appear."""
    from server.intake.cleanup import CODE_SNAP_LARGE, _orthogonal_snap

    # Wall 0: dx=0.8, dy=0.18 => ang 12.7 deg, within 15 deg snap but large endpoint move
    # midpoint snap moves each endpoint by dy/2 = 0.09; len ~0.82; ratio 11% > 10%
    raw = [
        ((0.10, 0.10), (0.90, 0.28), "exterior"),
        ((0.90, 0.28), (0.90, 0.90), "exterior"),
        ((0.90, 0.90), (0.10, 0.90), "exterior"),
        ((0.10, 0.90), (0.10, 0.10), "exterior"),
    ]
    warnings: list[str] = []
    _orthogonal_snap(raw, 1e-6, warnings)
    assert any(CODE_SNAP_LARGE in w for w in warnings), f"no snap warning: {warnings}"


def test_written_lengths_applied_to_3x8_walls() -> None:
    """Mode C: written per-wall lengths are applied (pipeline integration)."""
    import math

    from server.intake.cleanup import build_scaled_plan

    proposal, w, h = _load_proposal()
    plan = build_scaled_plan(proposal, w, h)
    # all 4 walls have written lengths
    assert all(ww.measured_m is not None for ww in plan.walls)
    assert [ww.measured_m for ww in plan.walls] == pytest.approx([3.0, 8.0, 3.0, 8.0])
    # no snap warning on the real fixture: wobble is small (< 10%)
    assert not any("snapped_large" in ww for ww in plan.warnings)
