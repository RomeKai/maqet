"""Edits made on a variant stay on that variant (bug A).

Root cause being pinned: agent turns and UI edits only changed the client's
Scene; the server's variants project (what Now/A/B/C load) never saw them, so
switching variants loaded a stale snapshot. Behavior: Now = read-only baseline
(the Scene when Reform started); every edit is persisted into the active
variant's op history, so A/B/C keep their own edits.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from server import api
from server.tests.test_edit_tools import _house

client = TestClient(api.app)


@pytest.fixture
def db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    path = tmp_path / "persist.db"
    monkeypatch.setattr(api, "_DB_PATH", path)
    monkeypatch.setattr(api, "_current", None)
    return path


def _edit(scene, history, variant, tool="set_wall_length", args=None):
    res = client.post(
        "/agent/edit",
        json={
            "scene": scene,
            "tool": tool,
            "args": args or {"wall": "w1", "length_m": 6.0},
            "history": history,
            "variant": variant,
            "base_scene": _house().model_dump(mode="json"),
        },
    )
    assert res.status_code == 200, res.text
    return res.json()


def _variant(label):
    out = client.get("/variants").json()
    return next(v for v in out["variants"] if v["label"] == label)


def test_edit_persists_into_the_active_variant(db: Path) -> None:
    body = _edit(_house().model_dump(mode="json"), [], "A")
    a = _variant("A")
    assert a["op_count"] == 1
    assert a["scene"]["version"] == body["scene"]["version"] == 1
    assert a["scene"]["walls"][0]["b"][0] == 6.0


def test_edit_survives_switching_away_and_back(db: Path) -> None:
    _edit(_house().model_dump(mode="json"), [], "A")
    client.post("/variants/fork", json={"label": "B", "from_branch": "A"})
    client.post("/variants/B/choose")
    back = client.post("/variants/A/choose").json()
    a = next(v for v in back["variants"] if v["label"] == "A")
    assert a["scene"]["walls"][0]["b"][0] == 6.0
    assert len(a["ops"]) == 1


def test_variants_do_not_leak_edits_into_each_other(db: Path) -> None:
    first = _edit(_house().model_dump(mode="json"), [], "A")
    client.post("/variants/fork", json={"label": "B", "from_branch": "A"})
    b = _variant("B")
    _edit(b["scene"], b["ops"], "B", args={"wall": "w1", "length_m": 7.0})
    assert _variant("A")["scene"]["walls"][0]["b"][0] == 6.0
    assert _variant("B")["scene"]["walls"][0]["b"][0] == 7.0
    assert first["scene"]["version"] == 1


def test_new_session_base_resets_stale_branches(db: Path) -> None:
    _edit(_house().model_dump(mode="json"), [], "A")
    other = _house().model_copy(update={"id": "other"})
    res = client.post(
        "/agent/edit",
        json={
            "scene": other.model_dump(mode="json"),
            "tool": "rename_room",
            "args": {"room": "r1", "name": "Hall"},
            "history": [],
            "variant": "A",
            "base_scene": other.model_dump(mode="json"),
        },
    )
    assert res.status_code == 200, res.text
    assert _variant("A")["op_count"] == 1  # old session ops were dropped


def test_get_variants_on_a_fresh_db_is_an_empty_list(db: Path) -> None:
    """E2E-001: no scene stored yet must not be a 404 (console noise on first load)."""
    res = client.get("/variants")
    assert res.status_code == 200, res.text
    assert res.json() == {"chosen": "", "variants": []}
