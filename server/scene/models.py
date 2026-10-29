"""Scene models (ADR-001): the single measured source of truth.

Units are meters. The plan origin sits at the bottom-left, room polygons are
counter-clockwise, Z is up for 3D. Every output (3D, AR, render, DXF, takeoff)
is derived from this document; nothing stores geometry anywhere else.
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

Point2D = tuple[float, float]


class _FiniteModel(BaseModel):
    """Every float in the Scene is a real measurement: NaN and +/-inf are
    rejected at the boundary (JSON from the client or the model can carry
    them) instead of crashing shapely or reaching the DXF."""

    model_config = ConfigDict(allow_inf_nan=False)


def _positive_dims(v: tuple[float, ...], name: str) -> tuple[float, ...]:
    if any(d <= 0 for d in v):
        raise ValueError(f"{name} components must be > 0")
    return v

# Room functions known to the intake pipeline (free-form string on purpose:
# sketches may carry labels outside this list; habitable ones are checked by
# rules.py). Convention: "living" | "kitchen" | "bedroom" | "bath" | ...
HABITABLE_FUNCTIONS = frozenset({"living", "kitchen", "bedroom", "dining"})


class Wall(_FiniteModel):
    id: str = Field(min_length=1)
    a: Point2D
    b: Point2D
    thickness_m: float = Field(gt=0)
    kind: Literal["exterior", "interior"]
    height_m: float | None = Field(default=None, gt=0)
    # Structural role as surveyed by the technician. Drives the
    # load-bearing professional flag on remove_wall (ADR-023).
    load_bearing: bool = False
    # ADR-025: how this wall length was measured. `estimated` walls render
    # with the distinct estimated style until the technician confirms them.
    provenance: Literal[
        "measured_ar", "measured_tape", "written_on_sketch", "estimated"
    ] = "estimated"
    # Real length in meters when provenance != estimated (per-wall measure).
    measured_length_m: float | None = Field(default=None, gt=0)

    @model_validator(mode="after")
    def _non_zero_length(self) -> Wall:
        if tuple(self.a) == tuple(self.b):
            raise ValueError("wall endpoints a and b must differ (zero-length wall)")
        return self


class Opening(_FiniteModel):
    id: str = Field(min_length=1)
    wall_id: str = Field(min_length=1)
    kind: Literal["door", "window"]
    offset_m: float = Field(ge=0)
    width_m: float = Field(gt=0)
    height_m: float = Field(gt=0)
    sill_m: float | None = Field(default=None, ge=0)


class Room(_FiniteModel):
    id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    polygon: list[Point2D] = Field(min_length=3)
    function: str | None = None
    # 1 = ground floor. Upper levels have no walls of their own yet: they
    # never take part in wall polygonization and only overlap rooms on the
    # same level. Optional so Scenes saved before levels still validate.
    level: int = Field(default=1, ge=1)


class RoomSurfaceTarget(_FiniteModel):
    type: Literal["room"] = "room"
    room_id: str = Field(min_length=1)
    part: Literal["floor", "ceiling"]


class WallSurfaceTarget(_FiniteModel):
    type: Literal["wall"] = "wall"
    wall_id: str = Field(min_length=1)
    side: Literal["left", "right"]


SurfaceTarget = Annotated[
    RoomSurfaceTarget | WallSurfaceTarget, Field(discriminator="type")
]


class Surface(_FiniteModel):
    id: str = Field(min_length=1)
    target: SurfaceTarget
    material_id: str = Field(min_length=1)


class Furniture(_FiniteModel):
    id: str = Field(min_length=1)
    catalog_id: str | None = None
    concept_id: str | None = None
    room_id: str = Field(min_length=1)
    # position is the footprint center in meters.
    position: Point2D
    rotation_deg: float = 0.0
    size_m: tuple[float, float, float]  # (width, depth, height)

    concept: bool = False

    @field_validator("size_m")
    @classmethod
    def _positive_size(cls, v: tuple[float, float, float]) -> tuple[float, float, float]:
        return _positive_dims(v, "size_m")


class Material(_FiniteModel):
    id: str = Field(min_length=1)
    source: Literal["catalog", "generated"]
    catalog_id: str | None = None
    texture_url: str | None = None
    prompt: str | None = None
    tiling_m: Point2D = (1.0, 1.0)
    concept: bool = False

    @field_validator("tiling_m")
    @classmethod
    def _positive_tiling(cls, v: Point2D) -> Point2D:
        return _positive_dims(v, "tiling_m")


class Scene(_FiniteModel):
    id: str = Field(min_length=1)
    version: int = Field(default=0, ge=0)
    units: Literal["m"] = "m"
    scale_confirmed: bool = False
    ceiling_height_m: float = Field(default=2.6, gt=0)
    walls: list[Wall] = Field(default_factory=list)
    openings: list[Opening] = Field(default_factory=list)
    rooms: list[Room] = Field(default_factory=list)
    surfaces: list[Surface] = Field(default_factory=list)
    furniture: list[Furniture] = Field(default_factory=list)
    materials: list[Material] = Field(default_factory=list)
    # Stable needs_professional:* codes raised by ops (rules.PRO_FLAG_*).
    # Append-only via ops; optional so older Scene JSON still validates.
    professional_flags: list[str] = Field(default_factory=list)
