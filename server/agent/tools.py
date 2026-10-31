"""Agent tool input contracts (reform-agent skill).

One pydantic model per tool. Explicit IDs plus optional semantic hints
(`next_to` / `between` / `and` / `wall` / `room`, `selected` tap context);
anchors resolve deterministically in the executor — the model never invents
coordinates. Geometry the model never sends is derived there (room rectangles
east-adjacent to the anchor bbox, opening offsets from `at_ratio`).
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class _ToolInput(BaseModel):
    """Model-sent JSON may carry NaN/Infinity literals: reject them here so
    the executor answers tool.invalid_args instead of building geometry."""

    model_config = ConfigDict(allow_inf_nan=False)


class SelectedRef(_ToolInput):
    """Tap selection arriving as context ("this" / "esto" refers to it)."""

    kind: str = Field(min_length=1)
    id: str = Field(min_length=1)


class AddRoomInput(_ToolInput):
    function: str = "bedroom"
    name: str | None = None
    room_id: str | None = None
    next_to: str | None = None
    room: str | None = None
    # Wall to attach to: a label ("wall 2") or id. Omit to let code pick a free wall.
    wall: str | None = None
    # Side of the anchor room to attach to: north/south/east/west.
    side: str | None = None
    polygon: list[tuple[float, float]] | None = Field(default=None, min_length=3)
    # [width along the attached wall, depth outward]: exactly what the user said.
    size_m: tuple[
        Annotated[float, Field(gt=0)], Annotated[float, Field(gt=0)]
    ] = (3.0, 3.0)
    level: int = 1
    foundation_unknown_soil: bool = False
    selected: SelectedRef | None = None


class AddWallInput(_ToolInput):
    wall_id: str | None = None
    a: tuple[float, float]
    b: tuple[float, float]
    thickness_m: float = Field(default=0.10, gt=0)
    kind: Literal["exterior", "interior"] = "interior"

    @model_validator(mode="after")
    def _non_zero_length(self) -> AddWallInput:
        if tuple(self.a) == tuple(self.b):
            raise ValueError("a and b must differ (zero-length wall)")
        return self


class RemoveWallInput(_ToolInput):
    model_config = ConfigDict(populate_by_name=True)

    wall_id: str | None = None
    wall: str | None = None
    # Room-aware addressing (resolved in code): room name/id or "new" + a side.
    room: str | None = None
    side: str | None = None
    between: str | None = None
    and_: str | None = Field(default=None, alias="and")
    selected: SelectedRef | None = None


class AddOpeningInput(_ToolInput):
    opening_id: str | None = None
    wall_id: str | None = None
    wall: str | None = None
    # Room-aware addressing (resolved in code): room name/id or "new" + a side.
    room: str | None = None
    side: str | None = None
    kind: Literal["door", "window"] = "door"
    at_ratio: float = Field(default=0.5, ge=0.0, le=1.0)
    offset_m: float | None = Field(default=None, ge=0.0)
    width_m: float | None = Field(default=None, gt=0.0)
    height_m: float | None = Field(default=None, gt=0.0)
    sill_m: float | None = Field(default=None, ge=0.0)
    selected: SelectedRef | None = None


class MoveOpeningInput(_ToolInput):
    opening_id: str | None = None
    opening: str | None = None
    new_offset_m: float | None = Field(default=None, ge=0.0)
    at_ratio: float | None = Field(default=None, ge=0.0, le=1.0)
    selected: SelectedRef | None = None


class ResizeRoomInput(_ToolInput):
    room: str | None = None
    width_m: float = Field(gt=0)
    depth_m: float = Field(gt=0)
    selected: SelectedRef | None = None


class SetWallLengthInput(_ToolInput):
    wall: str | None = None
    # Room-aware addressing (resolved in code): room name/id or "new" + a side.
    room: str | None = None
    side: str | None = None
    length_m: float = Field(gt=0)
    selected: SelectedRef | None = None


class MoveWallInput(_ToolInput):
    wall: str | None = None
    # Room-aware addressing (resolved in code): room name/id or "new" + a side.
    room: str | None = None
    side: str | None = None
    offset_m: float
    selected: SelectedRef | None = None


class SetOpeningSizeInput(_ToolInput):
    opening: str | None = None
    width_m: float | None = Field(default=None, gt=0.0)
    height_m: float | None = Field(default=None, gt=0.0)
    sill_m: float | None = Field(default=None, ge=0.0)
    selected: SelectedRef | None = None


class SplitRoomInput(_ToolInput):
    room: str | None = None
    axis: Literal["x", "y"] = "x"
    at_ratio: float = Field(default=0.5, gt=0.0, lt=1.0)
    selected: SelectedRef | None = None


class RenameRoomInput(_ToolInput):
    room: str | None = None
    name: str | None = Field(default=None, min_length=1)
    function: str | None = Field(default=None, min_length=1)
    selected: SelectedRef | None = None


class UndoInput(_ToolInput):
    pass


class ListCatalogInput(_ToolInput):
    query: str | None = None


class PlaceFurnitureInput(_ToolInput):
    catalog_id: str
    item_id: str | None = None
    room_id: str | None = None
    room: str | None = None
    # Wall label ("wall 2") to put the item against; code finds the spot.
    anchor: str | None = None
    # Uniform size factor; code enforces 0.8 to 1.2 (ADR: real dims +-20%).
    scale: float | None = Field(default=None, gt=0.0)
    selected: SelectedRef | None = None


class MoveItemInput(_ToolInput):
    item_id: str | None = None
    item: str | None = None
    # UI nudges send meters; the model should prefer `wall` or `room`.
    position: tuple[float, float] | None = None
    wall: str | None = None
    room: str | None = None
    selected: SelectedRef | None = None


class RotateItemInput(_ToolInput):
    item_id: str | None = None
    item: str | None = None
    rotation_deg: float | None = None
    delta_deg: float | None = None
    selected: SelectedRef | None = None


class RemoveItemInput(_ToolInput):
    item_id: str | None = None
    item: str | None = None
    selected: SelectedRef | None = None


class CreateVariantInput(_ToolInput):
    label: str = "B"
    from_variant: str = "A"


class RenderViewInput(_ToolInput):
    variant: str = "A"
    camera: str = "iso"


TOOL_MODELS: dict[str, type[BaseModel]] = {
    "add_room": AddRoomInput,
    "add_wall": AddWallInput,
    "remove_wall": RemoveWallInput,
    "add_opening": AddOpeningInput,
    "move_opening": MoveOpeningInput,
    "resize_room": ResizeRoomInput,
    "set_wall_length": SetWallLengthInput,
    "move_wall": MoveWallInput,
    "set_opening_size": SetOpeningSizeInput,
    "split_room": SplitRoomInput,
    "rename_room": RenameRoomInput,
    "undo": UndoInput,
    "list_catalog": ListCatalogInput,
    "place_furniture": PlaceFurnitureInput,
    "move_item": MoveItemInput,
    "rotate_item": RotateItemInput,
    "remove_item": RemoveItemInput,
    "create_variant": CreateVariantInput,
    "render_view": RenderViewInput,
}


class SetSurfaceMaterialInput(_ToolInput):
    room: str | None = None
    part: Literal["floor", "walls"] = "walls"
    material_id: str
    selected: SelectedRef | None = None


TOOL_MODELS["set_surface_material"] = SetSurfaceMaterialInput
