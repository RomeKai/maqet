"""Vision intake schemas (F1): proposals in NORMALIZED image coordinates.

The Spark vision call returns wall/opening/label proposals in normalized image
coordinates (0..1, x right, y down, origin top-left of the uploaded image).
Written measurements (dimensions) are transcribed VERBATIM -- comma or point
decimals ("3,50", "2.80 m") -- and never invented. Scale math (px -> m) is F2,
not here: F1 only carries `dimensions` through validated.
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

UnitFloat = Annotated[float, Field(ge=0.0, le=1.0)]
NormPoint = tuple[UnitFloat, UnitFloat]
InputKind = Literal["plan", "sketch"]


class IntakeWall(BaseModel):
    model_config = ConfigDict(extra="forbid")

    a: NormPoint
    b: NormPoint
    kind: Literal["exterior", "interior"] | None


class IntakeOpening(BaseModel):
    model_config = ConfigDict(extra="forbid")

    wall_index: int = Field(ge=0)
    t0: UnitFloat
    t1: UnitFloat
    kind: Literal["door", "window"]

    @model_validator(mode="after")
    def _ordered_span(self) -> IntakeOpening:
        if self.t0 > self.t1:
            raise ValueError(f"t0 ({self.t0}) must be <= t1 ({self.t1})")
        return self


class IntakeLabel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str = Field(min_length=1)
    at: NormPoint


class IntakeDimension(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Written measurement transcribed verbatim, e.g. "3,50" or "2.80 m".
    # Kept as text on purpose: decimal commas must survive, and parsing the
    # value into meters is F2 scale math, not F1.
    text: str = Field(min_length=1)
    a: NormPoint
    b: NormPoint


class IntakeProposal(BaseModel):
    model_config = ConfigDict(extra="forbid")

    input_kind: InputKind
    walls: list[IntakeWall]
    openings: list[IntakeOpening]
    labels: list[IntakeLabel]
    dimensions: list[IntakeDimension]

    @model_validator(mode="after")
    def _openings_reference_walls(self) -> IntakeProposal:
        for i, opening in enumerate(self.openings):
            if opening.wall_index >= len(self.walls):
                raise ValueError(
                    f"openings[{i}].wall_index={opening.wall_index} out of range "
                    f"for {len(self.walls)} walls"
                )
        return self
