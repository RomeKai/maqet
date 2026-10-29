"""Aligned wall dimensions (dxf-full-export).

One DIMENSION per wall on A-ANNO-DIMS. The measurement is the computed wall
length (geometry is the measured source of truth); the dimension line sits
outside the wall footprint. Callers must not type numbers by hand.
"""

from __future__ import annotations

import math

from ezdxf.entities import Dimension
from ezdxf.layouts import Modelspace

from server.scene.models import Wall

DIM_LINE_CLEARANCE_M = 0.5  # dimline offset beyond the wall face


def add_wall_dimension(msp: Modelspace, wall: Wall) -> Dimension | None:
    """Add an aligned dimension along the wall centerline. None if degenerate."""
    (ax, ay), (bx, by) = tuple(wall.a), tuple(wall.b)
    if math.dist((ax, ay), (bx, by)) <= 0:
        return None
    dim = msp.add_aligned_dim(
        p1=(ax, ay),
        p2=(bx, by),
        distance=wall.thickness_m / 2.0 + DIM_LINE_CLEARANCE_M,
        dxfattribs={"layer": "A-ANNO-DIMS"},
    )
    dim.render()
    return dim
