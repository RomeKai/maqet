"""Stage-scoped toolsets (ADR-014, re-scoped by ADR-022).

The server only exposes the current stage's tools. Reform is the main agent
stage; Design is light; Present stubs return structured results (no model
calls). This table is the intent; the exact contract lives here.
"""

from __future__ import annotations

STAGES: dict[str, tuple[str, ...]] = {
    "reform": (
        "add_room",
        "add_wall",
        "remove_wall",
        "add_opening",
        "move_opening",
        "resize_room",
        "set_wall_length",
        "move_wall",
        "set_opening_size",
        "split_room",
        "rename_room",
        "undo",
    ),
    "design": (
        "list_catalog",
        "place_furniture",
        "move_item",
        "rotate_item",
        "remove_item",
        "set_surface_material",
        "undo",
    ),
    "present": (
        "create_variant",
        "render_view",
    ),
}


def allowed_tools(stage: str) -> list[str]:
    """Return the tool names exposed in `stage`. Raises KeyError when unknown."""
    return list(STAGES[stage])
