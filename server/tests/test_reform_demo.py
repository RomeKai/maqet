"""Agent loop tests (mission agent-loop, stage 2/4 build).

TDD: written before server/agent/loop.py. No model calls anywhere — a
scripted fake speaks raw Responses-API dicts shaped exactly like the real
`mme.client` output, so the loop parses them with its production helpers.
"""

from __future__ import annotations

import json
from typing import Any

import pytest

from server.agent.loop import TurnResult, run_turn
from server.agent.stages import STAGES
from server.agent.tools import SelectedRef
from server.scene.models import Room, Scene, Wall


class ScriptedClient:
    """Fake client: replays scripted Responses-API turns, logs every call."""

    def __init__(self, script: list[dict[str, Any]]) -> None:
        self._queue = [self._raw(step, i) for i, step in enumerate(script)]
        self.calls: list[dict[str, Any]] = []

    @staticmethod
    def _raw(step: dict[str, Any], i: int) -> dict[str, Any]:
        # A step may carry "reply", "calls", or both (interim text + calls
        # in one response — the loop must keep looping on the calls and
        # only return the final text-only reply).
        output: list[dict[str, Any]] = []
        if "reply" in step:
            output.append(
                {
                    "type": "message",
                    "content": [{"type": "output_text", "text": step["reply"]}],
                }
            )
        output.extend(
            {
                "type": "function_call",
                "call_id": f"call_scripted_{i}_{j}",
                "name": c["name"],
                "arguments": json.dumps(c.get("arguments", {})),
            }
            for j, c in enumerate(step.get("calls", []))
        )
        return {"id": f"resp_scripted_{i}", "output": output}

    def respond(self, input: Any, **kwargs: Any) -> dict[str, Any]:
        self.calls.append({"input": input, "kwargs": kwargs})
        assert self._queue, "script exhausted: loop made more model calls than scripted"
        return self._queue.pop(0)

    @staticmethod
    def output_text(response: dict[str, Any]) -> str:
        parts = []
        for item in response.get("output", []):
            if item.get("type") == "message":
                parts += [
                    c.get("text", "")
                    for c in item.get("content", [])
                    if c.get("type") == "output_text"
                ]
        return "".join(parts)

    @staticmethod
    def tool_calls(response: dict[str, Any]) -> list[dict[str, Any]]:
        calls = []
        for item in response.get("output", []):
            if item.get("type") == "function_call":
                args = item.get("arguments") or "{}"
                calls.append(
                    {
                        "call_id": item.get("call_id") or item.get("id"),
                        "name": item.get("name"),
                        "arguments": json.loads(args) if isinstance(args, str) else args,
                    }
                )
        return calls


def _tool_names(tools: list[dict[str, Any]]) -> list[str]:
    """Extract offered tool names whatever the function-tool envelope is."""
    names = []
    for tool in tools:
        if isinstance(tool.get("function"), dict):
            names.append(tool["name"])
        else:
            names.append(tool["name"])
    return names


def _base_scene() -> Scene:
    # 4x3 kitchen (12 m2, side 3 m): passes habitable minimums, no span flags
    # (w1 is exactly 4.00 m, the limit is strict >).
    return Scene(
        id="s",
        scale_confirmed=True,
        walls=[
            Wall(id="w1", a=(0.0, 0.0), b=(4.0, 0.0), thickness_m=0.20, kind="exterior"),
            Wall(id="w2", a=(4.0, 0.0), b=(4.0, 3.0), thickness_m=0.20, kind="exterior"),
            Wall(id="w3", a=(4.0, 3.0), b=(0.0, 3.0), thickness_m=0.20, kind="exterior"),
            Wall(id="w4", a=(0.0, 3.0), b=(0.0, 0.0), thickness_m=0.20, kind="exterior"),
        ],
        rooms=[
            Room(
                id="r1",
                name="Kitchen",
                polygon=[(0.0, 0.0), (4.0, 0.0), (4.0, 3.0), (0.0, 3.0)],
                function="kitchen",
            )
        ],
    )


def _bedroom_args(name: str, x0: float) -> dict[str, Any]:
    return {
        "function": "bedroom",
        "name": name,
        "polygon": [[x0, 0.0], [x0 + 3.0, 0.0], [x0 + 3.0, 3.0], [x0, 3.0]],
    }


import pathlib as _pathlib
import json as _json

TRUTH_PATH = _pathlib.Path(__file__).resolve().parents[2] / "samples" / "plans" / "croquis_3x8_door_window.truth.json"
SCRIPT_PATH = _pathlib.Path(__file__).resolve().parents[2] / "samples" / "demo" / "reform_script.json"


def _truth_scene() -> Scene:
    raw = _json.loads(TRUTH_PATH.read_text(encoding="utf-8"))
    return Scene.model_validate(raw)


def _script() -> dict[str, Any]:
    return _json.loads(SCRIPT_PATH.read_text(encoding="utf-8"))


def _steps(turn: dict[str, Any]) -> list[dict[str, Any]]:
    steps: list[dict[str, Any]] = []
    if turn.get("calls"):
        steps.append({"calls": turn["calls"]})
    steps.append({"reply": turn["reply"]})
    return steps


def _run_up_to(n: int) -> tuple[Scene, list, list[str]]:
    sc = _script()
    scene = _truth_scene()
    history: list = []
    replies: list[str] = []
    for i in range(n):
        client = ScriptedClient(_steps(sc["turns"][i]))
        result = run_turn(scene, history, sc["stage"], sc["turns"][i]["user_text"], client)
        scene = result.scene
        replies.append(result.reply)
    return scene, history, replies


def _run_all() -> tuple[Scene, list, list[str]]:
    return _run_up_to(4)


def test_demo_script_shape() -> None:
    sc = _script()
    assert sc["stage"] == "reform"
    assert len(sc["turns"]) == 4
    for t in sc["turns"]:
        assert t["user_text"].strip()
        assert t["reply"].strip()


def test_turn1_adds_a_room() -> None:
    sc = _script()
    scene = _truth_scene()
    base_rooms = len(scene.rooms)
    base_walls = len(scene.walls)
    history: list = []
    turn = sc["turns"][0]
    client = ScriptedClient(_steps(turn))
    result = run_turn(scene, history, sc["stage"], turn["user_text"], client)
    assert len(result.scene.rooms) == base_rooms + 1
    assert len(result.scene.walls) == base_walls + 3  # shared wall reused
    assert any(r.function == "bedroom" for r in result.scene.rooms)
    assert "preliminar" in result.reply.casefold()
    assert client.calls[0]["kwargs"]["tag"] == "reform"
    assert client.calls[0]["kwargs"]["prompt_cache_key"] == "reform-v1"


def test_turn2_adds_a_door_at_least_80cm() -> None:
    sc = _script()
    scene, history, _ = _run_up_to(1)
    turn = sc["turns"][1]
    client = ScriptedClient(_steps(turn))
    result = run_turn(scene, history, sc["stage"], turn["user_text"], client)
    doors = [o for o in result.scene.openings if o.kind == "door"]
    assert doors
    assert max(d.width_m for d in doors) >= 0.80
    on_w2 = [d for d in doors if d.wall_id == "w2"]
    assert on_w2 and on_w2[0].width_m == 0.90
    assert "preliminar" in result.reply.casefold()


def test_turn3_adds_a_wall_and_a_window() -> None:
    sc = _script()
    scene, history, _ = _run_up_to(2)
    turn = sc["turns"][2]
    client = ScriptedClient(_steps(turn))
    result = run_turn(scene, history, sc["stage"], turn["user_text"], client)
    assert len(result.scene.walls) == 8  # 4 + 3 room walls + 1 added
    windows = [o for o in result.scene.openings if o.kind == "window"]
    assert len(windows) >= 2
    assert any(o.wall_id == "w5" and o.kind == "window" for o in result.scene.openings)
    wall_ids = {w.id for w in result.scene.walls}
    assert all(o.wall_id in wall_ids for o in result.scene.openings)
    assert [e["name"] for e in result.tool_events] == ["add_wall", "add_opening"]
    assert all(e["ok"] for e in result.tool_events)
    assert "preliminar" in result.reply.casefold()


def test_turn4_read_only_surfaces_what_is_missing() -> None:
    sc = _script()
    scene, history, _ = _run_up_to(3)
    turn = sc["turns"][3]
    client = ScriptedClient(_steps(turn))
    result = run_turn(scene, history, sc["stage"], turn["user_text"], client)
    assert result.tool_events == []
    assert len(result.scene.rooms) == 2
    assert len(result.scene.walls) == 8
    assert "preliminar" in result.reply.casefold()
    assert len(history) == 4


def test_full_script_preliminary_every_turn_and_no_errors() -> None:
    from server.scene.validation import validate_scene
    scene, _, replies = _run_all()
    assert len(replies) == 4
    for reply in replies:
        assert "preliminar" in reply.casefold()
    assert all(o.width_m >= 0.80 for o in scene.openings if o.kind == "door")
    assert any(o.kind == "window" and o.wall_id == "w5" for o in scene.openings)
    assert validate_scene(scene).errors == ()


def test_rule_warnings_visible_after_each_turn() -> None:
    from server.scene.validation import validate_scene
    sc = _script()
    scene = _truth_scene()
    history: list = []
    for turn in sc["turns"]:
        client = ScriptedClient(_steps(turn))
        result = run_turn(scene, history, sc["stage"], turn["user_text"], client)
        scene = result.scene
        report = validate_scene(scene)
        assert isinstance(report.warnings, tuple)
        assert isinstance(report.flags, tuple)


def test_api_turn_over_http_with_scripted_client() -> None:
    from fastapi.testclient import TestClient
    from server.api import app, get_reform_client
    sc = _script()
    truth_dict = _json.loads(TRUTH_PATH.read_text(encoding="utf-8"))
    turn = sc["turns"][0]
    steps = _steps(turn)
    holder: dict[str, Any] = {}
    def _factory() -> Any:
        if "c" not in holder:
            holder["c"] = ScriptedClient(steps)
        return holder["c"]
    app.dependency_overrides[get_reform_client] = _factory
    try:
        http = TestClient(app)
        res = http.post("/agent/turn", json={"scene": truth_dict, "stage": "reform", "message": turn["user_text"]})
        assert res.status_code == 200, res.text
        body = res.json()
        assert len(body["scene"]["rooms"]) == 2
        assert "preliminar" in body["reply"].casefold()
        assert body["ops_applied"][0]["name"] == "add_room"
    finally:
        app.dependency_overrides.pop(get_reform_client, None)
