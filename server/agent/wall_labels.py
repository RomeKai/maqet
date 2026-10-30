"""Human wall labels: "wall 2 (north, 8.0 m)" (bug F).

The family cannot know which wall is "w2", so the model talks in labels and
the UI draws the same number on each wall. Numbering is the 1-based index of
the wall in ``scene.walls`` (same as the Check step plan); orientation is
where the wall sits relative to the plan centre (plan y is north). Labels map
back to ids here, in code (ADR-002).
"""

from __future__ import annotations

import math
import re

from server.scene.models import Scene, Wall

_CENTRE_TOL_M = 0.05
_REF = re.compile(r"^\s*(?:wall|muro|pared)?\s*#?\s*(\d+)\b", re.IGNORECASE)


def wall_number(scene: Scene, wall_id: str) -> int:
    """1-based number of the wall, 0 when unknown."""
    for index, wall in enumerate(scene.walls):
        if wall.id == wall_id:
            return index + 1
    return 0


def _centre(scene: Scene) -> tuple[float, float]:
    points = [p for w in scene.walls for p in (w.a, w.b)]
    return (
        sum(p[0] for p in points) / len(points),
        sum(p[1] for p in points) / len(points),
    )


def wall_orientation(scene: Scene, wall: Wall) -> str:
    cx, cy = _centre(scene)
    mx, my = (wall.a[0] + wall.b[0]) / 2.0, (wall.a[1] + wall.b[1]) / 2.0
    dx, dy = abs(wall.b[0] - wall.a[0]), abs(wall.b[1] - wall.a[1])
    if dx >= dy:  # runs east-west: sits north or south of the centre
        if abs(my - cy) < _CENTRE_TOL_M:
            return "interior"
        return "north" if my > cy else "south"
    if abs(mx - cx) < _CENTRE_TOL_M:
        return "interior"
    return "east" if mx > cx else "west"


def wall_label(scene: Scene, wall_id: str) -> str:
    wall = next((w for w in scene.walls if w.id == wall_id), None)
    if wall is None:
        return wall_id
    length = math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1])
    return (
        f"wall {wall_number(scene, wall_id)} "
        f"({wall_orientation(scene, wall)}, {length:.1f} m)"
    )


def resolve_in_walls(walls: list[Wall], ref: str | None) -> str | None:
    """Wall id from an id ("w3") or a human label ("wall 3", "3", "muro 3")."""
    if ref is None or not ref.strip():
        return None
    want = ref.strip().casefold()
    for wall in walls:
        if wall.id.casefold() == want:
            return wall.id
    match = _REF.match(ref)
    if match is None:
        return None
    index = int(match.group(1)) - 1
    return walls[index].id if 0 <= index < len(walls) else None


def resolve_wall_ref(scene: Scene, ref: str | None) -> str | None:
    return resolve_in_walls(scene.walls, ref)
