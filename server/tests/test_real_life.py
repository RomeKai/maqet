import base64

import pytest
from fastapi.testclient import TestClient

from server.api import app, get_image_client
from server.render.real_life import STYLES, build_prompt, render_real_life
from server.scene.models import Furniture, Surface
from server.tests.test_design_tools import _scene


def _designed():
    s = _scene()
    return s.model_copy(
        update={
            "furniture": [
                Furniture(id="f2", catalog_id="sofa-3seat-200x90", room_id="r1", position=(2.0, 2.4), rotation_deg=180, size_m=(2.0, 0.9, 0.85)),
                Furniture(id="f1", catalog_id="bed-single-90x190", room_id="r1", position=(0.7, 1.5), rotation_deg=90, size_m=(0.9, 1.9, 0.55)),
            ],
            "surfaces": [
                Surface.model_validate({"id": "a", "target": {"type": "room", "room_id": "r1", "part": "floor"}, "material_id": "floor-wood-laminate"}),
                Surface.model_validate({"id": "b", "target": {"type": "wall", "wall_id": "w1", "side": "left"}, "material_id": "wall-paint-sage"}),
            ],
        }
    )


class Fake:
    def __init__(self, _unused: bool = False) -> None:
        self.calls: list[tuple] = []

    def image_generate(self, prompt, *, tag="render", n=1, **p):
        self.calls.append(("generate", prompt, n))
        return [b"IMG"]


def test_prompt_contains_measured_design_and_style() -> None:
    p = build_prompt(_designed(), "r1", "rustic")
    for needle in (
        "4.0 by 3.0",
        "ceiling 2.60 m",
        "door 0.90 x 2.10 m",
        "south wall",
        "Single bed",
        "Sofa",
        "facing west",
        "facing south",
        "Wood laminate floor",
        "Sage green wall paint",
        "rustic",
        "eye-level",
    ):
        assert needle in p, needle


def test_prompt_is_deterministic_stable_prefix_and_orders_furniture() -> None:
    a, b = build_prompt(_designed(), "r1", "modern"), build_prompt(_designed(), "r1", "modern")
    assert a == b
    assert a.startswith(build_prompt(_scene(), "r1", "cozy")[:60])
    assert a.index("Single bed") < a.index("Sofa")  # sorted by type then id, not insertion order
    assert a.rstrip().endswith(STYLES["modern"].rstrip())  # style last


def test_unknown_style_and_room() -> None:
    with pytest.raises(ValueError):
        build_prompt(_scene(), "r1", "baroque")
    with pytest.raises(KeyError):
        build_prompt(_scene(), "nope", "modern")


def test_render_is_text_only_one_image() -> None:
    fake = Fake(False)
    r = render_real_life(_designed(), "r1", "cozy", fake)
    assert fake.calls[0][0] == "generate" and fake.calls[0][2] == 1
    assert r["cost_usd"] == 0.01 and "label" not in r


def test_route_one_image() -> None:
    fake = Fake(False)
    app.dependency_overrides[get_image_client] = lambda: fake
    try:
        c = TestClient(app)
        body = {"scene": _designed().model_dump(mode="json"), "room_id": "r1", "style": "industrial"}
        r = c.post("/render/real-life", json=body)
        bad = c.post("/render/real-life", json={**body, "style": "nope"})
    finally:
        app.dependency_overrides.pop(get_image_client, None)
    j = r.json()
    assert r.status_code == 200 and base64.b64decode(j["image_b64"]) == b"IMG"
    assert j["cost_usd"] == 0.01 and j["style"] == "industrial" and "label" not in j
    assert bad.status_code == 422 and len(fake.calls) == 1
