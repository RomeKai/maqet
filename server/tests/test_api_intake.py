"""POST /intake API tests (Day 2 gate: integration upload -> Scene draft).

Offline: fake mme.client transport (same pattern as test_intake_schema.py),
in-memory PNG uploads. Asserts the route wires read_plan (replay/fake) ->
build_scaled_plan -> to_scene end to end, never silently empty.
"""

from __future__ import annotations

import io
import sys
import types
from typing import Any

import pytest
from fastapi.testclient import TestClient
from PIL import Image

import server.api as api_module
from server.api import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def _reset_store() -> Any:
    api_module._current = None
    yield
    api_module._current = None


def _make_image_bytes(width: int, height: int) -> bytes:
    img = Image.new("RGB", (width, height), color=(250, 247, 240))
    out = io.BytesIO()
    img.save(out, format="PNG")
    return out.getvalue()


def _plan_payload() -> dict[str, Any]:
    return {
        "input_kind": "plan",
        "walls": [
            {"a": [0.1, 0.1], "b": [0.9, 0.1], "kind": "exterior"},
            {"a": [0.9, 0.1], "b": [0.9, 0.9], "kind": "exterior"},
            {"a": [0.9, 0.9], "b": [0.1, 0.9], "kind": "exterior"},
            {"a": [0.1, 0.9], "b": [0.1, 0.1], "kind": "exterior"},
        ],
        "openings": [{"wall_index": 0, "t0": 0.2, "t1": 0.4, "kind": "door"}],
        "labels": [{"text": "Estar", "at": [0.5, 0.5]}],
        "dimensions": [{"text": "8,00 m", "a": [0.0, 0.02], "b": [1.0, 0.02]}],
    }


def _sketch_payload() -> dict[str, Any]:
    payload = _plan_payload()
    payload["input_kind"] = "sketch"
    payload["dimensions"] = [{"text": "6,00", "a": [0.0, 0.02], "b": [1.0, 0.02]}]
    return payload


class FakeClient:
    def __init__(self, responses: list[dict[str, Any]]) -> None:
        self._responses = list(responses)
        self.calls: list[dict[str, Any]] = []

    def chat_json(self, messages: Any, **kwargs: Any) -> dict[str, Any]:
        self.calls.append({"messages": messages, **kwargs})
        return self._responses.pop(0)


def _install(fake: FakeClient, monkeypatch: pytest.MonkeyPatch) -> None:
    module = types.ModuleType("mme.client")
    module.client = lambda: fake  # type: ignore[attr-defined]
    pkg = types.ModuleType("mme")
    pkg.client = module  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "mme", pkg)
    monkeypatch.setitem(sys.modules, "mme.client", module)


def _post(
    image: bytes, kind: str, filename: str = "plan.png"
) -> Any:
    return client.post(
        "/intake",
        files={"file": (filename, image, "image/png")},
        data={"kind": kind},
    )


def test_intake_plan_end_to_end(monkeypatch: pytest.MonkeyPatch) -> None:
    _install(FakeClient([_plan_payload()]), monkeypatch)
    res = _post(_make_image_bytes(1600, 1200), "plan")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["proposal"]["input_kind"] == "plan"
    assert body["proposal"]["dimensions"][0]["text"] == "8,00 m"
    scene = body["scene"]
    assert scene["scale_confirmed"] is False  # auto anchor: human confirms
    assert len(scene["walls"]) == 4
    assert body["anchor_meters"] == pytest.approx(8.0)
    # Stored as current: /scene serves the draft.
    assert client.get("/scene").status_code == 200


def test_intake_sketch_end_to_end(monkeypatch: pytest.MonkeyPatch) -> None:
    _install(FakeClient([_sketch_payload()]), monkeypatch)
    res = _post(_make_image_bytes(1200, 700), "sketch", "croquis.png")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["proposal"]["input_kind"] == "sketch"
    assert body["anchor_meters"] == pytest.approx(6.0)
    assert body["scene"]["scale_confirmed"] is False
    assert len(body["scene"]["walls"]) == 4


def test_intake_empty_file_is_400(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeClient([_plan_payload()])
    _install(fake, monkeypatch)
    res = _post(b"", "plan")
    assert res.status_code == 400
    assert "empty" in res.json()["detail"].lower()
    assert fake.calls == []  # never called vision on empty bytes


def test_intake_bad_kind_is_400(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeClient([_plan_payload()])
    _install(fake, monkeypatch)
    res = _post(_make_image_bytes(800, 600), "photo")
    assert res.status_code == 400
    assert fake.calls == []


def test_intake_vision_failure_is_400_loud(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    bad = _plan_payload()
    bad["walls"] = []  # orphans openings[0].wall_index -> fails twice
    _install(FakeClient([bad, bad]), monkeypatch)
    res = _post(_make_image_bytes(800, 600), "plan")
    assert res.status_code == 400
    assert "validation" in res.json()["detail"].lower()
    assert client.get("/scene").status_code == 404  # nothing stored


def test_intake_no_anchor_dimension_is_400(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    payload = _plan_payload()
    payload["dimensions"] = []  # no scale anchor: human must correct
    _install(FakeClient([payload]), monkeypatch)
    res = _post(_make_image_bytes(800, 600), "plan")
    assert res.status_code == 400
    assert client.get("/scene").status_code == 404


def test_intake_garbage_bytes_is_400(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeClient([_plan_payload()])
    _install(fake, monkeypatch)
    res = _post(b"not-an-image-at-all", "plan")
    assert res.status_code == 400
    assert "unreadable" in res.json()["detail"].lower()
    assert fake.calls == []  # vision never runs on garbage bytes
    assert client.get("/scene").status_code == 404


def test_intake_oversize_is_400(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeClient([_plan_payload()])
    _install(fake, monkeypatch)
    monkeypatch.setattr(api_module, "_MAX_IMAGE_BYTES", 64)
    res = _post(_make_image_bytes(800, 600), "plan")
    assert res.status_code == 400
    assert "too large" in res.json()["detail"].lower()
    assert fake.calls == []
    assert client.get("/scene").status_code == 404
