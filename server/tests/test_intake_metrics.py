"""Intake metrics F3 helpers: wall_length_ratio + rooms_area_iou."""

from __future__ import annotations

import pytest

from server.intake.metrics import rooms_area_iou, wall_length_ratio


def _h(x0: float, x1: float, y: float = 0.0) -> tuple[tuple[float, float], tuple[float, float]]:
    return ((x0, y), (x1, y))


# --- wall_length_ratio ---------------------------------------------------------


def test_wall_length_ratio_equal_is_one() -> None:
    assert wall_length_ratio([_h(0, 8)], [_h(0, 4), _h(4, 8)]) == pytest.approx(1.0)


def test_wall_length_ratio_half() -> None:
    assert wall_length_ratio([_h(0, 4)], [_h(0, 8)]) == pytest.approx(0.5)


def test_wall_length_ratio_empty_truth_is_zero() -> None:
    assert wall_length_ratio([_h(0, 8)], []) == 0.0


def test_wall_length_ratio_both_empty_is_zero() -> None:
    assert wall_length_ratio([], []) == 0.0


# --- rooms_area_iou ------------------------------------------------------------


def test_rooms_area_iou_identical_is_one() -> None:
    polys = [[(0.0, 0.0), (8.0, 0.0), (8.0, 6.0), (0.0, 6.0)]]
    out = rooms_area_iou(polys, polys)
    assert out["iou"] == pytest.approx(1.0)
    assert out["fixture_m2"] == pytest.approx(48.0)
    assert out["truth_m2"] == pytest.approx(48.0)
    assert out["inter_m2"] == pytest.approx(48.0)


def test_rooms_area_iou_disjoint_is_zero() -> None:
    a = [[(0.0, 0.0), (4.0, 0.0), (4.0, 4.0), (0.0, 4.0)]]
    b = [[(5.0, 5.0), (9.0, 5.0), (9.0, 9.0), (5.0, 9.0)]]
    out = rooms_area_iou(a, b)
    assert out["iou"] == pytest.approx(0.0)
    assert out["inter_m2"] == pytest.approx(0.0)


def test_rooms_area_iou_half_overlap_is_third() -> None:
    a = [[(0.0, 0.0), (2.0, 0.0), (2.0, 2.0), (0.0, 2.0)]]
    b = [[(1.0, 0.0), (3.0, 0.0), (3.0, 2.0), (1.0, 2.0)]]
    # inter=2, union=4+4-2=6 -> 1/3
    out = rooms_area_iou(a, b)
    assert out["iou"] == pytest.approx(1 / 3)


def test_rooms_area_iou_empty_empty_is_one() -> None:
    assert rooms_area_iou([], [])["iou"] == pytest.approx(1.0)


def test_rooms_area_iou_one_empty_is_zero() -> None:
    a = [[(0.0, 0.0), (4.0, 0.0), (4.0, 4.0), (0.0, 4.0)]]
    assert rooms_area_iou(a, [])["iou"] == pytest.approx(0.0)
    assert rooms_area_iou([], a)["iou"] == pytest.approx(0.0)
