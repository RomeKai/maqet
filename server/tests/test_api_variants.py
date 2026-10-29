"""Variant routes (ADR-013): fork, list, choose and undo over HTTP.

The project is seeded from the stored current Scene (branch 'A') on first
use and persisted through server.db into a per-test SQLite file.
Offline, no Meta calls.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import server.api as api
from server.api import app
from server.db import load_project, save_project
from server.scene.models import Scene, Wall
from server.scene.ops import add_wall
from server.scene.variants import Project, create_variant

SAMPLE = Path(__file__).resolve().parents[2] / "samples" / "plans" / "plano_48m_1ambiente.truth.json"
client = TestClient(app)


def _scene() -> Scene:
    return Scene.model_validate(json.loads(SAMPLE.read_text(encoding="utf-8")))


@pytest.fixture
def db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    path = tmp_path / "variants.db"
    monkeypatch.setattr(api, "_DB_PATH", path)
    monkeypatch.setattr(api, "_current", _scene())
    return path


def _labels(body: dict) -> list[str]:
    return [v["label"] for v in body["variants"]]


def test_list_seeds_branch_a_from_the_current_scene(db: Path) -> None:
    res = client.get("/variants")
    assert res.status_code == 200, res.text
    body = res.json()
    assert _labels(body) == ["A"]
    assert body["chosen"] == "A"
    assert body["variants"][0]["scene"]["id"] == _scene().id


def test_list_without_any_scene_is_404(db: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(api, "_current", None)
    assert client.get("/variants").status_code == 404


def test_fork_persists_a_new_branch(db: Path) -> None:
    res = client.post("/variants/fork", json={"label": "B"})
    assert res.status_code == 200, res.text
    assert _labels(res.json()) == ["A", "B"]
    b = res.json()["variants"][1]
    assert b["parent"] == "A"
    assert b["fork_at_version"] == _scene().version
    assert "B" in load_project(db_path=db).branches


def test_fork_from_a_named_branch(db: Path) -> None:
    client.post("/variants/fork", json={"label": "B"})
    res = client.post("/variants/fork", json={"label": "C", "from_branch": "B"})
    assert res.status_code == 200, res.text
    assert res.json()["variants"][2]["parent"] == "B"


def test_fork_existing_label_is_409(db: Path) -> None:
    assert client.post("/variants/fork", json={"label": "A"}).status_code == 409


def test_fork_bad_label_is_400(db: Path) -> None:
    assert client.post("/variants/fork", json={"label": "b"}).status_code == 400


def test_fork_from_unknown_branch_is_404(db: Path) -> None:
    assert client.post("/variants/fork", json={"label": "B", "from_branch": "Z"}).status_code == 404


def test_choose_sets_the_active_variant(db: Path) -> None:
    client.post("/variants/fork", json={"label": "B"})
    res = client.post("/variants/B/choose")
    assert res.status_code == 200, res.text
    assert res.json()["chosen"] == "B"
    assert load_project(db_path=db).chosen == "B"


def test_choose_unknown_branch_is_404(db: Path) -> None:
    assert client.post("/variants/Z/choose").status_code == 404


def _project_with_one_op_in_b(db: Path) -> Scene:
    base = _scene()
    project = create_variant(Project(base=base), "A", "B")
    wall = Wall(id="w_new", a=(0.0, 10.0), b=(2.0, 10.0), thickness_m=0.1, kind="interior")
    _, res = add_wall(base, wall)
    assert res.ok and res.record is not None, res.errors
    project.branches["B"].ops.append(res.record)
    save_project(project, db_path=db)
    return base


def test_undo_drops_the_last_op_of_the_branch_only(db: Path) -> None:
    base = _project_with_one_op_in_b(db)
    before = client.get("/variants").json()["variants"][1]
    assert before["op_count"] == 1
    res = client.post("/variants/undo", json={"label": "B"})
    assert res.status_code == 200, res.text
    assert res.json()["op_count"] == 0
    assert len(res.json()["scene"]["walls"]) == len(base.walls)
    assert load_project(db_path=db).branches["B"].ops == []
    assert client.get("/variants").json()["variants"][1]["op_count"] == 0


def test_undo_defaults_to_the_chosen_branch(db: Path) -> None:
    _project_with_one_op_in_b(db)
    client.post("/variants/B/choose")
    res = client.post("/variants/undo", json={})
    assert res.status_code == 200, res.text
    assert res.json()["label"] == "B"
    assert res.json()["op_count"] == 0


def test_undo_unknown_branch_is_404(db: Path) -> None:
    assert client.post("/variants/undo", json={"label": "Z"}).status_code == 404
