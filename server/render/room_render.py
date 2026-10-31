"""Concept render of one room via Muse Image (explicit request only).

Cost: one image = $0.01 (mme.client.image_generate). The prompt is built in
code from the measured Scene so the picture follows the design; the result is
a concept, never a measured output.
"""

from __future__ import annotations

import base64
from typing import Protocol

from server.agent.design import load_catalog
from server.scene.models import Scene

COST_PER_IMAGE_USD = 0.01


class ImageClient(Protocol):
    def image_generate(self, prompt: str, *, tag: str = ..., n: int = ..., **params): ...


def build_prompt(scene: Scene, room_id: str) -> str:
    room = next((r for r in scene.rooms if r.id == room_id), None)
    if room is None:
        raise KeyError(room_id)
    cat = {m["id"]: m["name"] for m in load_catalog()["materials"]}
    types = {f["id"]: f["name"] for f in load_catalog()["furniture"]}
    xs = [p[0] for p in room.polygon]
    ys = [p[1] for p in room.polygon]
    parts = [f"Interior concept photo of a {room.function or 'room'} about {max(xs) - min(xs):.1f} by {max(ys) - min(ys):.1f} metres."]
    finishes = [cat[s.material_id] for s in scene.surfaces if s.material_id in cat]
    if finishes:
        parts.append("Finishes: " + ", ".join(sorted(set(finishes))) + ".")
    pieces = [types.get(f.catalog_id or "", "furniture") for f in scene.furniture if f.room_id == room_id]
    if pieces:
        parts.append("Furniture: " + ", ".join(pieces) + ".")
    parts.append("Natural light, simple modern self-built home, no people, no text.")
    return " ".join(parts)


def render_room(scene: Scene, room_id: str, client: ImageClient) -> dict:
    images = client.image_generate(build_prompt(scene, room_id), tag="render", n=1)
    if not images:
        raise RuntimeError("the image model returned no image")
    return {
        "image_b64": base64.b64encode(images[0]).decode("ascii"),
        "label": "concept",
        "preliminary": True,
        "cost_usd": COST_PER_IMAGE_USD,
    }
