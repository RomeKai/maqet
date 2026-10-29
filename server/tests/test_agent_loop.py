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
            names.append(tool["function"]["name"])
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


def test_single_tool_call() -> None:
    client = ScriptedClient(
        [
            {"calls": [{"name": "add_room", "arguments": _bedroom_args("Dorm", 5.0)}]},
            {"reply": "Listo, agregué el dormitorio. Esto es preliminar."},
        ]
    )
    result = run_turn(
        scene=_base_scene(), history=[], stage="reform",
        user_text="Agregá un dormitorio", client=client,
    )
    assert len(result.scene.rooms) == 2
    assert [e["name"] for e in result.tool_events] == ["add_room"]
    assert result.tool_events[0]["ok"] is True
    assert result.reply == "Listo, agregué el dormitorio. Esto es preliminar."
    assert result.history and result.history[0]["op"] == "add_room"

    first = client.calls[0]
    assert first["input"] == "Agregá un dormitorio"
    assert first["kwargs"]["tag"] == "reform"
    assert first["kwargs"]["prompt_cache_key"] == "reform-v1"
    assert first["kwargs"]["tier"] == "draft"
    assert _tool_names(first["kwargs"]["tools"]) == list(STAGES["reform"])
    assert "Current scene" in first["kwargs"]["instructions"]


def test_multi_step_turn() -> None:
    client = ScriptedClient(
        [
            {"calls": [{"name": "add_room", "arguments": _bedroom_args("Dorm", 5.0)}]},
            {"calls": [{"name": "add_opening",
                        "arguments": {"wall_id": "w1", "kind": "window"}}]},
            {"reply": "Done, bedroom plus window. This is preliminary."},
        ]
    )
    result = run_turn(
        scene=_base_scene(), history=[], stage="reform",
        user_text="Add a bedroom and a window", client=client,
    )
    assert len(result.scene.rooms) == 2
    assert len(result.scene.openings) == 1
    assert [e["name"] for e in result.tool_events] == ["add_room", "add_opening"]
    assert all(e["ok"] for e in result.tool_events)
    assert result.reply.startswith("Done, bedroom")
    # Reasoning threads within the turn via previous_response_id.
    assert client.calls[0]["kwargs"]["previous_response_id"] is None
    assert client.calls[1]["kwargs"]["previous_response_id"] == "resp_scripted_0"
    assert client.calls[2]["kwargs"]["previous_response_id"] == "resp_scripted_1"


def test_rule_violation_surfaced() -> None:
    client = ScriptedClient(
        [
            {"calls": [{"name": "add_opening", "arguments": {
                "wall_id": "w1", "kind": "door", "offset_m": 2.0, "width_m": 0.5}}]},
            {"reply": "I can't put a 0.50 m door there: the minimum door width is "
                      "0.80 m. I left the plan unchanged. This is preliminary."},
        ]
    )
    scene = _base_scene()
    result = run_turn(
        scene=scene, history=[], stage="reform",
        user_text="Put a 50 cm door on the south kitchen wall", client=client,
    )
    # The loop's job is a faithful round-trip, not rewriting the model's
    # words: the failed attempt lands in tool_events, the scripted reply
    # flows through untouched.
    assert len(result.scene.openings) == 0
    assert result.tool_events[0]["ok"] is False
    assert result.tool_events[0]["errors"], "refusal must carry error codes"
    assert "minimum door width is 0.80 m" in result.reply


def test_professional_flag_surfaced() -> None:
    wall = Wall(id="w1", a=(0.0, 0.0), b=(3.0, 0.0), thickness_m=0.20,
                kind="exterior", load_bearing=True)
    scene = Scene(
        id="s", scale_confirmed=True, walls=[wall],
        rooms=[Room(id="r1", name="Kitchen",
                    polygon=[(0.0, 0.0), (3.0, 0.0), (3.0, 3.0), (0.0, 3.0)],
                    function="kitchen")],
    )
    client = ScriptedClient(
        [
            {"calls": [{"name": "remove_wall", "arguments": {"wall_id": "w1"}}]},
            {"reply": "I removed that wall, but it is load-bearing: this needs a "
                      "licensed professional. This is preliminary."},
        ]
    )
    result = run_turn(
        scene=scene, history=[], stage="reform",
        user_text="Remove the wall between the kitchen and the living room",
        client=client,
    )
    assert all(w.id != "w1" for w in result.scene.walls)
    assert result.tool_events[0]["ok"] is True
    assert "needs_professional:load_bearing_wall" in result.tool_events[0]["flags"]
    assert "needs a licensed professional" in result.reply


def test_out_of_stage_refused() -> None:
    client = ScriptedClient(
        [
            {"calls": [{"name": "place_furniture", "arguments": {
                "catalog_id": "cama-doble-01", "room_id": "r1"}}]},
            {"reply": "Los muebles se colocan en Diseño. Esto es preliminar."},
        ]
    )
    result = run_turn(
        scene=_base_scene(), history=[], stage="reform",
        user_text="Poné una cama en el dormitorio", client=client,
    )
    event = result.tool_events[0]
    assert event["ok"] is False
    assert event["errors"] == ["stage.tool_not_allowed"]
    # The structured refusal is fed back as tool output, not pre-filtered.
    follow_up = client.calls[1]["input"]
    assert follow_up[0]["type"] == "function_call_output"
    assert "stage.tool_not_allowed" in follow_up[0]["output"]
    assert result.reply == "Los muebles se colocan en Diseño. Esto es preliminar."


@pytest.mark.parametrize(
    ("user_text", "fragments"),
    [
        ("Add seven more rooms please", ("too many steps", "preliminary")),
        ("Agregá siete cuartos más por favor", ("demasiados pasos", "preliminar")),
    ],
)
def test_six_round_stop(user_text: str, fragments: tuple[str, str]) -> None:
    script = [
        {"calls": [{"name": "add_room",
                    "arguments": _bedroom_args(f"Cuarto {i}", 10.0 * i)}]}
        for i in range(7)
    ]
    client = ScriptedClient(script)
    result = run_turn(
        scene=_base_scene(), history=[], stage="reform",
        user_text=user_text, client=client,
    )
    assert len(result.tool_events) == 6
    assert len(client.calls) == 7
    for fragment in fragments:
        assert fragment in result.reply.casefold()


def test_selected_backfilled() -> None:
    scene = _base_scene()
    scene.walls[0] = scene.walls[0].model_copy(update={"id": "w_n2"})
    client = ScriptedClient(
        [
            {"calls": [{"name": "add_opening", "arguments": {"kind": "window"}}]},
            {"reply": "Done, window on the selected wall. This is preliminary."},
        ]
    )
    result = run_turn(
        scene=scene, history=[], stage="reform", user_text="Add a window here",
        client=client, selected={"kind": "wall", "id": "w_n2"},
    )
    assert result.tool_events[0]["arguments"]["selected"] == {"kind": "wall", "id": "w_n2"}
    assert len(result.scene.openings) == 1
    assert result.scene.openings[0].wall_id == "w_n2"


def test_turn_result_json_serializable() -> None:
    client = ScriptedClient(
        [
            {"calls": [{"name": "add_room", "arguments": _bedroom_args("Dorm", 5.0)}]},
            {"reply": "Done. This is preliminary."},
        ]
    )
    result = run_turn(
        scene=_base_scene(), history=[], stage="reform",
        user_text="Add a bedroom", client=client,
    )
    assert isinstance(result, TurnResult)
    data = json.loads(result.model_dump_json())
    assert data["reply"] == "Done. This is preliminary."
    assert data["scene"]["id"] == "s"
    assert data["history"][0]["op"] == "add_room"
    assert data["tool_events"][0]["name"] == "add_room"


# --- harden-stage edge cases (PLAN.md risks + boundary probes) ---


def test_interim_text_with_calls_keeps_looping() -> None:
    """A response carrying text AND calls is a tool round, not a final reply."""
    client = ScriptedClient(
        [
            {"reply": "On it. ",  # interim text alongside the call
             "calls": [{"name": "add_room", "arguments": _bedroom_args("Dorm", 5.0)}]},
            {"reply": "Done, bedroom added. This is preliminary."},
        ]
    )
    result = run_turn(
        scene=_base_scene(), history=[], stage="reform",
        user_text="Add a bedroom", client=client,
    )
    assert len(result.scene.rooms) == 2
    assert [e["name"] for e in result.tool_events] == ["add_room"]
    # The interim text must NOT leak into the final reply.
    assert result.reply == "Done, bedroom added. This is preliminary."


def test_unknown_tool_name_goes_through_executor() -> None:
    """Unknown tool names are executor refusals, never loop crashes.

    Case 07 pins the same principle for out-of-stage tools: every model
    call goes through execute() and the refusal is fed back as tool output.
    """
    client = ScriptedClient(
        [
            {"calls": [{"name": "demolish_everything", "arguments": {}}]},
            {"reply": "I can't do that. This is preliminary."},
        ]
    )
    result = run_turn(
        scene=_base_scene(), history=[], stage="reform",
        user_text="Demolish everything", client=client,
    )
    event = result.tool_events[0]
    assert event["ok"] is False
    assert event["errors"] == ["tool.unknown_tool"]
    assert len(result.scene.rooms) == 1  # nothing touched
    follow_up = client.calls[1]["input"]
    assert "tool.unknown_tool" in follow_up[0]["output"]


def test_invalid_args_refusal_surfaced() -> None:
    """Pydantic-invalid args fail in the executor; scene unchanged, loop continues."""
    client = ScriptedClient(
        [
            {"calls": [{"name": "add_opening", "arguments": {
                "wall_id": "w1", "kind": "portal"}}]},  # not door/window
            {"reply": "That opening kind isn't supported. This is preliminary."},
        ]
    )
    scene = _base_scene()
    result = run_turn(
        scene=scene, history=[], stage="reform",
        user_text="Add a portal on the south wall", client=client,
    )
    assert len(result.scene.openings) == 0
    assert result.tool_events[0]["ok"] is False
    assert result.tool_events[0]["errors"] == ["tool.invalid_args"]
    assert result.reply == "That opening kind isn't supported. This is preliminary."


def test_parallel_calls_execute_in_order() -> None:
    """Multiple calls in one round execute in order with shared state."""
    client = ScriptedClient(
        [
            {"calls": [
                {"name": "add_room", "arguments": _bedroom_args("Dorm", 5.0)},
                {"name": "undo", "arguments": {}},
            ]},
            {"reply": "Added then undid it. This is preliminary."},
        ]
    )
    scene = _base_scene()
    history: list = []
    result = run_turn(
        scene=scene, history=history, stage="reform",
        user_text="Add a bedroom then undo it", client=client,
    )
    assert [e["name"] for e in result.tool_events] == ["add_room", "undo"]
    assert all(e["ok"] for e in result.tool_events)
    assert len(result.scene.rooms) == 1  # back to the kitchen only
    assert history == []  # add consumed by its own undo
    follow_up = client.calls[1]["input"]
    assert [o["call_id"] for o in follow_up] == ["call_scripted_0_0", "call_scripted_0_1"]


def test_undo_empty_history_refused() -> None:
    """`undo` with no history is a refusal, not a crash; turn completes."""
    client = ScriptedClient(
        [
            {"calls": [{"name": "undo", "arguments": {}}]},
            {"reply": "Nothing to undo yet. This is preliminary."},
        ]
    )
    result = run_turn(
        scene=_base_scene(), history=[], stage="reform",
        user_text="Undo that", client=client,
    )
    assert result.tool_events[0]["ok"] is False
    assert result.tool_events[0]["errors"] == ["history.empty"]
    assert result.reply == "Nothing to undo yet. This is preliminary."


def test_six_round_stop_applies_changes_before_stopping() -> None:
    """The 6-round stop keeps the 6 executed changes; the 7th never runs."""
    script = [
        {"calls": [{"name": "add_room",
                    "arguments": _bedroom_args(f"Cuarto {i}", 10.0 * i)}]}
        for i in range(7)
    ]
    client = ScriptedClient(script)
    result = run_turn(
        scene=_base_scene(), history=[], stage="reform",
        user_text="Add seven more rooms please", client=client,
    )
    assert len(result.tool_events) == 6
    assert len(client.calls) == 7  # no 8th call fetching a 7th round
    assert len(result.scene.rooms) == 1 + 6


def test_unknown_stage_raises_value_error() -> None:
    """A bad stage fails fast with a clear error, not a bare KeyError."""
    client = ScriptedClient([{"reply": "unused"}])
    with pytest.raises(ValueError, match="unknown stage"):
        run_turn(
            scene=_base_scene(), history=[], stage="demolish",
            user_text="hi", client=client,
        )
    assert client.calls == []  # no model call before the stage check


def test_malformed_selected_is_no_tap_context() -> None:
    """Garbage `selected` degrades to no-tap-context; the turn still works."""
    client = ScriptedClient(
        [
            {"calls": [{"name": "add_opening", "arguments": {
                "wall_id": "w1", "kind": "window"}}]},
            {"reply": "Done, window placed. This is preliminary."},
        ]
    )
    result = run_turn(
        scene=_base_scene(), history=[], stage="reform",
        user_text="Add a window", client=client,
        selected={"kind": "", "id": ""},  # malformed: empty keys
    )
    assert "Tap-selected" not in client.calls[0]["kwargs"]["instructions"]
    assert "selected" not in result.tool_events[0]["arguments"]
    assert result.tool_events[0]["ok"] is True
    assert len(result.scene.openings) == 1


@pytest.mark.parametrize("selected", [None, "w_n2", {"kind": "wall"}])
def test_non_dict_selected_never_backfilled(selected: Any) -> None:
    """Non-dict / key-less `selected` never reaches tool args, never crashes."""
    client = ScriptedClient(
        [
            {"calls": [{"name": "add_opening", "arguments": {
                "wall_id": "w1", "kind": "window"}}]},
            {"reply": "Done. This is preliminary."},
        ]
    )
    result = run_turn(
        scene=_base_scene(), history=[], stage="reform",
        user_text="Add a window here", client=client, selected=selected,
    )
    assert "selected" not in result.tool_events[0]["arguments"]
    assert result.tool_events[0]["ok"] is True


def test_model_selected_is_respected_not_overwritten() -> None:
    """Backfill only fills a missing `selected`; an explicit one wins."""
    scene = _base_scene()
    scene.walls[0] = scene.walls[0].model_copy(update={"id": "w_n2"})
    client = ScriptedClient(
        [
            {"calls": [{"name": "add_opening", "arguments": {
                "kind": "window",
                "selected": {"kind": "wall", "id": "w_n2"}}}]},
            {"reply": "Done. This is preliminary."},
        ]
    )
    result = run_turn(
        scene=scene, history=[], stage="reform", user_text="Add a window here",
        client=client, selected=SelectedRef(kind="wall", id="w1"),  # tap ignored
    )
    assert result.tool_events[0]["arguments"]["selected"] == {
        "kind": "wall", "id": "w_n2"}
    assert result.scene.openings[0].wall_id == "w_n2"


def test_selected_not_backfilled_for_tools_without_it() -> None:
    """`add_wall` has no `selected` field: tap context stays out of its args."""
    client = ScriptedClient(
        [
            {"calls": [{"name": "add_wall", "arguments": {
                "a": [0.0, 0.0], "b": [2.0, 0.0]}}]},
            {"reply": "Done. This is preliminary."},
        ]
    )
    result = run_turn(
        scene=_base_scene(), history=[], stage="reform",
        user_text="Add a wall here", client=client,
        selected={"kind": "wall", "id": "w_n2"},
    )
    assert "selected" not in result.tool_events[0]["arguments"]
    assert result.tool_events[0]["ok"] is True


def test_result_history_is_a_snapshot_not_a_view() -> None:
    """Mutating the caller's history after the turn must not rewrite the result."""
    client = ScriptedClient(
        [
            {"calls": [{"name": "add_room", "arguments": _bedroom_args("Dorm", 5.0)}]},
            {"reply": "Done. This is preliminary."},
        ]
    )
    history: list = []
    result = run_turn(
        scene=_base_scene(), history=history, stage="reform",
        user_text="Add a bedroom", client=client,
    )
    assert len(result.history) == 1
    history.clear()
    assert len(result.history) == 1  # snapshot survived the caller's clear
