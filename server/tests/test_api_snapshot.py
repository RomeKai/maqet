"""GET/POST /scene/snapshot.svg: the deterministic top-view SVG over HTTP.

POST renders the Scene in the body; GET renders the stored current Scene.
Offline, no Meta calls.
"""

from __future__ import annotations

import json
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

import server.api as api
from server.api import app
from server.render.snapshot import render_snapshot
from server.scene.models import Scene

SAMPLE = Path(__file__).resolve().parents[2] / "samples" / "plans" / "plano_48m_1ambiente.truth.json"
client = TestClient(app)


def _scene() -> dict[str, Any]:
    return json.loads(SAMPLE.read_text(encoding="utf-8"))


@pytest.mark.parametrize("locale", ["en", "es-AR"])
def test_post_returns_the_rendered_svg(locale: str) -> None:
    res = client.post(f"/scene/snapshot.svg?locale={locale}", json=_scene())
    assert res.status_code == 200, res.text
    assert res.headers["content-type"].startswith("image/svg+xml")
    assert res.text == render_snapshot(Scene.model_validate(_scene()), locale=locale)
    assert ET.fromstring(res.text).tag == "svg"


def test_locale_defaults_to_english() -> None:
    res = client.post("/scene/snapshot.svg", json=_scene())
    assert res.status_code == 200
    assert "Preliminary" in res.text


def test_unknown_locale_is_422() -> None:
    assert client.post("/scene/snapshot.svg?locale=fr", json=_scene()).status_code == 422


def test_get_renders_the_stored_scene(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(api, "_current", Scene.model_validate(_scene()))
    res = client.get("/scene/snapshot.svg?locale=es-AR")
    assert res.status_code == 200, res.text
    assert res.headers["content-type"].startswith("image/svg+xml")
    assert "Preliminar" in res.text


def test_get_without_a_stored_scene_is_404(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(api, "_current", None)
    assert client.get("/scene/snapshot.svg").status_code == 404
