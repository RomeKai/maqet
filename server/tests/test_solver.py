"""Per-wall vertex solver tests (ADR-025 modes B and C).

The solver moves SHARED vertices so every measured wall hits its own length.
Walls without a measurement are never forced (they stay ``estimated``), and
contradictory measures are flagged, never silently averaged (ADR-002).
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import pytest

from server.intake.schemas import IntakeProposal
from server.intake.solver import solve_vertices

# Drawn as a 3 x 3 square; wall j joins vertices WALL_VIDS[j].
SQUARE = [(0.0, 0.0), (3.0, 0.0), (3.0, 3.0), (0.0, 3.0)]
WALL_VIDS = [(0, 1), (1, 2), (2, 3), (3, 0)]


def _lengths(
    verts: list[tuple[float, float]], vids: list[tuple[int, int]]
) -> list[float]:
    return [math.dist(verts[u], verts[v]) for u, v in vids]


# --- (a) all walls measured ------------------------------------------------------


def test_all_walls_measured_gives_exact_lengths() -> None:
    warnings: list[str] = []
    solved = solve_vertices(
        SQUARE, WALL_VIDS, {0: 4.0, 1: 3.0, 2: 4.0, 3: 3.0}, warnings
    )
    assert _lengths(solved, WALL_VIDS) == pytest.approx([4.0, 3.0, 4.0, 3.0], abs=1e-6)
    assert warnings == []


def test_solver_does_not_mutate_its_inputs() -> None:
    verts = list(SQUARE)
    solve_vertices(verts, WALL_VIDS, {0: 4.0}, [])
    assert verts == SQUARE


def test_no_targets_returns_vertices_unchanged() -> None:
    assert solve_vertices(SQUARE, WALL_VIDS, {}, []) == SQUARE


# --- (b) only one wall measured --------------------------------------------------


def test_single_measured_wall_is_exact_and_others_are_not_forced() -> None:
    warnings: list[str] = []
    solved = solve_vertices(SQUARE, WALL_VIDS, {0: 4.0}, warnings)
    lengths = _lengths(solved, WALL_VIDS)
    assert lengths[0] == pytest.approx(4.0, abs=1e-6)
    # Unmeasured walls only follow their shared vertices: none is promoted to
    # the measured value, and nothing is flagged as a contradiction.
    assert all(abs(length - 4.0) > 0.5 for length in lengths[1:])
    assert warnings == []


def _two_parallel_walls() -> IntakeProposal:
    return IntakeProposal.model_validate(
        {
            "input_kind": "sketch",
            "walls": [
                {"a": [0.0, 0.2], "b": [1.0, 0.2], "kind": "exterior"},
                {"a": [0.0, 0.8], "b": [1.0, 0.8], "kind": "exterior"},
            ],
            "openings": [],
            "labels": [],
            "dimensions": [
                {"text": "3,50", "a": [0.0, 0.02], "b": [1.0, 0.02], "wall_index": 0}
            ],
        }
    )


def test_unmeasured_walls_stay_estimated_through_the_pipeline() -> None:
    from server.intake.cleanup import build_scaled_plan, to_scene

    scene = to_scene(build_scaled_plan(_two_parallel_walls(), 1000, 800))
    measured, unmeasured = scene.walls
    assert measured.provenance == "written_on_sketch"
    assert measured.measured_length_m == pytest.approx(3.5)
    assert unmeasured.provenance == "estimated"
    assert unmeasured.measured_length_m is None


# --- (c) contradictory measures --------------------------------------------------


def test_contradictory_measures_warn_and_are_never_averaged() -> None:
    # Two collinear 2.00 m walls cannot span a 5.00 m wall between the same ends.
    verts = [(0.0, 0.0), (2.0, 0.0), (4.0, 0.0)]
    vids = [(0, 1), (1, 2), (0, 2)]
    targets = {0: 2.0, 1: 2.0, 2: 5.0}
    warnings: list[str] = []

    solved = solve_vertices(verts, vids, targets, warnings)

    assert any("contradiction" in w for w in warnings)
    lengths = _lengths(solved, vids)
    assert all(math.isfinite(length) for length in lengths)
    mean_of_targets = sum(targets.values()) / len(targets)
    assert all(abs(length - mean_of_targets) > 0.1 for length in lengths)


def test_consistent_measures_within_tolerance_do_not_warn() -> None:
    # 1 cm off on a 4 m wall is inside the 2% tolerance: no contradiction.
    warnings: list[str] = []
    solve_vertices(SQUARE, WALL_VIDS, {0: 4.0, 1: 3.0, 2: 4.01, 3: 3.0}, warnings)
    assert not any("contradiction" in w for w in warnings)


# --- non-proportional sketch fixture (ADR-025: a global factor must fail) ---------

PLANS = Path(__file__).resolve().parents[2] / "samples" / "plans"
PER_WALL_TOLERANCE = 0.02
# A single global scale factor must be at least this wrong on the same sketch.
GLOBAL_FACTOR_MIN_ERROR = 0.10


def _load_nonproportional() -> tuple[IntakeProposal, int, int, list[float]]:
    """(proposal as the vision step returns it, image w, h, true wall lengths m)."""
    raw = json.loads(
        (PLANS / "croquis_nonproportional.proposal.json").read_text(encoding="utf-8")
    )
    truth = json.loads(
        (PLANS / "croquis_nonproportional.truth.json").read_text(encoding="utf-8")
    )
    assert all(w["provenance"] == "written_on_sketch" for w in truth["walls"])
    true_lengths = [w["measured_length_m"] for w in truth["walls"]]
    for wall, length in zip(truth["walls"], true_lengths, strict=True):
        assert math.dist(wall["a"], wall["b"]) == pytest.approx(length)
    return (
        IntakeProposal.model_validate(raw["proposal"]),
        raw["image"]["w"],
        raw["image"]["h"],
        true_lengths,
    )


def _drawn_lengths_px(proposal: IntakeProposal, w: int, h: int) -> list[float]:
    return [
        math.hypot((wall.b[0] - wall.a[0]) * w, (wall.b[1] - wall.a[1]) * h)
        for wall in proposal.walls
    ]


def _max_relative_error(got: list[float], truth: list[float]) -> float:
    return max(abs(g - t) / t for g, t in zip(got, truth, strict=True))


def test_nonproportional_fixture_is_drawn_out_of_proportion() -> None:
    proposal, w, h, truth = _load_nonproportional()
    drawn = _drawn_lengths_px(proposal, w, h)
    longest_written = max(range(len(truth)), key=truth.__getitem__)
    shortest_written = min(range(len(truth)), key=truth.__getitem__)
    # The longest written wall (6.00 m) is drawn SHORTER than a 3.50 m wall.
    assert truth[longest_written] == pytest.approx(6.0)
    assert any(
        drawn[longest_written] < drawn[j] and truth[j] < truth[longest_written]
        for j in range(len(truth))
    )
    assert truth[shortest_written] < truth[longest_written]


def test_nonproportional_per_wall_solver_error_under_two_percent() -> None:
    from server.intake.cleanup import build_scaled_plan

    proposal, w, h, truth = _load_nonproportional()
    plan = build_scaled_plan(proposal, w, h)
    solved = [math.dist(wall.a, wall.b) for wall in plan.walls]
    assert len(solved) == len(truth)
    for got, want in zip(solved, truth, strict=True):
        assert abs(got - want) / want < PER_WALL_TOLERANCE
    assert not any("contradiction" in msg for msg in plan.warnings)
    assert all(wall.measured_m is not None for wall in plan.walls)


def test_nonproportional_single_global_factor_is_measurably_worse() -> None:
    from server.intake.cleanup import build_scaled_plan

    proposal, w, h, truth = _load_nonproportional()
    drawn = _drawn_lengths_px(proposal, w, h)
    # Best possible single factor for THIS data: least squares on the lengths.
    factor = sum(d * t for d, t in zip(drawn, truth, strict=True)) / sum(
        d * d for d in drawn
    )
    global_error = _max_relative_error([factor * d for d in drawn], truth)

    plan = build_scaled_plan(proposal, w, h)
    solver_error = _max_relative_error(
        [math.dist(wall.a, wall.b) for wall in plan.walls], truth
    )

    assert global_error > GLOBAL_FACTOR_MIN_ERROR
    assert global_error > solver_error
