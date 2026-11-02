"""Takeoff export routes — RED test for takeoff-route mission.

Expects:
  POST /export/takeoff      -> Takeoff JSON (preliminary, 5 stages)
  POST /export/takeoff.csv  -> text/csv via to_csv
  422 with readable detail when Scene invalid
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import server.api as api_module
from server.api import app

TRUTH = Path(__file__).resolve().parents[2] / "samples" / "plans" / "croquis_3x8_door_window.truth.json"

client = TestClient(app)


@pytest.fixture(autouse=True)
def _reset_store():
    api_module._current = None
    yield
    api_module._current = None


def _truth_data() -> dict:
    return json.loads(TRUTH.read_text(encoding="utf-8"))


def _post_takeoff(payload: dict):
    # Mission spec: body is Scene + optional base Scene.
    # Route accepts wrapped {"scene": Scene, "base_scene": Scene} OR bare Scene.
    # Try wrapped form first, fall back to bare.
    res = client.post("/export/takeoff", json=payload)
    return res


def test_takeoff_returns_json_with_preliminary_and_stages() -> None:
    scene = _truth_data()
    res = client.post("/export/takeoff", json={"scene": scene})
    if res.status_code == 422:
        # try bare Scene
        res = client.post("/export/takeoff", json=scene)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["preliminary"] is True, "response must carry preliminary label"
    assert "stages" in body
    stage_names = [s["name"] for s in body["stages"]]
    assert stage_names == ["foundations", "walls", "bond_beams_roof", "openings", "finishes"]
    assert any(len(s["items"]) > 0 for s in body["stages"])


def test_takeoff_invalid_returns_422() -> None:
    res = client.post("/export/takeoff", json={"no_id": True})
    assert res.status_code == 422
    assert "detail" in res.json()


def test_takeoff_csv_returns_csv_with_header() -> None:
    scene = _truth_data()
    res = client.post("/export/takeoff.csv", json={"scene": scene})
    if res.status_code == 422:
        res = client.post("/export/takeoff.csv", json=scene)
    assert res.status_code == 200, res.text
    assert "text/csv" in res.headers["content-type"]
    lines = res.text.splitlines()
    assert lines[0] == "stage,material_id,unit,quantity,waste_factor,recipe_source,estimated,purchase_quantity"
    assert len(lines) > 1


def test_takeoff_csv_invalid_returns_422() -> None:
    res = client.post("/export/takeoff.csv", json={"bad": True})
    assert res.status_code == 422


def test_takeoff_with_base_counts_only_built() -> None:
    base = _truth_data()
    variant = json.loads(TRUTH.read_text(encoding="utf-8"))
    variant["walls"].append(
        {"id": "w_new", "a": [6, 0], "b": [6, 2], "thickness_m": 0.2, "kind": "exterior", "provenance": "estimated"}
    )
    res = client.post("/export/takeoff", json={"scene": variant, "base_scene": base})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["built_m"] == pytest.approx(2.0, abs=1e-6)
    assert body["demolished_m"] == pytest.approx(0.0, abs=1e-6)
