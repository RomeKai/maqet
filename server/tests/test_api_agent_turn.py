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


def _next(first: dict, message: str) -> Any:
    return client.post(
        "/agent/turn",
        json={
            "scene": first["scene"],
            "stage": "reform",
            "message": message,
            "history": first["history"],
        },
    )


def test_second_turn_applies_on_top_of_the_first(script: list) -> None:
    script += [
        {"calls": [{"name": "add_room", "arguments": {
            "function": "bedroom", "name": "Bedroom", "next_to": "Cocina", "size_m": [3.0, 3.5],
        }}]},
        {"reply": "Added the bedroom."},
        {"calls": [{"name": "add_opening", "arguments": {
            "wall_id": "w_s2", "kind": "window", "at_ratio": 0.2,
        }}]},
        {"reply": "Added a window."},
    ]
    first = _turn(message="Add a bedroom next to the kitchen").json()
    res = _next(first, "Add a window")
    assert res.status_code == 200, res.text
    second = res.json()
    assert [op["name"] for op in second["ops_applied"]] == ["add_opening"]
    assert len(second["scene"]["rooms"]) == len(first["scene"]["rooms"])  # room kept
    assert len(second["scene"]["walls"]) == len(first["scene"]["walls"])
    assert len(second["history"]) == 2
    assert second["scene"]["version"] == first["scene"]["version"] + 1


def test_failed_tool_errors_reach_the_user_not_just_the_model(script: list) -> None:
    script += [
        {"calls": [{"name": "add_opening", "arguments": {"wall_id": "nope", "kind": "door"}}]},
        {"reply": "Done."},
    ]
    body = _turn(message="Add a door").json()
    assert body["ops_applied"] == []
    assert any("does not exist; valid walls" in e for e in body["tool_errors"]), body


def test_replay_miss_on_an_agent_turn_is_409_not_500() -> None:
    """E2E-005: an unrecorded turn in MME_MODE=replay answers 409 with a readable detail."""
    from fastapi.testclient import TestClient as _TC

    from server import api

    c = _TC(api.app)
    scene = c.post("/intake", data={"kind": "plan", "sample": "croquis_3x8_door_window"}).json()["scene"]
    res = c.post(
        "/agent/turn",
        json={"scene": scene, "message": "a turn nobody recorded", "stage": "reform", "history": []},
    )
    assert res.status_code == 409, res.text
    assert "no recorded agent response" in res.json()["detail"]


def test_conversation_in_the_request_reaches_the_model_input(script: list) -> None:
    """Bug T: the endpoint forwards the chat so the model remembers the question it asked."""
    seen: list[Any] = []

    class Spy(ScriptedClient):
        def respond(self, input: Any, **kwargs: Any) -> dict[str, Any]:
            seen.append(input)
            return super().respond(input, **kwargs)

    steps = [{"reply": "Done."}]
    app.dependency_overrides[get_reform_client] = lambda: Spy(steps)
    res = _turn(
        message="wall 3",
        conversation=[
            {"role": "user", "text": "add a 3x4 bedroom"},
            {"role": "assistant", "text": "Which wall?"},
        ],
    )
    assert res.status_code == 200, res.text
    assert seen[0] == [
        {"role": "user", "content": "add a 3x4 bedroom"},
        {"role": "assistant", "content": "Which wall?"},
        {"role": "user", "content": "wall 3"},
    ]
