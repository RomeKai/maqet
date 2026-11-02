"""Intake cleanup + scale tests (F2). TDD: RED before server/intake/cleanup.py exists.

Pure geometry in NORMALIZED image coords (0..1, y down). Scale (px -> m)
comes from ONE parsed anchor dimension; never invented (ADR-002).
"""

from __future__ import annotations

import math

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


def _dim(text: str, ax: float = 0.0, ay: float = 0.05, bx: float = 1.0, by: float = 0.05,
         wall_index: int | None = None) -> dict:
    return {"text": text, "a": [ax, ay], "b": [bx, by], "wall_index": wall_index}


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
    # Unassociated dimension: global guess only, all walls estimated (ADR-025).
    assert any("estimated" in w for w in scaled.warnings)
    assert not any("rooms_empty" in w for w in scaled.warnings)


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


# --- per-wall measures (ADR-025 mode C) -------------------------------------------


def test_associated_dimension_sets_exact_wall_length() -> None:
    from server.intake.cleanup import build_scaled_plan

    proposal = _proposal(
        [_wall(0.0, 0.5, 1.0, 0.5)],
        dimensions=[_dim("3,50", ay=0.02, by=0.02, wall_index=0)],
    )
    scaled = build_scaled_plan(proposal, 1000, 800)
    (wall,) = scaled.walls
    assert wall.measured_m == pytest.approx(3.5)
    assert math.dist(wall.a, wall.b) == pytest.approx(3.5)


def test_four_associated_measures_give_rectangle_not_square() -> None:
    """Non-proportional sketch: global scale would keep the drawn square.

    Per-wall solve must produce a 4.0 x 3.0 rectangle instead.
    """
    import math

    from server.intake.cleanup import build_scaled_plan

    proposal = _proposal(
        _square_walls(),
        dimensions=[
            _dim("4,00", ax=0.1, ay=0.02, bx=0.9, by=0.02, wall_index=0),
            _dim("3,00", ax=0.98, ay=0.1, bx=0.98, by=0.9, wall_index=1),
            _dim("4,00", ax=0.1, ay=0.98, bx=0.9, by=0.98, wall_index=2),
            _dim("3,00", ax=0.02, ay=0.1, bx=0.02, by=0.9, wall_index=3),
        ],
    )
    scaled = build_scaled_plan(proposal, 1000, 1000)
    lengths = sorted(math.dist(w.a, w.b) for w in scaled.walls)
    assert lengths[0] == pytest.approx(3.0, abs=0.05)
    assert lengths[1] == pytest.approx(3.0, abs=0.05)
    assert lengths[2] == pytest.approx(4.0, abs=0.05)
    assert lengths[3] == pytest.approx(4.0, abs=0.05)
    assert all(w.measured_m is not None for w in scaled.walls)
    assert not any("estimated" in w for w in scaled.warnings)


def test_unmeasured_wall_stays_estimated() -> None:
    from server.intake.cleanup import build_scaled_plan, to_scene

    proposal = _proposal(
        [_wall(0.0, 0.2, 1.0, 0.2), _wall(0.0, 0.8, 1.0, 0.8)],
        dimensions=[_dim("3,50", ay=0.02, by=0.02, wall_index=0)],
    )
    scaled = build_scaled_plan(proposal, 1000, 800)
    assert scaled.walls[0].measured_m == pytest.approx(3.5)
    assert scaled.walls[1].measured_m is None
    assert any("estimated" in w for w in scaled.warnings)
    scene = to_scene(scaled)
    assert scene.walls[0].provenance == "written_on_sketch"
    assert scene.walls[0].measured_length_m == pytest.approx(3.5)
    assert scene.walls[1].provenance == "estimated"
    assert scene.walls[1].measured_length_m is None
    assert scene.scale_confirmed is False


def test_conflicting_measures_warn_and_leave_unmeasured() -> None:
    """Genuine conflict with no supporting opposite wall: no silent min.

    Neither value is invented as truth: the wall stays unmeasured (estimated)
    and the warning carries both values for the human (ADR-002).
    """
    from server.intake.cleanup import build_scaled_plan

    proposal = _proposal(
        [_wall(0.0, 0.5, 1.0, 0.5)],
        dimensions=[
            _dim("3,50", ay=0.02, by=0.02, wall_index=0),
            _dim("4,00", ay=0.1, by=0.1, wall_index=0),
        ],
    )
    scaled = build_scaled_plan(proposal, 1000, 800)
    assert scaled.walls[0].measured_m is None
    matches = [w for w in scaled.warnings if "contradiction" in w]
    assert len(matches) == 1
    assert "3.50" in matches[0] and "4.00" in matches[0]
    assert any("estimated" in w for w in scaled.warnings)


def _door_window_proposal() -> IntakeProposal:
    """Exact failing phone case: 3x8 croquis, door + window labels, null dim."""
    return IntakeProposal.model_validate(
        {
            "dimensions": [
                {"a": [0.115, 0.165], "b": [0.83, 0.17], "text": "3.00m", "wall_index": 0},
                {"a": [0.825, 0.768], "b": [0.165, 0.808], "text": "3.00 m", "wall_index": 2},
                {"a": [0.88, 0.22], "b": [0.875, 0.76], "text": "8.00 m", "wall_index": 1},
                {"a": [0.827, 0.602], "b": [0.826, 0.707], "text": "1m", "wall_index": 1},
                {"a": [0.06, 0.44], "b": [0.06, 0.56], "text": "1.50m", "wall_index": 3},
                {"a": [0.25, 0.38], "b": [0.275, 0.53], "text": "8.00", "wall_index": None},
            ],
            "input_kind": "sketch",
            "labels": [],
            "openings": [
                {"kind": "door", "t0": 0.46, "t1": 0.61, "wall_index": 3},
                {"kind": "window", "t0": 0.7, "t1": 0.89, "wall_index": 1},
            ],
            "walls": [
                {"a": [0.11, 0.205], "b": [0.832, 0.215], "kind": None},
                {"a": [0.832, 0.215], "b": [0.825, 0.768], "kind": None},
                {"a": [0.825, 0.768], "b": [0.165, 0.808], "kind": None},
                {"a": [0.165, 0.808], "b": [0.11, 0.205], "kind": None},
            ],
        }
    )


def test_croquis_3x8_opening_widths_come_from_labels() -> None:
    """Mode C phone case: dims overlapping an opening span are opening widths.

    Walls solve to 3.00/8.00/3.00/8.00 m, door 1.50 m (wall 4), window
    1.00 m (wall 2). No contradiction warning: nothing genuinely conflicts.
    """
    from server.intake.cleanup import build_scaled_plan

    scaled = build_scaled_plan(_door_window_proposal(), 1000, 1000)
    lengths = [math.dist(w.a, w.b) for w in scaled.walls]
    assert lengths == pytest.approx([3.0, 8.0, 3.0, 8.0], abs=0.05)
    assert [w.measured_m for w in scaled.walls] == pytest.approx([3.0, 8.0, 3.0, 8.0])
    by_wall = {op.wall_index: op for op in scaled.openings}
    assert by_wall[3].width_m == pytest.approx(1.5)
    assert by_wall[1].width_m == pytest.approx(1.0)
    assert by_wall[3].kind == "door"
    assert by_wall[1].kind == "window"
    assert not any("contradiction" in w for w in scaled.warnings)
    assert sum("opening" in w for w in scaled.warnings) == 2


def test_null_wall_index_assigns_to_nearest_parallel_wall() -> None:
    """A wall_index=null dim joins the nearest wall parallel to its direction."""
    from server.intake.cleanup import build_scaled_plan

    proposal = _proposal(
        [
            _wall(0.1, 0.2, 0.9, 0.2),
            _wall(0.1, 0.8, 0.9, 0.8),
        ],
        dimensions=[
            _dim("4,00", ax=0.1, ay=0.05, bx=0.9, by=0.05, wall_index=0),
            _dim("5,00", ax=0.2, ay=0.75, bx=0.8, by=0.75, wall_index=None),
        ],
    )
    scaled = build_scaled_plan(proposal, 1000, 800)
    assert scaled.walls[0].measured_m == pytest.approx(4.0)
    assert scaled.walls[1].measured_m == pytest.approx(5.0)
    assert not any("contradiction" in w for w in scaled.warnings)


def test_null_wall_index_with_no_parallel_wall_warns_unassigned() -> None:
    """A null dim parallel to nothing is left out loudly, never invented."""
    from server.intake.cleanup import build_scaled_plan

    proposal = _proposal(
        [_wall(0.1, 0.2, 0.9, 0.2)],
        dimensions=[
            _dim("4,00", ax=0.1, ay=0.05, bx=0.9, by=0.05, wall_index=0),
            _dim("9,99", ax=0.2, ay=0.3, bx=0.4, by=0.7, wall_index=None),
        ],
    )
    scaled = build_scaled_plan(proposal, 1000, 800)
    assert scaled.walls[0].measured_m == pytest.approx(4.0)
    assert any("unassigned" in w for w in scaled.warnings)


def test_conflicting_measures_prefer_opposite_parallel_value() -> None:
    """Genuine conflict resolved by the opposite parallel wall's measure.

    Wall 1 says 3.50 vs 4.00; opposite wall 3 measures 4.00: keep 4.00 and
    say why. The rectangle then solves to 4.00 x 3.00.
    """
    from server.intake.cleanup import build_scaled_plan

    proposal = _proposal(
        _square_walls(),
        dimensions=[
            _dim("3,50", ax=0.1, ay=0.02, bx=0.9, by=0.02, wall_index=0),
            _dim("4,00", ax=0.1, ay=0.06, bx=0.9, by=0.06, wall_index=0),
            _dim("3,00", ax=0.98, ay=0.1, bx=0.98, by=0.9, wall_index=1),
            _dim("4,00", ax=0.1, ay=0.98, bx=0.9, by=0.98, wall_index=2),
            _dim("3,00", ax=0.02, ay=0.1, bx=0.02, by=0.9, wall_index=3),
        ],
    )
    scaled = build_scaled_plan(proposal, 1000, 1000)
    assert scaled.walls[0].measured_m == pytest.approx(4.0)
    matches = [w for w in scaled.warnings if "contradiction" in w]
    assert len(matches) == 1
    assert "4.00" in matches[0] and "opposite wall 3" in matches[0]
    lengths = sorted(math.dist(w.a, w.b) for w in scaled.walls)
    assert lengths == pytest.approx([3.0, 3.0, 4.0, 4.0], abs=0.05)


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


def test_near_miss_loop_snaps_shut() -> None:
    """Sketch loop whose last endpoint misses the first by ~0.03 normalized.

    The cached 3x8 phone sketch has a clean 4-wall loop whose final corner
    misses by ~0.03; without snapping the loop stays open (rooms_empty,
    duplicate corners, diagonal in 3D). The fix snaps endpoints within
    ENDPOINT_SNAP_TOL before loop detection so a closed loop stays closed.
    """
    import math

    from server.intake.cleanup import build_scaled_plan

    proposal = _proposal(
        [
            _wall(0.11, 0.205, 0.832, 0.215),
            _wall(0.832, 0.215, 0.825, 0.768),
            _wall(0.825, 0.768, 0.165, 0.808),
            _wall(0.165, 0.808, 0.14, 0.235),
        ],
        dimensions=[
            _dim("3.00", ax=0.11, ay=0.165, bx=0.832, by=0.17, wall_index=0),
            _dim("8.00 m", ax=0.88, ay=0.22, bx=0.875, by=0.76, wall_index=1),
            _dim("3.00 m", ax=0.825, ay=0.728, bx=0.165, by=0.768, wall_index=2),
            _dim("8.00 m", ax=0.06, ay=0.44, bx=0.06, by=0.56, wall_index=3),
        ],
    )
    scaled = build_scaled_plan(proposal, 1000, 1000)
    assert len(scaled.walls) == 4
    lengths = sorted(math.dist(w.a, w.b) for w in scaled.walls)
    assert lengths == pytest.approx([3.0, 3.0, 8.0, 8.0], abs=0.05)
    assert len(scaled.rooms) == 1
    assert not any("rooms_empty" in w for w in scaled.warnings)


def test_leftover_short_dim_surfaces_possible_opening() -> None:
    """A short leftover dim on a measured wall is a hint, not a contradiction.

    Wall measures 8.00 m plus a stray "1m" with no matching opening: the
    wall keeps 8.0 m and the leftover surfaces as a possible unmodeled
    opening for the human (ADR-002).
    """
    from server.intake.cleanup import build_scaled_plan

    proposal = _proposal(
        [_wall(0.0, 0.5, 1.0, 0.5)],
        dimensions=[
            _dim("8,00 m", ay=0.02, by=0.02, wall_index=0),
            _dim("1m", ax=0.4, ay=0.1, bx=0.5, by=0.1, wall_index=0),
        ],
    )
    scaled = build_scaled_plan(proposal, 1000, 800)
    assert scaled.walls[0].measured_m == pytest.approx(8.0)
    assert any("possible opening" in w for w in scaled.warnings)
    assert not any("contradiction" in w for w in scaled.warnings)


def test_label_just_outside_the_wall_radius_still_measures_a_wall_with_no_measure() -> None:
    """Finding 4: a written '8.00' ~0.18 from its wall (live readings drift) was dropped, leaving W4 estimated."""
    import json
    import math
    from pathlib import Path

    from server.intake.cleanup import build_scaled_plan, to_scene
    from server.intake.schemas import IntakeProposal

    data = json.loads((Path(__file__).resolve().parents[2] / "samples/plans/croquis_3x8_door_window.proposal.json").read_text("utf-8"))
    for dim in data["proposal"]["dimensions"]:
        if dim["text"] == "8.00":
            dim["a"][0] += 0.05
            dim["b"][0] += 0.05
    plan = build_scaled_plan(IntakeProposal.model_validate(data["proposal"]), data["image"]["w"], data["image"]["h"])
    scene = to_scene(plan)
    lengths = [round(math.dist(w.a, w.b), 2) for w in scene.walls]
    assert lengths == [3.0, 8.0, 3.0, 8.0]
    assert all(w.provenance == "written_on_sketch" for w in scene.walls)
    assert any("assigned" in w and "8.00" in w for w in plan.warnings), plan.warnings


def _sample_scene(mutate):  # type: ignore[no-untyped-def]
    import json
    from pathlib import Path

    from server.intake.cleanup import build_scaled_plan, to_scene
    from server.intake.schemas import IntakeProposal

    data = json.loads((Path(__file__).resolve().parents[2] / "samples/plans/croquis_3x8_door_window.proposal.json").read_text("utf-8"))
    mutate(data["proposal"])
    plan = build_scaled_plan(IntakeProposal.model_validate(data["proposal"]), data["image"]["w"], data["image"]["h"])
    return plan, to_scene(plan)


def test_written_door_width_wins_even_when_its_label_sits_off_the_opening() -> None:
    """Finding 5: the '1.50m' label drawn beside, not over, the door must still be the door width (never t1-t0 of the drawing)."""

    def move_label(p: dict) -> None:  # type: ignore[type-arg]
        for dim in p["dimensions"]:
            if dim["text"] == "1.50m":
                dim["a"][1] -= 0.30  # far above the door span along the wall
                dim["b"][1] -= 0.30
        # The model also drew the door much wider than the written 1.50 m.
        for op in p["openings"]:
            if op["kind"] == "door":
                op["t0"], op["t1"] = 0.20, 0.80

    plan, scene = _sample_scene(move_label)
    door = next(o for o in scene.openings if o.kind == "door")
    window = next(o for o in scene.openings if o.kind == "window")
    assert door.width_m == pytest.approx(1.5, abs=0.01)
    assert window.width_m == pytest.approx(1.0, abs=0.01)


def test_unlabeled_opening_width_is_flagged_as_taken_from_the_drawing() -> None:
    def drop_labels(p: dict) -> None:  # type: ignore[type-arg]
        p["dimensions"] = [d for d in p["dimensions"] if d["text"] not in ("1.50m", "1m")]

    plan, _scene = _sample_scene(drop_labels)
    assert any(w.startswith("opening_estimated") for w in plan.warnings), plan.warnings
