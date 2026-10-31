"""Room-aware addressing (bug X): the model names rooms and sides, never wall numbers."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from server.agent.addressing import resolve_room, resolve_wall_target, wall_table
from server.agent.executor import execute
from server.agent.loop import run_turn
from server.api import app
from server.scene.models import Scene
from server.tests.test_agent_loop import ScriptedClient


@pytest.fixture(scope="module")
def sample() -> Scene:
    res = TestClient(app).post("/intake", data={"kind": "plan", "sample": "croquis_3x8_door_window"})
    assert res.status_code == 200, res.text
    return Scene.model_validate(res.json()["scene"])


@pytest.fixture(scope="module")
def with_room(sample: Scene) -> Scene:
    new, res = execute(
        sample, [], "reform", "add_room",
        {"function": "bedroom", "name": "Bedroom 2", "next_to": sample.rooms[0].id,
         "size_m": [3.0, 4.0], "wall": "wall 1"},
    )
    assert res.ok, res.errors
    return new


def test_new_room_aliases_resolve_to_the_last_added(with_room: Scene) -> None:
    last = with_room.rooms[-1]
    for ref in ("new", "the new room", "last added room", "latest", "Bedroom 2", last.id):
        assert resolve_room(with_room, ref) is last, ref
    assert resolve_room(with_room, "nonexistent") is None


def test_tool_result_returns_the_current_wall_table(sample: Scene, with_room: Scene) -> None:
    _, res = execute(
        sample, [], "reform", "add_room",
        {"function": "bedroom", "name": "Bedroom 2", "next_to": sample.rooms[0].id,
         "size_m": [3.0, 4.0], "wall": "wall 1"},
    )
    rows = res.data["walls"]
    assert len(rows) == len(with_room.walls)
    assert {"label", "orientation", "length_m", "rooms", "openings"} <= set(rows[0])
    assert any("Bedroom 2" in r["rooms"] for r in rows)
    assert any(r["openings"] for r in rows)  # the connecting door


def test_window_on_the_new_room_by_room_and_side(with_room: Scene) -> None:
    room = with_room.rooms[-1]
    # the sides of the new room: one is shared with the house, the others are exterior
    outer = [s for s in ("north", "south", "east", "west")
             if resolve_wall_target(with_room, room=room.name, side=s)[0] is not None]
    assert outer
    new, res = execute(with_room, [], "reform", "add_opening",
                       {"room": "new", "side": outer[0], "kind": "window"})
    assert res.ok, res.errors
    assert len(new.openings) == len(with_room.openings) + 1
    wid = new.openings[-1].wall_id
    assert wid in {w.id for w in new.walls}


def test_exterior_and_shared_sides(with_room: Scene) -> None:
    shared, err = resolve_wall_target(with_room, room="new", side="shared")
    assert err is None and shared is not None  # exactly one wall joins the house
    _, err = resolve_wall_target(with_room, room="new", side="exterior")
    assert err is not None and "several exterior walls" in err  # three outer walls: ask a side


def test_described_wall_is_understood(with_room: Scene) -> None:
    """The live model wrote 'north wall of the new bedroom': code resolves it."""
    wid, err = resolve_wall_target(with_room, ref="north wall of the new bedroom")
    assert err is None and wid is not None


def test_a_wall_that_does_not_exist_lists_the_valid_ones(with_room: Scene) -> None:
    _, res = execute(with_room, [], "reform", "add_opening", {"wall": "wall 99", "kind": "window"})
    assert not res.ok
    msg = res.errors[0].message
    assert "wall 99" in msg and "valid walls:" in msg and "wall 1" in msg
    _, res = execute(with_room, [], "reform", "add_opening",
                     {"room": "Bedroom 2", "wall": "wall 99", "kind": "window"})
    assert "valid walls of Bedroom 2:" in res.errors[0].message
    _, res = execute(with_room, [], "reform", "add_opening", {"room": "kitchen2", "side": "north"})
    assert "valid rooms:" in res.errors[0].message


def test_unknown_room_in_resize_lists_rooms(with_room: Scene) -> None:
    _, res = execute(with_room, [], "reform", "resize_room", {"room": "attic", "width_m": 3, "depth_m": 3})
    assert not res.ok and "valid rooms:" in res.errors[0].message


def test_wall_table_marks_rooms_of_each_wall(with_room: Scene) -> None:
    rows = wall_table(with_room)
    assert sum(1 for r in rows if len(r["rooms"]) == 2) == 1  # the shared wall


def test_scene_summary_in_instructions_is_rebuilt_after_each_op(sample: Scene) -> None:
    """The instructions of round 2 must show the room added in round 1."""
    client = ScriptedClient(
        [
            {"calls": [{"name": "add_room", "arguments": {
                "function": "bedroom", "name": "Bedroom 2", "next_to": sample.rooms[0].id,
                "size_m": [3.0, 4.0], "wall": "wall 1"}}]},
            {"reply": "Added."},
        ]
    )
    run_turn(sample, [], "reform", "add a 3x4 bedroom", client)
    first, second = client.calls[0]["kwargs"]["instructions"], client.calls[1]["kwargs"]["instructions"]
    assert "Bedroom 2" not in first
    assert "Bedroom 2" in second
