"""Reform edit tools: resize_room, set_wall_length, move_wall, set_opening_size,
split_room, rename_room. Geometry is computed in code (ADR-002)."""

from __future__ import annotations

import pytest

from server.agent.executor import execute
from server.agent.stages import allowed_tools
from server.scene import ops
from server.scene.models import Room, Scene, Wall


def _house() -> Scene:
    w = lambda i, a, b: Wall(id=i, a=a, b=b, thickness_m=0.20, kind="exterior")  # noqa: E731
    return Scene(
        id="s",
        scale_confirmed=True,
        walls=[
            w("w1", (0.0, 0.0), (8.0, 0.0)),
            w("w2", (8.0, 0.0), (8.0, 3.0)),
            w("w3", (8.0, 3.0), (0.0, 3.0)),
            w("w4", (0.0, 3.0), (0.0, 0.0)),
        ],
        rooms=[
            Room(
                id="r1",
                name="House",
                polygon=[(0.0, 0.0), (8.0, 0.0), (8.0, 3.0), (0.0, 3.0)],
                function="living",
            )
        ],
    )


def _with_bedroom() -> tuple[Scene, list]:
    history: list = []
    scene, res = execute(
        _house(), history, "reform", "add_room",
        {"name": "Bedroom", "function": "bedroom", "next_to": "r1", "size_m": [3.0, 3.0]},
    )
    assert res.ok, res.errors
    return scene, history


def _room(scene: Scene, name: str) -> Room:
    return next(r for r in scene.rooms if r.name == name)


def _bbox(room: Room) -> tuple[float, float, float, float]:
    xs, ys = [p[0] for p in room.polygon], [p[1] for p in room.polygon]
    return min(xs), min(ys), max(xs), max(ys)


def test_tools_are_in_reform_stage() -> None:
    for tool in ("resize_room", "set_wall_length", "move_wall",
                 "set_opening_size", "split_room", "rename_room"):
        assert tool in allowed_tools("reform")


def test_resize_room_changes_measures_and_moves_walls() -> None:
    scene, history = _with_bedroom()
    new, res = execute(scene, history, "reform", "resize_room",
                       {"room": "Bedroom", "width_m": 3.5, "depth_m": 4.0})
    assert res.ok, res.errors
    x0, y0, x1, y1 = _bbox(_room(new, "Bedroom"))
    assert (x0, y0) == (8.0, 0.0)
    assert (round(x1 - x0, 6), round(y1 - y0, 6)) == (3.5, 4.0)


def test_resize_room_is_undoable() -> None:
    scene, history = _with_bedroom()
    new, res = execute(scene, history, "reform", "resize_room",
                       {"room": "Bedroom", "width_m": 3.5, "depth_m": 4.0})
    assert res.ok
    undone, ures = execute(new, history, "reform", "undo", {})
    assert ures.ok, ures.errors
    assert [w.model_dump() for w in undone.walls] == [w.model_dump() for w in scene.walls]


def test_resize_room_warns_below_minimum_side() -> None:
    scene, history = _with_bedroom()
    _, res = execute(scene, history, "reform", "resize_room",
                     {"room": "Bedroom", "width_m": 0.5, "depth_m": 3.0})
    # rules.py reports sub-minimum sides as a warning the agent must relay.
    assert any("narrow side" in w for w in res.warnings)


def test_set_wall_length_moves_connected_walls() -> None:
    scene, history = _with_bedroom()
    far = next(w for w in scene.walls if w.a[0] == 11.0 and w.b[0] == 11.0)  # east wall
    new, res = execute(scene, history, "reform", "set_wall_length",
                       {"wall": far.id, "length_m": 3.6})
    assert res.ok, res.errors
    assert abs(next(w for w in new.walls if w.id == far.id).a[1]
               - next(w for w in new.walls if w.id == far.id).b[1]) == pytest.approx(3.6)


def test_move_wall_shifts_wall_and_stretches_neighbours() -> None:
    scene, history = _with_bedroom()
    far = next(w for w in scene.walls if w.a[0] == 11.0 and w.b[0] == 11.0)
    new, res = execute(scene, history, "reform", "move_wall",
                       {"wall": far.id, "offset_m": 0.5})
    assert res.ok, res.errors
    moved = next(w for w in new.walls if w.id == far.id)
    assert {moved.a[0], moved.b[0]} == {11.5}


def test_set_opening_size_updates_width() -> None:
    scene, history = _with_bedroom()
    door = scene.openings[0]
    new, res = execute(scene, history, "reform", "set_opening_size",
                       {"opening": door.id, "width_m": 1.0})
    assert res.ok, res.errors
    assert next(o for o in new.openings if o.id == door.id).width_m == 1.0


def test_set_opening_size_warns_below_door_minimum() -> None:
    scene, history = _with_bedroom()
    door = scene.openings[0]
    _, res = execute(scene, history, "reform", "set_opening_size",
                     {"opening": door.id, "width_m": 0.5})
    assert any("door" in w.lower() and "0.80" in w for w in res.warnings), res.warnings


def test_split_room_adds_interior_partition() -> None:
    scene, history = _house_big()
    new, res = execute(scene, history, "reform", "split_room",
                       {"room": "r1", "axis": "x", "at_ratio": 0.5})
    assert res.ok, res.errors
    added = [w for w in new.walls if w.id not in {x.id for x in scene.walls}]
    assert len(added) == 1 and added[0].kind == "interior"
    assert added[0].thickness_m == pytest.approx(0.10)
    assert len(new.rooms) == 2


def _house_big() -> tuple[Scene, list]:
    s = _house()
    s = s.model_copy(update={"walls": [
        Wall(id="w1", a=(0.0, 0.0), b=(8.0, 0.0), thickness_m=0.2, kind="exterior"),
        Wall(id="w2", a=(8.0, 0.0), b=(8.0, 4.0), thickness_m=0.2, kind="exterior"),
        Wall(id="w3", a=(8.0, 4.0), b=(0.0, 4.0), thickness_m=0.2, kind="exterior"),
        Wall(id="w4", a=(0.0, 4.0), b=(0.0, 0.0), thickness_m=0.2, kind="exterior"),
    ], "rooms": [Room(id="r1", name="House",
                      polygon=[(0.0, 0.0), (8.0, 0.0), (8.0, 4.0), (0.0, 4.0)],
                      function="living")]})
    return s, []


def test_rename_room_sets_name_and_function() -> None:
    scene, history = _with_bedroom()
    new, res = execute(scene, history, "reform", "rename_room",
                       {"room": "Bedroom", "name": "Study", "function": "dining"})
    assert res.ok, res.errors
    room = next(r for r in new.rooms if r.id == _room(scene, "Bedroom").id)
    assert room.name == "Study" and room.function == "dining"


def test_unknown_room_is_an_anchor_error() -> None:
    scene, history = _with_bedroom()
    same, res = execute(scene, history, "reform", "resize_room",
                        {"room": "Garage", "width_m": 3, "depth_m": 3})
    assert not res.ok and res.errors[0].code == "anchor.unknown"


def test_history_replay_reproduces_edit() -> None:
    base = _house()
    scene, history = _with_bedroom()
    new, res = execute(scene, history, "reform", "resize_room",
                       {"room": "Bedroom", "width_m": 3.5, "depth_m": 4.0})
    assert res.ok
    rebuilt = ops.replay(base, history)
    assert [w.model_dump() for w in rebuilt.walls] == [w.model_dump() for w in new.walls]


# --- windows get a sill and head height from rules.py (bug G) -------------------


def test_new_window_has_default_sill_and_height() -> None:
    from server.scene.rules import WINDOW_HEIGHT_M, WINDOW_SILL_M

    scene, history = _with_bedroom()
    new, res = execute(scene, history, "reform", "add_opening",
                       {"wall_id": "w1", "kind": "window", "at_ratio": 0.5})
    assert res.ok, res.errors
    window = next(o for o in new.openings if o.kind == "window")
    assert window.sill_m == WINDOW_SILL_M == 0.90
    assert window.height_m == WINDOW_HEIGHT_M == 1.20
    assert window.sill_m + window.height_m <= new.ceiling_height_m


def test_door_keeps_sill_zero() -> None:
    scene, history = _with_bedroom()
    new, res = execute(scene, history, "reform", "add_opening",
                       {"wall_id": "w1", "kind": "door", "at_ratio": 0.2})
    assert res.ok, res.errors
    door = next(o for o in new.openings if o.id == res.changed_ids[0])
    assert not door.sill_m


def test_set_opening_size_gives_a_window_without_sill_the_default() -> None:
    from server.scene.models import Opening

    scene, history = _with_bedroom()
    legacy = Opening(id="vv", wall_id="w1", kind="window", offset_m=1.0, width_m=1.0, height_m=1.0)
    scene = scene.model_copy(update={"openings": [*scene.openings, legacy]})
    new, res = execute(scene, history, "reform", "set_opening_size", {"opening": "vv", "width_m": 1.4})
    assert res.ok, res.errors
    assert next(o for o in new.openings if o.id == "vv").sill_m == 0.90
