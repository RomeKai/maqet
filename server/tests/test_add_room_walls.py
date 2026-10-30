"""add_room builds its enclosing walls (ADR-002: deterministic code disposes).

A room attached to an existing house reuses the shared wall, adds only the
missing exterior walls (0.20 m) and a door through the shared wall.
"""

from __future__ import annotations

from shapely.geometry import LineString

from server.agent.executor import execute
from server.export.takeoff import compute_takeoff
from server.scene.models import Room, Scene, Wall
from server.scene.rules import EXTERIOR_WALL_THICKNESS_M, PRO_FLAG_SPAN
from server.scene.validation import validate_scene


def _house_3x8() -> Scene:
    w = lambda i, a, b: Wall(  # noqa: E731
        id=i, a=a, b=b, thickness_m=0.20, kind="exterior", provenance="measured_tape"
    )
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


def _add_bedroom(scene: Scene, history: list, **extra):
    return execute(
        scene,
        history,
        "reform",
        "add_room",
        {"function": "bedroom", "name": "Bedroom", "next_to": "r1", "size_m": [3.0, 3.0], **extra},
    )


def _covered_length(scene: Scene) -> float:
    """Sum of wall lengths after merging collinear overlaps (duplicates count once)."""
    from shapely.ops import unary_union

    merged = unary_union([LineString([w.a, w.b]) for w in scene.walls])
    return merged.length


def test_new_room_gets_enclosing_walls() -> None:
    scene, history = _house_3x8(), []
    new, res = _add_bedroom(scene, history)
    assert res.ok, res.errors
    added = [w for w in new.walls if w.id not in {x.id for x in scene.walls}]
    assert added, "add_room must create walls"
    assert all(w.kind == "exterior" for w in added)
    assert all(w.thickness_m >= EXTERIOR_WALL_THICKNESS_M for w in added)
    room = next(r for r in new.rooms if r.name == "Bedroom")
    xs = [p[0] for p in room.polygon]
    ys = [p[1] for p in room.polygon]
    assert (min(xs), max(xs)) == (8.0, 11.0) and (min(ys), max(ys)) == (0.0, 3.0)


def test_shared_wall_not_duplicated() -> None:
    scene, history = _house_3x8(), []
    new, res = _add_bedroom(scene, history)
    assert res.ok, res.errors
    # Perimeter of house (22) + 3 new sides of the 3x3 bedroom (9).
    assert abs(_covered_length(new) - 31.0) < 1e-6
    total = sum(((w.a[0] - w.b[0]) ** 2 + (w.a[1] - w.b[1]) ** 2) ** 0.5 for w in new.walls)
    assert abs(total - 31.0) < 1e-6, "no collinear duplicate of the shared wall"


def test_door_connects_new_room_to_house() -> None:
    scene, history = _house_3x8(), []
    new, res = _add_bedroom(scene, history)
    assert res.ok, res.errors
    doors = [o for o in new.openings if o.kind == "door"]
    assert len(doors) == 1
    assert doors[0].wall_id == "w2"  # the shared wall
    assert doors[0].width_m >= 0.80


def test_scene_stays_valid_and_takeoff_runs() -> None:
    scene, history = _house_3x8(), []
    new, res = _add_bedroom(scene, history)
    assert res.ok, res.errors
    assert not validate_scene(new).errors
    assert compute_takeoff(new) is not None


def test_undo_removes_room_walls_and_door() -> None:
    scene, history = _house_3x8(), []
    new, res = _add_bedroom(scene, history)
    assert res.ok, res.errors
    undone, ures = execute(new, history, "reform", "undo", {})
    assert ures.ok, ures.errors
    assert {w.id for w in undone.walls} == {w.id for w in scene.walls}
    assert undone.openings == []
    assert [r.id for r in undone.rooms] == ["r1"]


def test_long_house_wall_flag_is_a_known_span_rule() -> None:
    # 8 m wall > MAX_UNSUPPORTED_SPAN_M (4 m, rules.py): flagged on purpose,
    # an 8 m masonry run without a cross support needs a bond beam / review.
    _, res = _add_bedroom(_house_3x8(), [])
    assert any(f.startswith(PRO_FLAG_SPAN) for f in res.flags)


def _overlaps(a, b) -> bool:
    return not (a.offset_m + a.width_m <= b.offset_m or b.offset_m + b.width_m <= a.offset_m)


def test_auto_door_avoids_an_existing_window_on_the_shared_wall() -> None:
    from server.scene.models import Opening

    scene = _house_3x8()
    # 0.6 m window near the centre of the 3 m shared wall w2.
    scene = scene.model_copy(
        update={
            "openings": [
                Opening(id="v1", wall_id="w2", kind="window", offset_m=1.2,
                        width_m=0.6, height_m=1.1, sill_m=0.9)
            ]
        }
    )
    new, res = _add_bedroom(scene, [], wall="w2")
    assert res.ok, res.errors
    doors = [o for o in new.openings if o.kind == "door"]
    assert len(doors) == 1
    window = next(o for o in new.openings if o.id == "v1")
    assert not _overlaps(doors[0], window)
    assert doors[0].offset_m + doors[0].width_m <= 3.0 + 1e-9


def test_no_free_span_means_no_door_and_a_warning() -> None:
    from server.scene.models import Opening

    scene = _house_3x8().model_copy(
        update={
            "openings": [
                Opening(id="v1", wall_id="w2", kind="window", offset_m=0.3,
                        width_m=2.4, height_m=1.1, sill_m=0.9)
            ]
        }
    )
    new, res = _add_bedroom(scene, [], wall="w2")
    assert res.ok, res.errors
    assert [o for o in new.openings if o.kind == "door"] == []
    assert any("door" in w.lower() for w in res.warnings)
