"""Wall status layers for reforms (dxf-full-export).

A wall in both scenes is existing (A-WALL-EXST), only in the current scene is
new (A-WALL-NEWW), only in the base scene is demolished (A-WALL-DEMO, dashed).
Without a base scene every wall stays on plain A-WALL (Day-1 behavior).
"""

from __future__ import annotations

from server.scene.models import Scene, Wall

PLAIN_LAYER = "A-WALL"
EXST_LAYER = "A-WALL-EXST"
NEWW_LAYER = "A-WALL-NEWW"
DEMO_LAYER = "A-WALL-DEMO"


def wall_layers(
    scene: Scene, base_scene: Scene | None = None
) -> list[tuple[Wall, str]]:
    """Current walls then demolished base walls, each with its DXF layer."""
    if base_scene is None:
        return [(wall, PLAIN_LAYER) for wall in scene.walls]
    base_ids = {wall.id for wall in base_scene.walls}
    current_ids = {wall.id for wall in scene.walls}
    layers = [
        (wall, EXST_LAYER if wall.id in base_ids else NEWW_LAYER)
        for wall in scene.walls
    ]
    layers += [
        (wall, DEMO_LAYER) for wall in base_scene.walls if wall.id not in current_ids
    ]
    return layers
