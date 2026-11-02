"""Aligned wall dimensions (dxf-full-export).

One DIMENSION per wall on A-ANNO-DIMS. The measurement is the computed wall
length (geometry is the measured source of truth); the dimension line sits
outside the wall footprint. Callers must not type numbers by hand.

The displayed text is meters with 2 decimals: ezdxf's default "EZDXF"
dimstyle shows meters as centimeters (dimlfac=100), so the scale factor is
overridden per dimension. Estimated walls (ADR-025) say so in the text.
"""

from __future__ import annotations

import math

from ezdxf.entities import Dimension
from ezdxf.layouts import Modelspace

from server.scene.models import Opening, Wall

DIM_LINE_CLEARANCE_M = 0.5  # dimline offset beyond the wall face
DIM_DECIMALS = 2  # centimeter precision, matches a tape reading
# "<>" is replaced by the measured length; dimlfac=1 keeps it in meters,
# dimzin=0 keeps trailing zeros ("2.00 m", not "2 m") so precision reads.
DIM_OVERRIDE = {"dimlfac": 1.0, "dimdec": DIM_DECIMALS, "dimzin": 0}
MEASURED_TEXT = "<> m"
ESTIMATED_TEXT = "<> m (estimated)"


def add_wall_dimension(msp: Modelspace, wall: Wall) -> Dimension | None:
    """Add an aligned dimension along the wall centerline. None if degenerate."""
    (ax, ay), (bx, by) = tuple(wall.a), tuple(wall.b)
    if math.dist((ax, ay), (bx, by)) <= 0:
        return None
    dim = msp.add_aligned_dim(
        p1=(ax, ay),
        p2=(bx, by),
        distance=wall.thickness_m / 2.0 + DIM_LINE_CLEARANCE_M,
        text=ESTIMATED_TEXT if wall.provenance == "estimated" else MEASURED_TEXT,
        override=DIM_OVERRIDE,
        dxfattribs={"layer": "A-ANNO-DIMS"},
    )
    dim.render()
    return dim


OPENING_DIM_CLEARANCE_M = 0.35  # opening dimline offset on the side opposite the wall dimensions
OPENING_TEXT = "<> m"


def add_opening_dimension(msp: Modelspace, wall: Wall, opening: Opening) -> Dimension | None:
    """Dimension an opening's width along the wall, on the side opposite the wall-length dimension. None if degenerate."""
    (ax, ay), (bx, by) = tuple(wall.a), tuple(wall.b)
    length = math.dist((ax, ay), (bx, by))
    if length <= 0 or opening.width_m <= 0:
        return None
    ux, uy = (bx - ax) / length, (by - ay) / length
    start = max(0.0, opening.offset_m)
    end = min(length, opening.offset_m + opening.width_m)
    if end - start <= 0:
        return None
    dim = msp.add_aligned_dim(
        p1=(ax + ux * start, ay + uy * start),
        p2=(ax + ux * end, ay + uy * end),
        distance=-(wall.thickness_m / 2.0 + OPENING_DIM_CLEARANCE_M),
        text=OPENING_TEXT,
        override=DIM_OVERRIDE,
        dxfattribs={"layer": "A-ANNO-DIMS"},
    )
    dim.render()
    return dim
