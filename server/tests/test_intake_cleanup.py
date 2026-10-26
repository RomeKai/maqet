"""Intake cleanup + scale tests (F2). TDD: RED before server/intake/cleanup.py exists.

Pure geometry in NORMALIZED image coords (0..1, y down). Scale (px -> m)
comes from ONE parsed anchor dimension; never invented (ADR-002).
"""

from __future__ import annotations

import pytest

from server.intake.schemas import IntakeProposal


def _proposal(
    walls: list[dict],
    openings: list[dict] | None = None,
    dimensions: list[dict] | None = None,
    kind: str = "plan",
) -> IntakeProposal:
    return IntakeProposal.model_validate(
        {
            "input_kind": kind,
            "walls": walls,
            "openings": openings or [],
            "labels": [],
            "dimensions": dimensions or [],
        }
    )


def _wall(ax: float, ay: float, bx: float, by: float, kind: str | None = "exterior") -> dict:
    return {"a": [ax, ay], "b": [bx, by], "kind": kind}


def _dim(text: str, ax: float = 0.0, ay: float = 0.05, bx: float = 1.0, by: float = 0.05) -> dict:
    return {"text": text, "a": [ax, ay], "b": [bx, by]}


# --- dimension parsing -------------------------------------------------------


def test_parse_comma_decimal() -> None:
    from server.intake.cleanup import parse_dimension_meters

    assert parse_dimension_meters("3,50") == pytest.approx(3.5)


def test_parse_point_decimal_with_unit() -> None:
    from server.intake.cleanup import parse_dimension_meters

    assert parse_dimension_meters("2.80 m") == pytest.approx(2.8)


def test_parse_total_keyword() -> None:
    from server.intake.cleanup import parse_dimension_meters

    assert parse_dimension_meters("6,00 total") == pytest.approx(6.0)


def test_parse_garbage_returns_none() -> None:
    from server.intake.cleanup import parse_dimension_meters

    assert parse_dimension_meters("sin medida") is None
    assert parse_dimension_meters("") is None


# --- anchor selection --------------------------------------------------------


def test_select_anchor_prefers_total_over_unit() -> None:
    from server.intake.cleanup import select_anchor

    proposal = _proposal(
        [_wall(0, 0.1, 1, 0.1)],
        dimensions=[_dim("8,00 m"), _dim("6,00 total", ay=0.9, by=0.9)],
    )
    index, value = select_anchor(proposal.dimensions)
    assert proposal.dimensions[index].text == "6,00 total"
    assert value == pytest.approx(6.0)


def test_select_anchor_single_unit_ok() -> None:
    from server.intake.cleanup import select_anchor

    proposal = _proposal([_wall(0, 0.1, 1, 0.1)], dimensions=[_dim("3,50")])
    _, value = select_anchor(proposal.dimensions)
    assert value == pytest.approx(3.5)


def test_select_anchor_missing_raises_asking_human() -> None:
    from server.intake.cleanup import ScaleError, select_anchor

    with pytest.raises(ScaleError, match="[Hh]umano|correcci"):
        select_anchor([])


def test_select_anchor_explicit_index_wins() -> None:
    from server.intake.cleanup import select_anchor

    proposal = _proposal(
        [_wall(0, 0.1, 1, 0.1)],
        dimensions=[_dim("8,00 m"), _dim("6,00 total", ay=0.9, by=0.9)],
    )
    index, value = select_anchor(proposal.dimensions, anchor_index=0)
    assert index == 0
    assert value == pytest.approx(8.0)


def test_select_anchor_bad_explicit_index_raises() -> None:
    from server.intake.cleanup import ScaleError, select_anchor

    proposal = _proposal([_wall(0, 0.1, 1, 0.1)], dimensions=[_dim("8,00 m")])
    with pytest.raises(ScaleError, match="anchor_index"):
        select_anchor(proposal.dimensions, anchor_index=5)


# --- epsilon boundary (tol + 1e-9 merges, beyond does not) -------------------


def test_epsilon_boundary_merges() -> None:
    from server.intake.cleanup import TOL_DEFAULT, build_scaled_plan

    tol = TOL_DEFAULT
    gap = tol + 1e-9  # noqa: boundary; impl allows 2e-9 for float64 noise
    proposal = _proposal(
        [_wall(0.0, 0.1, 0.5, 0.1), _wall(0.5 + gap, 0.1, 1.0, 0.1)],
        dimensions=[_dim("8,00 m", ay=0.02, by=0.02)],
    )
    scaled = build_scaled_plan(proposal, 1000, 800)
    assert len(scaled.walls) == 1


def test_epsilon_beyond_does_not_merge() -> None:
    from server.intake.cleanup import TOL_DEFAULT, build_scaled_plan

    gap = TOL_DEFAULT + 1e-8
    proposal = _proposal(
        [_wall(0.0, 0.1, 0.5, 0.1), _wall(0.5 + gap, 0.1, 1.0, 0.1)],
        dimensions=[_dim("8,00 m", ay=0.02, by=0.02)],
    )
    scaled = build_scaled_plan(proposal, 1000, 800)
    assert len(scaled.walls) == 2


# --- collinear fusion --------------------------------------------------------


def test_collinear_overlapping_walls_fuse() -> None:
    from server.intake.cleanup import build_scaled_plan

    proposal = _proposal(
        [_wall(0.0, 0.2, 0.6, 0.2), _wall(0.4, 0.2, 1.0, 0.2)],
        dimensions=[_dim("8,00 m", ay=0.02, by=0.02)],
    )
    scaled = build_scaled_plan(proposal, 1000, 800)
    assert len(scaled.walls) == 1
    (wall,) = scaled.walls
    assert wall.a[0] == pytest.approx(0.0)
    assert wall.b[0] == pytest.approx(8.0)  # full width in meters


def test_perpendicular_walls_do_not_fuse() -> None:
    from server.intake.cleanup import build_scaled_plan

    proposal = _proposal(
        [_wall(0.0, 0.1, 1.0, 0.1), _wall(0.5, 0.1, 0.5, 0.9)],
        dimensions=[_dim("8,00 m", ay=0.02, by=0.02)],
    )
    scaled = build_scaled_plan(proposal, 1000, 800)
    assert len(scaled.walls) == 2


# --- loops and rooms ---------------------------------------------------------


def _square_walls(kind: str | None = "exterior") -> list[dict]:
    return [
        _wall(0.1, 0.1, 0.9, 0.1, kind),
        _wall(0.9, 0.1, 0.9, 0.9, kind),
        _wall(0.9, 0.9, 0.1, 0.9, kind),
        _wall(0.1, 0.9, 0.1, 0.1, kind),
    ]


def test_closed_loop_gives_one_room() -> None:
    from server.intake.cleanup import build_scaled_plan

    proposal = _proposal(
        _square_walls(), dimensions=[_dim("8,00 m", ay=0.02, by=0.02)]
    )
    scaled = build_scaled_plan(proposal, 1000, 1000)
    assert len(scaled.rooms) == 1
    assert len(scaled.rooms[0].polygon) >= 4
    assert scaled.warnings == ()


def test_open_loop_gives_no_rooms_with_warning() -> None:
    from server.intake.cleanup import build_scaled_plan

    proposal = _proposal(
        _square_walls()[:3], dimensions=[_dim("8,00 m", ay=0.02, by=0.02)]
    )
    scaled = build_scaled_plan(proposal, 1000, 1000)
    assert scaled.rooms == ()
    assert any("rooms_empty" in w for w in scaled.warnings)


# --- scale and frame ---------------------------------------------------------


def test_scale_full_width_anchor_gives_meters() -> None:
    from server.intake.cleanup import build_scaled_plan

    proposal = _proposal(
        [_wall(0.0, 0.5, 1.0, 0.5)], dimensions=[_dim("8,00 m", ay=0.02, by=0.02)]
    )
    scaled = build_scaled_plan(proposal, 1000, 800)
    assert scaled.scale_m_per_px == pytest.approx(0.008)
    (wall,) = scaled.walls
    assert wall.b[0] - wall.a[0] == pytest.approx(8.0)


def test_origin_is_bottom_left_after_y_flip() -> None:
    from server.intake.cleanup import build_scaled_plan

    proposal = _proposal(
        [
            _wall(0.0, 0.0, 1.0, 0.0),  # image top edge (y down)
            _wall(0.0, 1.0, 1.0, 1.0),  # image bottom edge
        ],
        dimensions=[_dim("8,00 m", ay=0.5, by=0.5)],
    )
    scaled = build_scaled_plan(proposal, 1000, 800)
    top, bottom = scaled.walls
    # Image top (y_norm=0) is the far side: max y in meters; min corner at 0.
    assert top.a[1] == pytest.approx(top.b[1])
    assert top.a[1] > bottom.a[1]
    assert min(p[1] for w in scaled.walls for p in (w.a, w.b)) == pytest.approx(0.0)


def test_no_dimensions_raises_scale_error() -> None:
    from server.intake.cleanup import ScaleError, build_scaled_plan

    proposal = _proposal([_wall(0.0, 0.1, 1.0, 0.1)], dimensions=[])
    with pytest.raises(ScaleError, match="[Hh]umano|correcci"):
        build_scaled_plan(proposal, 1000, 800)


# --- openings and kinds ------------------------------------------------------


def test_opening_fractions_become_meters() -> None:
    from server.intake.cleanup import build_scaled_plan

    proposal = _proposal(
        [_wall(0.0, 0.5, 1.0, 0.5)],
        openings=[{"wall_index": 0, "t0": 0.25, "t1": 0.5, "kind": "door"}],
        dimensions=[_dim("8,00 m", ay=0.02, by=0.02)],
    )
    scaled = build_scaled_plan(proposal, 1000, 800)
    (opening,) = scaled.openings
    assert opening.offset_m == pytest.approx(2.0)
    assert opening.width_m == pytest.approx(2.0)
    assert opening.kind == "door"


def test_null_kind_defaults_exterior_with_warning() -> None:
    from server.intake.cleanup import build_scaled_plan

    proposal = _proposal(
        [_wall(0.0, 0.1, 1.0, 0.1, None)], dimensions=[_dim("8,00 m", ay=0.02, by=0.02)]
    )
    scaled = build_scaled_plan(proposal, 1000, 800)
    assert scaled.walls[0].kind == "exterior"
    assert any("kind_defaulted" in w for w in scaled.warnings)


def test_to_scene_applies_documented_defaults() -> None:
    from server.intake.cleanup import build_scaled_plan, to_scene

    proposal = _proposal(
        _square_walls(),
        openings=[{"wall_index": 0, "t0": 0.2, "t1": 0.4, "kind": "door"}],
        dimensions=[_dim("8,00 m", ay=0.02, by=0.02)],
    )
    scene = to_scene(build_scaled_plan(proposal, 1000, 1000))
    assert scene.units == "m"
    assert scene.scale_confirmed is False  # auto anchor: human confirms (ADR-002)
    assert len(scene.walls) == 4
    assert len(scene.rooms) == 1
    (opening,) = scene.openings
    assert opening.kind == "door"
    assert opening.height_m == pytest.approx(2.05)
    assert scene.walls[0].thickness_m == pytest.approx(0.20)


def test_to_scene_window_defaults() -> None:
    from server.intake.cleanup import build_scaled_plan, to_scene

    proposal = _proposal(
        [_wall(0.0, 0.1, 1.0, 0.1)],
        openings=[{"wall_index": 0, "t0": 0.1, "t1": 0.3, "kind": "window"}],
        dimensions=[_dim("8,00 m", ay=0.02, by=0.02)],
    )
    scene = to_scene(build_scaled_plan(proposal, 1000, 800))
    (opening,) = scene.openings
    assert opening.height_m == pytest.approx(1.40)
    assert opening.sill_m == pytest.approx(0.80)


# --- metrics (F3 helpers) ----------------------------------------------------


def test_segment_iou_identical_is_one() -> None:
    from server.intake.metrics import segment_overlap_iou

    walls = [((0.0, 0.0), (8.0, 0.0)), ((0.0, 6.0), (8.0, 6.0))]
    assert segment_overlap_iou(walls, walls)["iou"] == pytest.approx(1.0)


def test_segment_iou_disjoint_is_zero() -> None:
    from server.intake.metrics import segment_overlap_iou

    a = [((0.0, 0.0), (1.0, 0.0))]
    b = [((5.0, 5.0), (6.0, 5.0))]
    assert segment_overlap_iou(a, b)["iou"] == pytest.approx(0.0)


def test_segment_iou_half_overlap_is_third() -> None:
    from server.intake.metrics import segment_overlap_iou

    a = [((0.0, 0.0), (2.0, 0.0))]
    b = [((1.0, 0.0), (3.0, 0.0))]
    # matched=1, total=2+2 -> 1/(2+2-1) = 1/3
    assert segment_overlap_iou(a, b)["iou"] == pytest.approx(1 / 3)


def test_segment_iou_split_walls_match() -> None:
    from server.intake.metrics import segment_overlap_iou

    truth = [((0.0, 0.0), (4.0, 0.0)), ((4.0, 0.0), (8.0, 0.0))]
    fixture = [((0.0, 0.0), (8.0, 0.0))]
    assert segment_overlap_iou(fixture, truth)["iou"] == pytest.approx(1.0)


def test_bbox_iou_identical_is_one() -> None:
    from server.intake.metrics import bbox_iou

    box = (0.0, 0.0, 8.0, 6.0)
    assert bbox_iou(box, box) == pytest.approx(1.0)
