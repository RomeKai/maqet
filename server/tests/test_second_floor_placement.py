"""A storey sits on top of the home, never floating beside it. Offline."""

from __future__ import annotations

import json
from pathlib import Path

from server.agent.executor import execute
from server.intake.cleanup import build_scaled_plan, to_scene
from server.intake.schemas import IntakeProposal
from server.scene.models import Scene
from server.scene.rules import PRO_FLAG_SECOND_FLOOR

FIXTURE = Path(__file__).parent / "fixtures" / "sketch_reading_3x8.json"


def _house() -> Scene:
    proposal = IntakeProposal.model_validate(json.loads(FIXTURE.read_text(encoding="utf-8")))
    return to_scene(build_scaled_plan(proposal, 3000, 4000))


def _bbox(poly) -> tuple[float, float, float, float]:
    xs = [p[0] for p in poly]
    ys = [p[1] for p in poly]
    return min(xs), min(ys), max(xs), max(ys)


def _upstairs(scene: Scene):
    return next(r for r in scene.rooms if r.level == 2)


def test_second_floor_without_polygon_sits_centered_over_the_house() -> None:
    house = _house()
    scene, res = execute(house, [], "reform", "add_room", {"function": "bedroom", "level": 2})
    assert res.ok, res.errors
    x0, y0, x1, y1 = _bbox(_upstairs(scene).polygon)
    assert (x1 - x0, y1 - y0) == (3.0, 3.0)  # size_m honoured exactly
    assert abs((x0 + x1) / 2 - 1.5) < 1e-9 and abs((y0 + y1) / 2 - 4.0) < 1e-9
    hx0, hy0, hx1, hy1 = _bbox(house.rooms[0].polygon)
    assert hx0 <= x0 and hy0 <= y0 and x1 <= hx1 and y1 <= hy1
    assert PRO_FLAG_SECOND_FLOOR in res.flags


def test_second_floor_over_a_named_anchor_room() -> None:
    house = _house()
    scene, res = execute(house, [], "reform", "add_room", {"function": "bedroom", "size_m": [3.0, 4.0]})
    assert res.ok, res.errors  # level 1, no anchor: unchanged behaviour
    ground = [r for r in scene.rooms if r.level == 1]
    small = min(ground, key=lambda r: abs(_bbox(r.polygon)[2] - _bbox(r.polygon)[0]) * abs(_bbox(r.polygon)[3] - _bbox(r.polygon)[1]))
    scene, res = execute(
        scene, [], "reform", "add_room",
        {"function": "study", "level": 2, "size_m": [2.0, 2.0], "next_to": small.id},
    )
    assert res.ok, res.errors
    x0, y0, x1, y1 = _bbox(_upstairs(scene).polygon)
    sx0, sy0, sx1, sy1 = _bbox(small.polygon)
    assert sx0 <= x0 and sy0 <= y0 and x1 <= sx1 and y1 <= sy1
    assert abs((x0 + x1) / 2 - (sx0 + sx1) / 2) < 1e-9


def test_oversized_second_floor_keeps_requested_size_centered_and_says_so() -> None:
    scene, res = execute(
        _house(), [], "reform", "add_room", {"function": "bedroom", "level": 2, "size_m": [5.0, 5.0]}
    )
    assert res.ok, res.errors
    x0, y0, x1, y1 = _bbox(_upstairs(scene).polygon)
    assert (x1 - x0, y1 - y0) == (5.0, 5.0)
    assert abs((x0 + x1) / 2 - 1.5) < 1e-9 and abs((y0 + y1) / 2 - 4.0) < 1e-9
    assert any("footprint" in w for w in res.warnings), res.warnings


def test_explicit_polygon_off_the_house_is_moved_over_it_with_a_note() -> None:
    far = [[10.0, 0.0], [13.0, 0.0], [13.0, 3.0], [10.0, 3.0]]
    scene, res = execute(
        _house(), [], "reform", "add_room", {"function": "bedroom", "level": 2, "polygon": far}
    )
    assert res.ok, res.errors
    x0, y0, x1, y1 = _bbox(_upstairs(scene).polygon)
    assert (x1 - x0, y1 - y0) == (3.0, 3.0)
    assert 0.0 <= x0 and x1 <= 3.0 and 0.0 <= y0 and y1 <= 8.0
    assert any("moved" in w for w in res.warnings), res.warnings


def test_explicit_polygon_already_over_the_house_is_left_alone() -> None:
    over = [[0.0, 0.0], [3.0, 0.0], [3.0, 3.0], [0.0, 3.0]]
    scene, res = execute(
        _house(), [], "reform", "add_room", {"function": "bedroom", "level": 2, "polygon": over}
    )
    assert res.ok, res.errors
    assert _bbox(_upstairs(scene).polygon) == (0.0, 0.0, 3.0, 3.0)


def test_undo_removes_the_second_floor() -> None:
    house = _house()
    history: list = []
    scene, res = execute(house, history, "reform", "add_room", {"function": "bedroom", "level": 2})
    assert res.ok, res.errors
    scene, undo = execute(scene, history, "reform", "undo", {})
    assert undo.ok, undo.errors
    assert [r.id for r in scene.rooms] == [r.id for r in house.rooms]
