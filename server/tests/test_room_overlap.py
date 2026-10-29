"""Overlapping rooms never reach the Scene (validation + add_room next_to).

next_to used to always place the new room east of the anchor, on top of
whatever was there (eval 01: bedroom next to the kitchen landed on the
bath). Offline, no Meta calls.
"""

from __future__ import annotations

import json
from pathlib import Path

from server.agent.executor import execute
from server.scene import ops
from server.scene.models import Room, Scene
from server.scene.rules import CODE_ROOM_OVERLAP
from server.scene.validation import rooms_overlap_m2, validate_scene

SAMPLE = Path(__file__).resolve().parents[2] / "samples" / "plans" / "plano_48m_1ambiente.truth.json"


def _rect(rid: str, x0: float, y0: float, w: float, h: float) -> Room:
    return Room(
        id=rid,
        name=rid,
        polygon=[(x0, y0), (x0 + w, y0), (x0 + w, y0 + h), (x0, y0 + h)],
    )


def _sample() -> Scene:
    return Scene.model_validate(json.loads(SAMPLE.read_text(encoding="utf-8")))


def test_validation_rejects_overlapping_rooms_with_code() -> None:
    scene = Scene(id="o", rooms=[_rect("ra", 0, 0, 3, 3), _rect("rb", 2, 0, 3, 3)])
    report = validate_scene(scene)
    overlaps = [e for e in report.errors if getattr(e, "code", None) == CODE_ROOM_OVERLAP]
    assert len(overlaps) == 1
    assert "ra" in overlaps[0] and "rb" in overlaps[0]
    assert overlaps[0].params["overlap_m2"] == 3.0


def test_rooms_sharing_an_edge_do_not_overlap() -> None:
    assert rooms_overlap_m2(_rect("ra", 0, 0, 3, 3), _rect("rb", 3, 0, 3, 3)) == 0.0
    scene = Scene(id="t", rooms=[_rect("ra", 0, 0, 3, 3), _rect("rb", 3, 0, 3, 3)])
    assert not any(getattr(e, "code", None) == CODE_ROOM_OVERLAP for e in validate_scene(scene).errors)


def test_add_room_overlap_fails_with_relayable_error() -> None:
    scene = Scene(id="o", scale_confirmed=True, rooms=[_rect("ra", 0, 0, 3, 3)])
    after, res = ops.add_room(scene, _rect("rb", 1, 1, 3, 3))
    assert not res.ok
    assert after is scene
    assert any(getattr(e, "code", None) == CODE_ROOM_OVERLAP for e in res.errors)


def test_next_to_skips_occupied_east_side() -> None:
    # Eval 01: east of the kitchen is the bath; south is free.
    scene = _sample()
    before = {r.id for r in scene.rooms}
    scene, res = execute(
        scene, [], "reform", "add_room",
        {"function": "bedroom", "name": "Dormitorio", "next_to": "Cocina", "size_m": [3.0, 3.5]},
    )
    assert res.ok, res.errors
    new = next(r for r in scene.rooms if r.id not in before)
    kitchen = next(r for r in scene.rooms if r.name == "Cocina")
    assert all(rooms_overlap_m2(new, r) == 0.0 for r in scene.rooms if r.id != new.id)
    # Shares the kitchen's south edge.
    assert max(p[1] for p in new.polygon) == min(p[1] for p in kitchen.polygon)


def test_next_to_tries_east_south_west_north_in_order() -> None:
    anchor = _rect("ra", 0, 0, 3, 3)
    blockers = [_rect("e", 3, 0, 3, 3), _rect("s", 0, -3, 3, 3), _rect("w", -3, 0, 3, 3)]
    scene = Scene(id="o", scale_confirmed=True, rooms=[anchor, *blockers])
    scene, res = execute(
        scene, [], "reform", "add_room",
        {"function": "bedroom", "name": "New", "next_to": "ra", "size_m": [3.0, 3.0]},
    )
    assert res.ok, res.errors
    new = next(r for r in scene.rooms if r.name == "New")
    assert min(p[1] for p in new.polygon) == 3.0  # north


def test_next_to_with_no_free_side_fails_clearly() -> None:
    anchor = _rect("ra", 0, 0, 3, 3)
    blockers = [
        _rect("e", 3, 0, 3, 3), _rect("s", 0, -3, 3, 3),
        _rect("w", -3, 0, 3, 3), _rect("n", 0, 3, 3, 3),
    ]
    scene = Scene(id="o", scale_confirmed=True, rooms=[anchor, *blockers])
    after, res = execute(
        scene, [], "reform", "add_room",
        {"function": "bedroom", "name": "New", "next_to": "ra", "size_m": [3.0, 3.0]},
    )
    assert not res.ok
    assert after is scene
    assert res.errors[0].code == "anchor.no_free_side"


def test_level_two_room_over_the_kitchen_is_accepted() -> None:
    scene = _sample()
    kitchen = next(r for r in scene.rooms if r.name == "Cocina")
    upstairs = Room(id="r_up", name="Arriba", polygon=list(kitchen.polygon), level=2)
    after, res = ops.add_room(scene, upstairs)
    assert res.ok, res.errors
    assert {r.id for r in after.rooms} == {r.id for r in scene.rooms} | {"r_up"}
    assert next(r for r in after.rooms if r.id == "r_up").polygon == upstairs.polygon


def test_rooms_on_the_same_upper_level_still_cannot_overlap() -> None:
    a = _rect("ra", 0, 0, 3, 3).model_copy(update={"level": 2})
    b = _rect("rb", 2, 0, 3, 3).model_copy(update={"level": 2})
    report = validate_scene(Scene(id="o", rooms=[a, b]))
    assert any(getattr(e, "code", None) == CODE_ROOM_OVERLAP for e in report.errors)


def test_next_to_on_level_two_ignores_ground_rooms() -> None:
    anchor = _rect("ra", 0, 0, 3, 3).model_copy(update={"level": 2})
    ground_east = _rect("g", 3, 0, 3, 3)
    scene = Scene(id="o", scale_confirmed=True, rooms=[ground_east, anchor])
    scene, res = execute(
        scene, [], "reform", "add_room",
        {"function": "bedroom", "name": "New", "next_to": "ra", "size_m": [3.0, 3.0], "level": 2},
    )
    assert res.ok, res.errors
    new = next(r for r in scene.rooms if r.name == "New")
    assert new.level == 2
    assert min(p[0] for p in new.polygon) == 3.0  # east, above the ground room
