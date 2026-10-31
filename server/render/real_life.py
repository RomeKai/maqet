"""'In real life' concept image of a designed room (explicit tap, $0.01).

Fidelity: the master prompt is a structured description built in code from the
measured Scene (ADR-002): the house rooms, the chosen room with its openings,
furniture and finishes, then the style; stable prefix first for caching.
Text-only (human decision): the layout in the picture is approximate.
"""

from __future__ import annotations

import base64
import math
from typing import Any

from shapely.geometry import Polygon

from server.agent.design import inward_wall_sides, load_catalog
from server.scene.models import Room, Scene, Wall

COST_PER_IMAGE_USD = 0.01

STYLES: dict[str, str] = {
    "minimalist": "Style: minimalist. Clean lines, very few objects, neutral palette, uncluttered surfaces, soft daylight.",
    "modern": "Style: modern. Contemporary furnishings, crisp details, balanced contrast, warm LED accents.",
    "cozy": "Style: cozy and cute. Soft textiles, plants, warm lamps, small decorative touches, inviting mood.",
    "rustic": "Style: rustic. Natural wood, exposed textures, earthy tones, handmade details.",
    "industrial": "Style: industrial. Raw concrete and metal accents, dark steel details, loft feel.",
}

_PREFIX = (
    "Photorealistic interior photograph of a finished room in a self-built home. "
    "Follow the measured layout below exactly: do not add, remove or move any door, window or furniture. "
    "No people, no text."
)
_FACING = {0: "north", 90: "west", 180: "south", 270: "east"}


def _orient(wall: Wall, room: Room) -> str:
    c = Polygon(room.polygon).centroid
    dx = (wall.a[0] + wall.b[0]) / 2 - c.x
    dy = (wall.a[1] + wall.b[1]) / 2 - c.y
    if abs(dy) >= abs(dx):
        return "north" if dy > 0 else "south"
    return "east" if dx > 0 else "west"


def _end(wall: Wall, orient: str, offset: float, width: float) -> tuple[float, str]:
    length = math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1])
    horizontal = orient in ("north", "south")
    a_low = (wall.a[0] <= wall.b[0]) if horizontal else (wall.a[1] <= wall.b[1])
    dist = offset if a_low else length - offset - width
    return round(dist, 2), ("west" if horizontal else "south")


def _room_walls(scene: Scene, room: Room) -> list[Wall]:
    ids = {wid for wid, _ in inward_wall_sides(scene, room)}
    return [w for w in scene.walls if w.id in ids]


def _openings(scene: Scene, room: Room) -> list[tuple[str, str, str]]:
    out: list[tuple[str, str, str]] = []
    for w in _room_walls(scene, room):
        orient = _orient(w, room)
        for o in scene.openings:
            if o.wall_id != w.id:
                continue
            dist, end = _end(w, orient, o.offset_m, o.width_m)
            sill = f", sill {o.sill_m:.2f} m" if o.kind == "window" and o.sill_m is not None else ""
            text = f"{o.kind} {o.width_m:.2f} x {o.height_m:.2f} m{sill} on the {orient} wall, {dist:.2f} m from its {end} end"
            out.append((o.kind, orient, text))
    return sorted(out)


def build_prompt(scene: Scene, room_id: str, style: str) -> str:
    room = next((r for r in scene.rooms if r.id == room_id), None)
    if room is None:
        raise KeyError(room_id)
    if style not in STYLES:
        raise ValueError(f"unknown style {style!r}")
    cat = load_catalog()
    names = {m["id"]: m["name"] for m in cat["materials"]}
    kinds = {f["id"]: f["name"] for f in cat["furniture"]}
    types = {f["id"]: f.get("type", "") for f in cat["furniture"]}
    xs, ys = [p[0] for p in room.polygon], [p[1] for p in room.polygon]
    x0, y0 = min(xs), min(ys)
    lines = [
        _PREFIX,
        f"Room: {room.function or 'room'}, {max(xs) - x0:.1f} by {max(ys) - y0:.1f} m, ceiling {scene.ceiling_height_m:.2f} m.",
    ]
    others = [
        f"{r.name} {max(p[0] for p in r.polygon) - min(p[0] for p in r.polygon):.1f} by "
        f"{max(p[1] for p in r.polygon) - min(p[1] for p in r.polygon):.1f} m"
        for r in scene.rooms if r.id != room_id
    ]
    if others:
        lines.append("Rest of the house (adjoining, not shown): " + "; ".join(sorted(others)) + ".")
    ops = _openings(scene, room)
    lines.append("Openings: " + ("; ".join(o[2] for o in ops) if ops else "none") + ".")
    items = sorted(
        (f for f in scene.furniture if f.room_id == room_id),
        key=lambda f: (types.get(f.catalog_id or "", ""), f.id),
    )
    if items:
        parts = []
        for f in items:
            facing = _FACING.get(int(round(f.rotation_deg / 90.0) * 90) % 360, "north")
            parts.append(
                f"{kinds.get(f.catalog_id or '', 'furniture')} {f.size_m[0]:.2f} x {f.size_m[1]:.2f} x {f.size_m[2]:.2f} m at "
                f"{f.position[0] - x0:.2f} m east and {f.position[1] - y0:.2f} m north of the south-west corner, facing {facing}"
            )
        lines.append("Furniture: " + "; ".join(parts) + ".")
    else:
        lines.append("Furniture: none.")
    wall_ids = {w.id for w in _room_walls(scene, room)}
    floor = sorted(
        {names[s.material_id] for s in scene.surfaces
         if s.target.type == "room" and s.target.room_id == room_id and s.material_id in names}
    )
    walls = sorted(
        {names[s.material_id] for s in scene.surfaces
         if s.target.type == "wall" and s.target.wall_id in wall_ids and s.material_id in names}
    )
    lines.append("Floor: " + (", ".join(floor) or "plain floor") + ". Walls: " + (", ".join(walls) or "plain painted walls") + ".")
    door = next((o for o in ops if o[0] == "door"), None)
    window = next((o for o in ops if o[0] == "window"), None)
    cam = "Camera: eye-level view (1.5 m) from " + (f"the {door[1]} door" if door else "the room entrance")
    cam += f", looking toward the {window[1]} wall with the window." if window else ", looking across the room."
    lines.append(cam)
    lines.append(STYLES[style])
    return "\n".join(lines)


def render_real_life(scene: Scene, room_id: str, style: str, client: Any) -> dict:
    """Text-only: one deterministic master prompt, one image (n=1)."""
    images = client.image_generate(build_prompt(scene, room_id, style), tag="render", n=1)
    if not images:
        raise RuntimeError("the image model returned no image")
    return {
        "image_b64": base64.b64encode(images[0]).decode("ascii"),
        "style": style,
        "cost_usd": COST_PER_IMAGE_USD,
    }
