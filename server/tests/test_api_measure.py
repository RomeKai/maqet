"""AR measure roundtrip (ADR-025 mode A). Offline: TestClient only, no network."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

import server.api as api_module
from server.api import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def _reset_store():
    api_module._current = None
    yield
    api_module._current = None


def _ar_wall() -> dict:
    return {
        "id": "w0",
        "a": [0.0, 0.0],
        "b": [5.0, 0.0],
        "thickness_m": 0.20,
        "kind": "exterior",
        "provenance": "measured_ar",
        "measured_length_m": 5.0,
    }


def test_post_and_get_measured_ar_roundtrip() -> None:
    body = {"id": "s-ar", "scale_confirmed": False, "walls": [_ar_wall()]}
    res = client.post("/scene", json=body)
    assert res.status_code == 200
    stored = res.json()
    assert stored["walls"][0]["provenance"] == "measured_ar"
    assert stored["walls"][0]["measured_length_m"] == 5.0

    fetched = client.get("/scene")
    assert fetched.status_code == 200
    assert fetched.json()["walls"][0]["provenance"] == "measured_ar"


def test_validate_accepts_measured_ar_wall() -> None:
    body = {"id": "s-ar", "scale_confirmed": True, "walls": [_ar_wall()]}
    res = client.post("/scene/validate", json=body)
    assert res.status_code == 200
    assert res.json()["ok"] is True


def test_post_scene_rejects_nonpositive_measure() -> None:
    wall = _ar_wall()
    wall["measured_length_m"] = 0.0
    body = {"id": "s-ar", "scale_confirmed": False, "walls": [wall]}
    assert client.post("/scene", json=body).status_code == 422


def test_post_scene_rejects_bad_provenance() -> None:
    wall = _ar_wall()
    wall["provenance"] = "measured_laser"
    body = {"id": "s-ar", "scale_confirmed": False, "walls": [wall]}
    assert client.post("/scene", json=body).status_code == 422
