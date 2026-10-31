import base64

from fastapi.testclient import TestClient

from server.api import app, get_image_client
from server.tests.test_design_tools import _scene


class FakeImages:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict]] = []

    def image_generate(self, prompt, *, tag="render", n=1, **params):
        self.calls.append((prompt, {"tag": tag, "n": n}))
        return [b"\x89PNGfake"]


def test_render_room_calls_the_image_model_once_and_labels_it_concept() -> None:
    fake = FakeImages()
    app.dependency_overrides[get_image_client] = lambda: fake
    try:
        scene = _scene().model_dump(mode="json")
        r = TestClient(app).post("/render/room", json={"scene": scene, "room_id": "r1"})
    finally:
        app.dependency_overrides.pop(get_image_client, None)
    assert r.status_code == 200, r.text
    body = r.json()
    assert base64.b64decode(body["image_b64"]) == b"\x89PNGfake"
    assert body["label"] == "concept" and body["preliminary"] is True and body["cost_usd"] == 0.01
    assert len(fake.calls) == 1 and fake.calls[0][1] == {"tag": "render", "n": 1}
    assert "4.0 by 3.0" in fake.calls[0][0]


def test_unknown_room_is_404_and_never_calls_the_model() -> None:
    fake = FakeImages()
    app.dependency_overrides[get_image_client] = lambda: fake
    try:
        r = TestClient(app).post("/render/room", json={"scene": _scene().model_dump(mode="json"), "room_id": "nope"})
    finally:
        app.dependency_overrides.pop(get_image_client, None)
    assert r.status_code == 404 and fake.calls == []
