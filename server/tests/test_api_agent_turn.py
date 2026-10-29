"""POST /agent/turn: one reform-agent turn over HTTP (ADR-002, ADR-014).

The route runs `server.agent.loop.run_turn` with the stage-scoped toolset.
Tests swap the Meta client for the scripted eval client through
`app.dependency_overrides`; the one test that keeps the real `mme.client`
proves a turn with no recording answers 409 like /transcribe.
Offline, MME_MODE=replay, no Meta calls.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from server.api import app, get_reform_client
from server.tests.agent_evals.test_agent_evals import ScriptedClient

SAMPLE = Path(__file__).resolve().parents[2] / "samples" / "plans" / "plano_48m_1ambiente.truth.json"
client = TestClient(app)


def _scene() -> dict[str, Any]:
    return json.loads(SAMPLE.read_text(encoding="utf-8"))


@pytest.fixture
def script() -> Iterator[list[dict[str, Any]]]:
    steps: list[dict[str, Any]] = []
    shared: dict[str, ScriptedClient] = {}  # one script across turns of a test
    app.dependency_overrides[get_reform_client] = lambda: shared.setdefault("c", ScriptedClient(steps))
    yield steps
    app.dependency_overrides.pop(get_reform_client, None)


def _turn(**body: Any) -> Any:
    return client.post("/agent/turn", json={"scene": _scene(), "stage": "reform", **body})


def test_turn_applies_ops_and_returns_the_new_scene(script: list) -> None:
    script += [
        {"calls": [{"name": "add_room", "arguments": {
            "function": "bedroom", "name": "Dormitorio", "next_to": "Cocina", "size_m": [3.0, 3.5],
        }}]},
        {"reply": "Listo, agregué el dormitorio. Esto es preliminar."},
    ]
    res = _turn(message="Agregá un dormitorio al lado de la cocina")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["reply"].startswith("Listo")
    assert len(body["scene"]["rooms"]) == len(_scene()["rooms"]) + 1
    assert [op["name"] for op in body["ops_applied"]] == ["add_room"]
    assert len(body["history"]) == 1
    assert body["professional_flags"] == []


def test_failed_tool_calls_are_not_reported_as_applied(script: list) -> None:
    script += [
        {"calls": [{"name": "remove_wall", "arguments": {"wall_id": "nope"}}]},
        {"reply": "No encontré esa pared."},
    ]
    res = _turn(message="Sacá esa pared")
    assert res.status_code == 200, res.text
    assert res.json()["ops_applied"] == []
    assert res.json()["scene"]["version"] == _scene()["version"]


def test_second_floor_raises_the_professional_flag(script: list) -> None:
    script += [
        {"calls": [{"name": "add_room", "arguments": {
            "function": "bedroom", "next_to": "Cocina", "level": 2,
        }}]},
        {"reply": "Preliminary: a second floor needs a licensed professional."},
    ]
    res = _turn(message="Add a bedroom upstairs")
    assert res.status_code == 200, res.text
    assert res.json()["professional_flags"], res.json()


def test_history_round_trips_so_undo_works_next_turn(script: list) -> None:
    script += [
        {"calls": [{"name": "add_room", "arguments": {"function": "bedroom", "next_to": "Cocina"}}]},
        {"reply": "Added."},
        {"calls": [{"name": "undo", "arguments": {}}]},
        {"reply": "Undone."},
    ]
    first = _turn(message="Add a bedroom").json()
    res = client.post(
        "/agent/turn",
        json={"scene": first["scene"], "stage": "reform", "message": "Undo that", "history": first["history"]},
    )
    assert res.status_code == 200, res.text
    assert len(res.json()["scene"]["rooms"]) == len(_scene()["rooms"])
    assert res.json()["history"] == []


def test_out_of_stage_tool_is_refused(script: list) -> None:
    script += [
        {"calls": [{"name": "place_furniture", "arguments": {"catalog_id": "bed"}}]},
        {"reply": "That belongs to the Design stage."},
    ]
    res = _turn(message="Put a bed here")
    assert res.status_code == 200, res.text
    assert res.json()["ops_applied"] == []


@pytest.mark.parametrize(
    "body",
    [
        {"message": "", "stage": "reform"},
        {"message": "hi", "stage": "deliver"},
        {"message": "hi", "stage": "reform", "history": [{"op": "add_room"}]},
    ],
)
def test_bad_request_bodies_are_422(body: dict) -> None:
    res = client.post("/agent/turn", json={"scene": _scene(), **body})
    assert res.status_code == 422


def test_turn_without_a_recording_is_409() -> None:
    res = _turn(message="Agregá un dormitorio al lado de la cocina")
    assert res.status_code == 409, res.text
    assert "record" in res.json()["detail"]
