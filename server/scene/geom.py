"""Geometric tolerance helpers (HARDENING R4).

Central place for floating-point comparisons so every check uses the same
epsilon. Covers the opening/room/wall comparisons in validation.py.
"""

from __future__ import annotations

EPS = 1e-9

def approx_le(a: float, b: float, eps: float = EPS) -> bool:
    """True if a <= b within epsilon (a <= b + eps)."""
    return a <= b + eps

def approx_lt(a: float, b: float, eps: float = EPS) -> bool:
    """True if a < b beyond epsilon (a < b - eps)."""
    return a < b - eps

def approx_ge(a: float, b: float, eps: float = EPS) -> bool:
    """True if a >= b within epsilon (a + eps >= b)."""
    return a + eps >= b

def approx_gt(a: float, b: float, eps: float = EPS) -> bool:
    """True if a > b beyond epsilon (a > b + eps)."""
    return a > b + eps

def approx_eq(a: float, b: float, eps: float = EPS) -> bool:
    """True if |a - b| <= eps."""
    return abs(a - b) <= eps
