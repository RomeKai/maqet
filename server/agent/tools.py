"""Agent tool input contracts (reform-agent skill).

One pydantic model per tool. Explicit IDs plus optional semantic hints
(`next_to` / `between` / `and` / `wall` / `room`, `selected` tap context);
anchors resolve deterministically in the executor — the model never invents
coordinates. Geometry the model never sends is derived there (room rectangles
east-adjacent to the anchor bbox, opening offsets from `at_ratio`).
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class SelectedRef(BaseModel):
    """Tap selection arriving as context ("this" / "esto" refers to it)."""

    kind: str = Field(min_length=1)
    id: str = Field(min_length=1)


class AddRoomInput(BaseModel):
    function: str = "bedroom"
    name: str | None = None
    room_id: str | None = None
    next_to: str | None = None
    room: str | None = None
    polygon: list[tuple[float, float]] | None = None
    size_m: tuple[float, float] = (3.0, 3.0)
    level: int = 1
    foundation_unknown_soil: bool = False
    selected: SelectedRef | None = None


class AddWallInput(BaseModel):
    wall_id: str | None = None
    a: tuple[float, float]
    b: tuple[float, float]
    thickness_m: float = Field(default=0.10, gt=0)
    kind: Literal["exterior", "interior"] = "interior"


class RemoveWallInput(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    wall_id: str | None = None
    wall: str | None = None
    between: str | None = None
    and_: str | None = Field(default=None, alias="and")
    selected: SelectedRef | None = None


class AddOpeningInput(BaseModel):
    opening_id: str | None = None
    wall_id: str | None = None
    wall: str | None = None
    kind: Literal["door", "window"] = "door"
    at_ratio: float = Field(default=0.5, ge=0.0, le=1.0)
    offset_m: float | None = Field(default=None, ge=0.0)
    width_m: float | None = Field(default=None, gt=0.0)
    height_m: float | None = Field(default=None, gt=0.0)
    sill_m: float | None = Field(default=None, ge=0.0)
    selected: SelectedRef | None = None


class MoveOpeningInput(BaseModel):
    opening_id: str | None = None
    opening: str | None = None
    new_offset_m: float | None = Field(default=None, ge=0.0)
    at_ratio: float | None = Field(default=None, ge=0.0, le=1.0)
    selected: SelectedRef | None = None


class UndoInput(BaseModel):
    pass


class ListCatalogInput(BaseModel):
    query: str | None = None


class PlaceFurnitureInput(BaseModel):
    catalog_id: str
    item_id: str | None = None
    room_id: str | None = None
    room: str | None = None
    anchor: str | None = None
    selected: SelectedRef | None = None


class MoveItemInput(BaseModel):
    item_id: str | None = None
    item: str | None = None
    position: tuple[float, float] | None = None
    selected: SelectedRef | None = None


class RotateItemInput(BaseModel):
    item_id: str | None = None
    item: str | None = None
    rotation_deg: float = 0.0
    selected: SelectedRef | None = None


class RemoveItemInput(BaseModel):
    item_id: str | None = None
    item: str | None = None
    selected: SelectedRef | None = None


class CreateVariantInput(BaseModel):
    label: str = "B"
    from_variant: str = "A"


class RenderViewInput(BaseModel):
    variant: str = "A"
    camera: str = "iso"


TOOL_MODELS: dict[str, type[BaseModel]] = {
    "add_room": AddRoomInput,
    "add_wall": AddWallInput,
    "remove_wall": RemoveWallInput,
    "add_opening": AddOpeningInput,
    "move_opening": MoveOpeningInput,
    "undo": UndoInput,
    "list_catalog": ListCatalogInput,
    "place_furniture": PlaceFurnitureInput,
    "move_item": MoveItemInput,
    "rotate_item": RotateItemInput,
    "remove_item": RemoveItemInput,
    "create_variant": CreateVariantInput,
    "render_view": RenderViewInput,
}
