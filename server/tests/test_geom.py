"""Property-style checks for geom.approx_* (HARDENING R4)."""

from server.scene.geom import EPS, approx_eq, approx_ge, approx_gt, approx_le, approx_lt


def test_approx_le_boundary():
    assert approx_le(1.0, 1.0)
    assert approx_le(1.0, 1.0 + EPS)
    assert approx_le(1.0, 1.0 + EPS / 2)
    assert not approx_le(1.0 + 2 * EPS, 1.0)


def test_approx_lt_boundary():
    assert approx_lt(0.9, 1.0)
    assert not approx_lt(1.0, 1.0)
    assert not approx_lt(1.0 - EPS / 2, 1.0)


def test_approx_ge_gt_symmetry():
    assert approx_ge(1.0, 1.0)
    assert approx_gt(1.0 + 2 * EPS, 1.0)
    assert not approx_gt(1.0, 1.0)


def test_approx_eq():
    assert approx_eq(1.0, 1.0)
    assert approx_eq(1.0, 1.0 + EPS / 2)
    assert not approx_eq(1.0, 1.0 + 2 * EPS)
