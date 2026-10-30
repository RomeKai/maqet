"""add_room against REAL intake walls (bug I): slightly skewed sketch centerlines.

Root cause pinned here: the new room was an axis-aligned box on the anchor's
bbox, but intake walls are not exactly axis-aligned (croquis_3x8 east wall runs
from x=3.00 to x=3.17), so the box edge never matched the wall: a parallel
duplicate wall and no connecting door. The room is now built ON the chosen wall.
"""

from __future__ import annotations

import math

import pytest
from fastapi.testclient import TestClient

from server.agent.executor import execute
from server.api import app
from server.scene.models import Scene
from server.scene.validation import validate_scene


@pytest.fixture(scope="module")
def intake_scene() -> Scene:
    res = TestClient(app).post(
        "/intake", data={"kind": "plan", "sample": "croquis_3x8_door_window"}
    )
    assert res.status_code == 200, res.text
    return Scene.model_validate(res.json()["scene"])


def _add(scene: Scene, **extra):
    args = {"function": "bedroom", "name": "Bed", "next_to": scene.rooms[0].id,
            "size_m": [3.0, 3.0], **extra}
    return execute(scene, [], "reform", "add_room", args)


def _length(w) -> float:
    return math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1])


def _parallel_close_pairs(scene: Scene) -> list[tuple[str, str]]:
    pairs = []
    for i, a in enumerate(scene.walls):
        for b in scene.walls[i + 1 :]:
            da = (a.b[0] - a.a[0], a.b[1] - a.a[1])
            db = (b.b[0] - b.a[0], b.b[1] - b.a[1])
            cross = abs(da[0] * db[1] - da[1] * db[0]) / (math.hypot(*da) * math.hypot(*db))
            if cross > 0.05:
                continue
            # perpendicular distance of b.a to line a, and overlap along a
            n = (-da[1] / math.hypot(*da), da[0] / math.hypot(*da))
            dist = abs((b.a[0] - a.a[0]) * n[0] + (b.a[1] - a.a[1]) * n[1])
            ua = (da[0] / math.hypot(*da), da[1] / math.hypot(*da))
            t = sorted([(p[0] - a.a[0]) * ua[0] + (p[1] - a.a[1]) * ua[1] for p in (b.a, b.b)])
            if dist < 0.5 and t[1] > 0.05 and t[0] < _length(a) - 0.05:
                pairs.append((a.id, b.id))
    return pairs


def test_reuses_the_original_wall_no_parallel_duplicate(intake_scene: Scene) -> None:
    before = _parallel_close_pairs(intake_scene)
    new, res = _add(intake_scene)
    assert res.ok, res.errors
    assert _parallel_close_pairs(new) == before  # no new close-parallel pair
    added = [w for w in new.walls if w.id not in {x.id for x in intake_scene.walls}]
    assert len(added) == 3  # three new sides, the fourth is the original wall


def test_cuts_a_door_into_the_original_house(intake_scene: Scene) -> None:
    new, res = _add(intake_scene)
    assert res.ok, res.errors
    old_ids = {w.id for w in intake_scene.walls}
    new_doors = [o for o in new.openings
                 if o.kind == "door" and o.id not in {x.id for x in intake_scene.openings}]
    assert len(new_doors) == 1 and new_doors[0].wall_id in old_ids


def test_scene_stays_valid(intake_scene: Scene) -> None:
    new, res = _add(intake_scene)
    assert res.ok, res.errors
    assert not validate_scene(new).errors


def test_prefers_a_wall_without_openings(intake_scene: Scene) -> None:
    new, res = _add(intake_scene)
    assert res.ok, res.errors
    door = next(o for o in new.openings if o.id not in {x.id for x in intake_scene.openings})
    with_openings = {o.wall_id for o in intake_scene.openings}
    assert door.wall_id not in with_openings


def test_explicit_wall_with_a_window_keeps_it_and_tells_the_user(intake_scene: Scene) -> None:
    window_wall = next(o.wall_id for o in intake_scene.openings if o.kind == "window")
    new, res = _add(intake_scene, wall=window_wall)
    assert res.ok, res.errors
    assert any(o.kind == "window" and o.wall_id == window_wall for o in new.openings)
    assert any("window" in w.lower() for w in res.warnings)
    door = next(o for o in new.openings if o.id not in {x.id for x in intake_scene.openings})
    win = next(o for o in new.openings if o.kind == "window" and o.wall_id == window_wall)
    if door.wall_id == window_wall:
        assert door.offset_m + door.width_m <= win.offset_m or win.offset_m + win.width_m <= door.offset_m


def test_prompt_asks_which_wall_when_ambiguous() -> None:
    from pathlib import Path

    text = (Path(__file__).resolve().parents[1] / "agent" / "prompts" / "reform_v1.md").read_text(
        encoding="utf-8"
    ).casefold()
    assert "did not say on which wall" in text and "ask before calling `add_room`" in text
    assert "window stays as an opening" in text


def test_requested_3x4_is_not_clamped_to_the_wall_length(intake_scene: Scene) -> None:
    """Bug O: 3x4 on a 3 m wall must stay 3 x 4 (width along the wall, depth 4)."""
    new, res = _add(intake_scene, size_m=[3.0, 4.0], wall="wall 1")
    assert res.ok, res.errors
    room = new.rooms[-1]
    xs = [p[0] for p in room.polygon]
    ys = [p[1] for p in room.polygon]
    sides = sorted([max(xs) - min(xs), max(ys) - min(ys)])
    assert sides[0] == pytest.approx(3.0, abs=0.35)  # skewed intake walls: small tolerance
    assert sides[1] == pytest.approx(4.0, abs=0.35)


def test_prompt_tells_the_model_not_to_clamp_the_size() -> None:
    from pathlib import Path

    text = " ".join(Path("server/agent/prompts/reform_v1.md").read_text(encoding="utf-8").split())
    assert "never shrink a side to the wall length" in text
