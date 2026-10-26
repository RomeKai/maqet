"""API tests (Fase 4 Día 1). Offline: TestClient only, no network, no Meta calls."""

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


def _wall() -> dict:
    return {
        "id": "w1",
        "a": [0.0, 0.0],
        "b": [5.0, 0.0],
        "thickness_m": 0.20,
        "kind": "exterior",
    }


def test_health() -> None:
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"


def test_get_scene_empty_is_404() -> None:
    assert client.get("/scene").status_code == 404


def test_post_and_get_scene_roundtrip() -> None:
    body = {"id": "s1", "scale_confirmed": True}
    res = client.post("/scene", json=body)
    assert res.status_code == 200
    assert res.json()["id"] == "s1"
    assert client.get("/scene").json()["id"] == "s1"


def test_post_scene_invalid_is_422() -> None:
    assert client.post("/scene", json={"no_id": True}).status_code == 422


def test_validate_reports_errors() -> None:
    bad = {"id": "s1", "ceiling_height_m": 2.0}
    res = client.post("/scene/validate", json=bad)
    assert res.status_code == 200
    report = res.json()
    assert report["ok"] is False
    assert report["errors"] != []


def test_validate_ok_scene() -> None:
    good = {"id": "s1", "scale_confirmed": True, "walls": [_wall()]}
    res = client.post("/scene/validate", json=good)
    assert res.status_code == 200
    assert res.json()["ok"] is True


def test_export_dxf_requires_confirmed_scale() -> None:
    res = client.post("/export/dxf", json={"id": "s1", "walls": [_wall()]})
    assert res.status_code == 400


def test_export_dxf_returns_file() -> None:
    body = {"id": "s1", "scale_confirmed": True, "walls": [_wall()]}
    res = client.post("/export/dxf", json=body)
    assert res.status_code == 200
    assert res.headers["content-type"] == "application/dxf"
    assert b"SECTION" in res.content
