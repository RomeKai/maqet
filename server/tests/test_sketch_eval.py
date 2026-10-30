"""Sketch accuracy eval (Mode C) — RED first.

Tests the offline harness in server/intake/sketch_eval.py:
- evaluate() runs the deterministic pipeline (cleanup + solver, no model calls)
  and compares the resulting Scene to truth.
- Per-wall length error (m and %), corner position error, wall count,
  opening count/kind/width error, closed-loop yes/no.
- CLI prints one table row per sample.

TDD: this file is written BEFORE the module exists.
"""

from __future__ import annotations

import math


def _tiny_truth():
    """Hand-built truth: 2 m × 1 m rectangle, one door."""
    from server.scene.models import Scene

    return Scene.model_validate(
        {
            "id": "tiny",
            "units": "m",
            "scale_confirmed": True,
            "ceiling_height_m": 2.6,
            "walls": [
                {"id": "w0", "a": [0, 0], "b": [2, 0], "thickness_m": 0.2, "kind": "exterior", "provenance": "written_on_sketch", "measured_length_m": 2.0},
                {"id": "w1", "a": [2, 0], "b": [2, 1], "thickness_m": 0.2, "kind": "exterior", "provenance": "written_on_sketch", "measured_length_m": 1.0},
                {"id": "w2", "a": [2, 1], "b": [0, 1], "thickness_m": 0.2, "kind": "exterior", "provenance": "written_on_sketch", "measured_length_m": 2.0},
                {"id": "w3", "a": [0, 1], "b": [0, 0], "thickness_m": 0.2, "kind": "exterior", "provenance": "written_on_sketch", "measured_length_m": 1.0},
            ],
            "openings": [
                {"id": "d1", "wall_id": "w0", "kind": "door", "offset_m": 0.5, "width_m": 0.9, "height_m": 2.05},
            ],
            "rooms": [
                {"id": "r0", "name": "ROOM", "polygon": [[0, 0], [2, 0], [2, 1], [0, 1]]},
            ],
        }
    )


def _tiny_proposal():
    """Proposal that should reproduce tiny truth via the deterministic pipeline."""
    from server.intake.schemas import IntakeProposal

    return IntakeProposal.model_validate(
        {
            "input_kind": "sketch",
            "walls": [
                {"a": [0.1, 0.1], "b": [0.9, 0.1], "kind": "exterior"},
                {"a": [0.9, 0.1], "b": [0.9, 0.9], "kind": "exterior"},
                {"a": [0.9, 0.9], "b": [0.1, 0.9], "kind": "exterior"},
                {"a": [0.1, 0.9], "b": [0.1, 0.1], "kind": "exterior"},
            ],
            "openings": [
                {"wall_index": 0, "t0": 0.25, "t1": 0.70, "kind": "door"},
            ],
            "labels": [],
            "dimensions": [
                {"text": "2.00 m", "a": [0.1, 0.02], "b": [0.9, 0.02], "wall_index": 0},
                {"text": "1.00 m", "a": [0.95, 0.1], "b": [0.95, 0.9], "wall_index": 1},
                {"text": "2.00 m", "a": [0.1, 0.95], "b": [0.9, 0.95], "wall_index": 2},
                {"text": "1.00 m", "a": [0.02, 0.1], "b": [0.02, 0.9], "wall_index": 3},
            ],
        }
    )


def test_evaluate_tiny_case_computed_correctly():
    """Hand-built tiny case: wall lengths exact, opening width, closed loop."""
    from server.intake.sketch_eval import evaluate_scenes, compare_scenes

    # Prefer evaluate_scenes if available, else compare_scenes
    try:
        from server.intake.sketch_eval import evaluate_scenes as eval_fn
    except ImportError:
        from server.intake.sketch_eval import compare_scenes as eval_fn  # type: ignore[no-redef]

    truth = _tiny_truth()
    # Build got via the real pipeline to ensure import-not-copy contract
    from server.intake.cleanup import build_scaled_plan, to_scene

    proposal = _tiny_proposal()
    plan = build_scaled_plan(proposal, 1000, 1000)
    got = to_scene(plan, scene_id="tiny-got")

    report = eval_fn(truth, got)

    # Wall count
    assert report.wall_count_got == 4
    assert report.wall_count_truth == 4
    assert report.wall_count_ok is True

    # Per-wall length error: should be ~0
    assert report.max_wall_length_error_m == 0.0 or report.max_wall_length_error_m < 0.06
    assert report.max_wall_length_error_pct < 5.0

    # Corner position error: small (solver preserves shape)
    assert report.corner_position_error_m < 0.10

    # Opening count/kind/width
    assert report.opening_count_got == 1
    assert report.opening_count_truth == 1
    assert report.opening_count_ok is True
    assert report.opening_kind_ok is True
    assert report.max_opening_width_error_m < 0.05

    # Closed loop
    assert report.closed_loop is True
    assert report.closed_loop_truth is True
    assert report.closed_loop_ok is True


def test_evaluate_real_samples_structure_and_thresholds():
    """Current samples produce a report with expected structure and thresholds."""
    import json
    from pathlib import Path

    from server.intake.sketch_eval import evaluate

    plans_dir = Path(__file__).resolve().parents[2] / "samples" / "plans"
    proposal_files = sorted(plans_dir.glob("*.proposal.json"))
    # At least the two Mode C fixtures must exist
    assert len(proposal_files) >= 2, f"expected >=2 proposals, got {proposal_files}"

    for pf in proposal_files:
        truth_path = pf.with_suffix("").with_suffix(".truth.json") if pf.suffix == ".json" else None
        # Actually proposal is e.g. croquis_3x8_door_window.proposal.json -> truth is .truth.json
        sample = pf.name.removesuffix(".proposal.json")
        truth_file = plans_dir / f"{sample}.truth.json"
        if not truth_file.exists():
            continue

        report = evaluate(sample)

        # Structure assertions
        assert report.sample == sample
        assert isinstance(report.wall_count_truth, int)
        assert isinstance(report.wall_count_got, int)
        assert isinstance(report.max_wall_length_error_m, float)
        assert isinstance(report.max_wall_length_error_pct, float)
        assert isinstance(report.corner_position_error_m, float)
        assert isinstance(report.opening_count_truth, int)
        assert isinstance(report.opening_count_got, int)
        assert isinstance(report.closed_loop, bool)
        assert isinstance(report.closed_loop_truth, bool)
        assert hasattr(report, "per_wall_errors")
        assert hasattr(report, "per_opening_width_errors")

        # Today's thresholds (xfail until day console turns green):
        # wall length error <= 5 %, opening count exact
        assert report.max_wall_length_error_pct <= 5.0, (
            f"{sample}: wall length error {report.max_wall_length_error_pct:.1f}% exceeds 5% "
            f"(got {report.per_wall_errors})"
        )
        assert report.opening_count_ok, (
            f"{sample}: opening count {report.opening_count_got} != truth {report.opening_count_truth}"
        )
        assert report.wall_count_ok, (
            f"{sample}: wall count {report.wall_count_got} != truth {report.wall_count_truth}"
        )


def test_evaluate_cli_importable():
    """CLI entry point exists and is callable without network."""
    from server.intake.sketch_eval import main

    assert callable(main)


def test_sketch_report_is_pydantic():
    """SketchReport is a pydantic model with expected fields."""
    from server.intake.sketch_eval import SketchReport

    assert hasattr(SketchReport, "model_fields")
    fields = set(SketchReport.model_fields.keys())
    for expected in [
        "sample",
        "wall_count_truth",
        "wall_count_got",
        "max_wall_length_error_m",
        "max_wall_length_error_pct",
        "corner_position_error_m",
        "opening_count_truth",
        "opening_count_got",
        "closed_loop",
        "closed_loop_truth",
    ]:
        assert expected in fields, f"SketchReport missing field {expected}"
