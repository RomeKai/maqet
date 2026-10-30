"""POST /agent/edit: one deterministic reform edit, no model call (ADR-002)."""

from __future__ import annotations

from fastapi.testclient import TestClient

from server.api import app
from server.tests.test_edit_tools import _house

client = TestClient(app)


def _post(**body):
    return client.post("/agent/edit", json=body)


def test_edit_resizes_a_room_without_a_model() -> None:
    res = _post(
        scene=_house().model_dump(), tool="resize_room",
        args={"room": "r1", "width_m": 7.0, "depth_m": 3.0}, history=[],
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["scene"]["version"] == 1
    assert len(body["history"]) == 1
    xs = {p[0] for p in body["scene"]["rooms"][0]["polygon"]}
    assert max(xs) == 7.0


def test_edit_undo_round_trips_through_history() -> None:
    first = _post(
        scene=_house().model_dump(), tool="set_wall_length",
        args={"wall": "w1", "length_m": 6.0}, history=[],
    ).json()
    undone = _post(scene=first["scene"], tool="undo", args={}, history=first["history"])
    assert undone.status_code == 200, undone.text
    assert undone.json()["scene"]["walls"] == _house().model_dump(mode="json")["walls"]


def test_edit_rejects_non_edit_tools() -> None:
    res = _post(scene=_house().model_dump(), tool="add_room", args={}, history=[])
    assert res.status_code == 422


def test_edit_failure_is_a_422_with_the_tool_error() -> None:
    res = _post(
        scene=_house().model_dump(), tool="resize_room",
        args={"room": "nope", "width_m": 3, "depth_m": 3}, history=[],
    )
    assert res.status_code == 422
    assert "no room matches" in res.text
