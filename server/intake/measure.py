"""Mode B (ADR-025): room photo + tapped lengths -> per-wall tape measures.

The technician photographs a room, taps two points on a wall and types its
length ("3,50" or "3.50"), attached to a wall of the outline drawn in the
plan view. Server side that is just a per-wall length, so it enters the SAME
pipeline as mode C (``build_scaled_plan`` -> ``solve_vertices``); the only
difference is the provenance label, ``measured_tape`` (``to_scene(...,
measured_provenance=MEASURED_TAPE)``). Pure; never invents a measure (ADR-002).

Opening taps (doors/windows tapped on the photo) are cut_if_late: not here.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final

from server.intake.cleanup import ScaledPlan, build_scaled_plan, parse_dimension_meters
from server.intake.schemas import IntakeDimension, IntakeProposal, IntakeWall

MEASURED_TAPE: Final = "measured_tape"


class MeasureError(ValueError):
    """A tapped measure that cannot be used: ask the technician to retype it."""


@dataclass(frozen=True)
class TappedLength:
    """A length typed by the technician for one wall of the outline."""

    wall_index: int
    length: str  # as typed: comma or point decimals


def build_tapped_plan(
    walls: Sequence[IntakeWall],
    taps: Sequence[TappedLength],
    plan_w: int,
    plan_h: int,
) -> ScaledPlan:
    """Outline (normalized plan-view coords) + tapped lengths -> measured plan.

    ``plan_w``/``plan_h`` are the plan-view canvas size in px. Each tapped
    length is carried as a dimension spanning its own wall, so the shared
    solver sees exactly what it sees in mode C. Walls without a tap stay
    estimated and are flagged; contradictions are warned, never averaged.
    Raises MeasureError for an unreadable length or an unknown wall, and
    ScaleError (from the shared pipeline) when there is no tap at all.
    """
    dimensions: list[IntakeDimension] = []
    for tap in taps:
        if not 0 <= tap.wall_index < len(walls):
            raise MeasureError(
                f"tap refers to wall {tap.wall_index}, but the outline has "
                f"{len(walls)} walls: pick an existing wall"
            )
        if parse_dimension_meters(tap.length) is None:
            raise MeasureError(
                f"unreadable length {tap.length!r} for wall {tap.wall_index}: "
                "retype it (e.g. '3,50')"
            )
        wall = walls[tap.wall_index]
        dimensions.append(
            IntakeDimension(
                text=tap.length, a=wall.a, b=wall.b, wall_index=tap.wall_index
            )
        )
    proposal = IntakeProposal(
        input_kind="sketch",
        walls=list(walls),
        openings=[],
        labels=[],
        dimensions=dimensions,
    )
    return build_scaled_plan(proposal, plan_w, plan_h)


__all__ = ["MEASURED_TAPE", "MeasureError", "TappedLength", "build_tapped_plan"]
