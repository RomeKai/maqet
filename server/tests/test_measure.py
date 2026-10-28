"""Mode B tests (ADR-025): room photo + tapped lengths -> `measured_tape` walls.

Mode B must go through the SAME solver path as mode C (``solve_vertices`` via
``build_scaled_plan``); only the provenance label differs.
"""

from __future__ import annotations

import math

import pytest

from server.intake import cleanup
from server.intake.cleanup import ScaleError, build_scaled_plan, to_scene
from server.intake.measure import (
    MEASURED_TAPE,
    MeasureError,
    TappedLength,
    build_tapped_plan,
)
from server.intake.schemas import IntakeProposal, IntakeWall

# A room outline as the technician drew it in the plan view (normalized, y down).
# Drawn as a square; the tape says it is a 4.00 x 3.00 m room.
OUTLINE = [
    IntakeWall(a=(0.1, 0.1), b=(0.9, 0.1), kind="exterior"),
    IntakeWall(a=(0.9, 0.1), b=(0.9, 0.9), kind="exterior"),
    IntakeWall(a=(0.9, 0.9), b=(0.1, 0.9), kind="exterior"),
    IntakeWall(a=(0.1, 0.9), b=(0.1, 0.1), kind="exterior"),
]
ALL_TAPS = [
    TappedLength(wall_index=0, length="4,00"),
    TappedLength(wall_index=1, length="3.00"),
    TappedLength(wall_index=2, length="4,00"),
    TappedLength(wall_index=3, length="3,00"),
]


def _wall_lengths(plan: cleanup.ScaledPlan) -> list[float]:
    return [math.dist(w.a, w.b) for w in plan.walls]


def test_tapped_lengths_become_measured_tape_walls() -> None:
    plan = build_tapped_plan(OUTLINE, ALL_TAPS, 1000, 1000)
    scene = to_scene(plan, measured_provenance=MEASURED_TAPE)
    assert [w.provenance for w in scene.walls] == ["measured_tape"] * 4
    assert [w.measured_length_m for w in scene.walls] == pytest.approx(
        [4.0, 3.0, 4.0, 3.0]
    )
    assert _wall_lengths(plan) == pytest.approx([4.0, 3.0, 4.0, 3.0], abs=1e-6)
    assert scene.scale_confirmed is False  # the technician confirms (ADR-002)


def test_walls_without_a_tap_stay_estimated() -> None:
    plan = build_tapped_plan(OUTLINE, ALL_TAPS[:1], 1000, 1000)
    scene = to_scene(plan, measured_provenance=MEASURED_TAPE)
    assert scene.walls[0].provenance == "measured_tape"
    assert [w.provenance for w in scene.walls[1:]] == ["estimated"] * 3
    assert [w.measured_length_m for w in scene.walls[1:]] == [None] * 3
    assert any("estimated" in msg for msg in plan.warnings)


def test_mode_b_goes_through_the_shared_solver(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[dict[int, float]] = []
    real = cleanup.solve_vertices

    def spy(verts, wall_vids, targets_m, warnings):  # type: ignore[no-untyped-def]
        calls.append(dict(targets_m))
        return real(verts, wall_vids, targets_m, warnings)

    monkeypatch.setattr(cleanup, "solve_vertices", spy)
    build_tapped_plan(OUTLINE, ALL_TAPS, 1000, 1000)
    assert calls == [{0: 4.0, 1: 3.0, 2: 4.0, 3: 3.0}]


def test_mode_b_matches_mode_c_geometry_and_differs_only_in_provenance() -> None:
    mode_c = IntakeProposal.model_validate(
        {
            "input_kind": "sketch",
            "walls": [w.model_dump() for w in OUTLINE],
            "openings": [],
            "labels": [],
            "dimensions": [
                {"text": t.length, "a": w.a, "b": w.b, "wall_index": t.wall_index}
                for t, w in zip(ALL_TAPS, OUTLINE, strict=True)
            ],
        }
    )
    scene_c = to_scene(build_scaled_plan(mode_c, 1000, 1000))
    scene_b = to_scene(
        build_tapped_plan(OUTLINE, ALL_TAPS, 1000, 1000),
        measured_provenance=MEASURED_TAPE,
    )
    assert [(w.a, w.b) for w in scene_b.walls] == [(w.a, w.b) for w in scene_c.walls]
    assert {w.provenance for w in scene_c.walls} == {"written_on_sketch"}
    assert {w.provenance for w in scene_b.walls} == {"measured_tape"}


def test_conflicting_taps_on_one_wall_warn_and_leave_unmeasured() -> None:
    """Genuine tap conflict with no supporting opposite wall: no silent min.

    The wall stays unmeasured (estimated) and the warning carries both
    values so the technician resolves them (ADR-002).
    """
    taps = [
        TappedLength(wall_index=0, length="3,50"),
        TappedLength(wall_index=0, length="4,00"),
    ]
    plan = build_tapped_plan(OUTLINE, taps, 1000, 1000)
    assert plan.walls[0].measured_m is None
    matches = [msg for msg in plan.warnings if "contradiction" in msg]
    assert len(matches) == 1
    assert "3.50" in matches[0] and "4.00" in matches[0]


def test_unreadable_typed_length_fails_loudly() -> None:
    with pytest.raises(MeasureError, match="length"):
        build_tapped_plan(
            OUTLINE, [TappedLength(wall_index=0, length="abc")], 1000, 1000
        )


def test_tap_on_unknown_wall_fails_loudly() -> None:
    with pytest.raises(MeasureError, match="wall"):
        build_tapped_plan(
            OUTLINE, [TappedLength(wall_index=9, length="3,00")], 1000, 1000
        )


def test_no_taps_asks_the_human_for_a_measure() -> None:
    with pytest.raises(ScaleError):
        build_tapped_plan(OUTLINE, [], 1000, 1000)
