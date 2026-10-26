"""Op tests (ADR-002): happy, invalid, rule violation (no mutation), undo restores.

Also covers each construction rule pass/fail and every professional-required
flag. Offline, no Meta calls.
"""

import copy

import pytest

from server.scene.models import Opening, Room, Scene, Wall
from server.scene.ops import (
    add_opening,
    add_room,
    add_wall,
    move_opening,
    remove_wall,
    replay,
    undo,
)
from server.scene.rules import (
    DOOR_WIDTH_M,
    EXTERIOR_WALL_THICKNESS_M,
    INTERIOR_WALL_THICKNESS_M,
    MAX_UNSUPPORTED_SPAN_M,
    MIN_CEILING_HEIGHT_M,
    MIN_DOOR_WIDTH_M,
    MIN_HABITABLE_ROOM_AREA_M2,
    MIN_HABITABLE_ROOM_SIDE_M,
    MIN_WINDOW_TO_FLOOR_RATIO,
)
from server.scene.validation import (
    FLAG_LOAD_BEARING,
    FLAG_SECOND_FLOOR,
    FLAG_SOIL,
    FLAG_SPAN,
    ValidationContext,
    validate_scene,
)


def _room_scene() -> Scene:
    # 3.0 x 3.0 bedroom: area 9 m2, side 3 m — passes habitable minimums.
    return Scene(
        id="s",
        scale_confirmed=True,
        walls=[
            Wall(id="w1", a=(0.0, 0.0), b=(3.0, 0.0), thickness_m=0.20, kind="exterior"),
            Wall(id="w2", a=(3.0, 0.0), b=(3.0, 3.0), thickness_m=0.20, kind="exterior"),
            Wall(id="w3", a=(3.0, 3.0), b=(0.0, 3.0), thickness_m=0.20, kind="exterior"),
            Wall(id="w4", a=(0.0, 3.0), b=(0.0, 0.0), thickness_m=0.20, kind="exterior"),
        ],
        rooms=[
            Room(
                id="r1",
                name="Dormitorio",
                polygon=[(0.0, 0.0), (3.0, 0.0), (3.0, 3.0), (0.0, 3.0)],
                function="bedroom",
            )
        ],
    )


# --- happy paths -------------------------------------------------------------


def test_add_wall_happy_bumps_version() -> None:
    scene = Scene(id="s")
    wall = Wall(id="w1", a=(0.0, 0.0), b=(2.0, 0.0), thickness_m=0.10, kind="interior")
    new_scene, result = add_wall(scene, wall, actor="user")
    assert result.ok
    assert new_scene.version == 1
    assert [w.id for w in new_scene.walls] == ["w1"]
    assert result.changed_ids == ("w1",)


def test_add_room_happy() -> None:
    scene = Scene(id="s")
    room = Room(
        id="r1",
        name="Cocina",
        polygon=[(0.0, 0.0), (3.0, 0.0), (3.0, 2.5), (0.0, 2.5)],
        function="kitchen",
    )
    new_scene, result = add_room(scene, room, actor="agent")
    assert result.ok
    assert new_scene.version == 1


def test_add_opening_happy() -> None:
    scene = _room_scene()
    opening = Opening(
        id="d1", wall_id="w1", kind="door",
        offset_m=1.0, width_m=DOOR_WIDTH_M, height_m=2.10,
    )
    new_scene, result = add_opening(scene, opening)
    assert result.ok
    assert new_scene.version == 1


def test_move_opening_happy() -> None:
    scene = _room_scene()
    new_scene, r1 = add_opening(
        scene,
        Opening(id="d1", wall_id="w1", kind="door", offset_m=0.5,
                width_m=0.90, height_m=2.10),
    )
    assert r1.ok
    moved, r2 = move_opening(new_scene, "d1", 1.5)
    assert r2.ok
    assert moved.openings[0].offset_m == 1.5
    assert moved.version == 2


def test_remove_wall_happy_removes_its_openings() -> None:
    scene = _room_scene()
    with_opening, r1 = add_opening(
        scene,
        Opening(id="d1", wall_id="w1", kind="door", offset_m=0.5,
                width_m=0.90, height_m=2.10),
    )
    assert r1.ok
    removed, r2 = remove_wall(with_opening, "w1")
    assert r2.ok
    assert [w.id for w in removed.walls] == ["w2", "w3", "w4"]
    assert removed.openings == []


# --- invalid input: scene unchanged -------------------------------------------


def test_add_wall_duplicate_id_fails_unchanged() -> None:
    scene = _room_scene()
    before = scene.model_dump_json()
    dup = Wall(id="w1", a=(0.0, 0.0), b=(1.0, 0.0), thickness_m=0.10, kind="interior")
    same, result = add_wall(scene, dup)
    assert not result.ok
    assert same.model_dump_json() == before
    assert same.version == scene.version


def test_add_opening_unknown_wall_fails_unchanged() -> None:
    scene = _room_scene()
    before = scene.model_dump_json()
    opening = Opening(id="d9", wall_id="nope", kind="door",
                      offset_m=0.0, width_m=0.90, height_m=2.10)
    same, result = add_opening(scene, opening)
    assert not result.ok
    assert same.model_dump_json() == before


def test_move_opening_unknown_id_fails_unchanged() -> None:
    scene = _room_scene()
    before = scene.model_dump_json()
    same, result = move_opening(scene, "ghost", 1.0)
    assert not result.ok
    assert same.model_dump_json() == before


def test_remove_wall_unknown_id_fails_unchanged() -> None:
    scene = _room_scene()
    before = scene.model_dump_json()
    same, result = remove_wall(scene, "ghost")
    assert not result.ok
    assert same.model_dump_json() == before


def test_invalid_actor_rejected() -> None:
    scene = Scene(id="s")
    wall = Wall(id="w1", a=(0.0, 0.0), b=(1.0, 0.0), thickness_m=0.10, kind="interior")
    same, result = add_wall(scene, wall, actor="robot")  # type: ignore[arg-type]
    assert not result.ok
    assert same.version == 0


# --- rule violations: scene unchanged + error --------------------------------


def test_violation_thin_exterior_wall_rejected() -> None:
    scene = Scene(id="s")
    before = scene.model_dump_json()
    wall = Wall(id="w1", a=(0.0, 0.0), b=(2.0, 0.0),
                thickness_m=EXTERIOR_WALL_THICKNESS_M - 0.05, kind="exterior")
    same, result = add_wall(scene, wall)
    assert not result.ok
    assert same.model_dump_json() == before


def test_violation_thin_interior_wall_rejected() -> None:
    scene = Scene(id="s")
    thin = Wall(id="w1", a=(0.0, 0.0), b=(2.0, 0.0),
                thickness_m=INTERIOR_WALL_THICKNESS_M - 0.05, kind="interior")
    same, result = add_wall(scene, thin)
    assert not result.ok
    assert same.version == 0


def test_violation_narrow_door_rejected() -> None:
    scene = _room_scene()
    before = scene.model_dump_json()
    door = Opening(id="d1", wall_id="w1", kind="door", offset_m=0.5,
                   width_m=MIN_DOOR_WIDTH_M - 0.1, height_m=2.10)
    same, result = add_opening(scene, door)
    assert not result.ok
    assert any("door" in e for e in result.errors)
    assert same.model_dump_json() == before


def test_violation_opening_overflow_rejected() -> None:
    scene = _room_scene()
    door = Opening(id="d1", wall_id="w1", kind="door", offset_m=2.5,
                   width_m=0.90, height_m=2.10)  # wall is 3 m long
    same, result = add_opening(scene, door)
    assert not result.ok
    assert same.openings == []


def test_violation_small_habitable_room_rejected() -> None:
    scene = Scene(id="s")
    tiny = Room(id="r1", name="Dormitorio",
                polygon=[(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)],
                function="bedroom")
    same, result = add_room(scene, tiny)
    assert not result.ok
    assert any("area" in e for e in result.errors)
    assert same.rooms == []


def test_violation_narrow_side_room_rejected() -> None:
    scene = Scene(id="s")
    # Area = 1.5 x 5 = 7.5 m2 (passes area) but side 1.5 m < minimum side.
    narrow = Room(id="r1", name="Dormitorio",
                  polygon=[(0.0, 0.0), (1.5, 0.0), (1.5, 5.0), (0.0, 5.0)],
                  function="bedroom")
    same, result = add_room(scene, narrow)
    assert not result.ok
    assert any("side" in e for e in result.errors)


def test_violation_low_ceiling_rejected() -> None:
    scene = Scene(id="s", ceiling_height_m=MIN_CEILING_HEIGHT_M - 0.2)
    room = Room(id="r1", name="Cocina",
                polygon=[(0.0, 0.0), (3.0, 0.0), (3.0, 2.5), (0.0, 2.5)],
                function="kitchen")
    same, result = add_room(scene, room)
    assert not result.ok
    assert any("ceiling" in e for e in result.errors)


def test_no_mutation_on_failure() -> None:
    scene = _room_scene()
    snapshot = copy.deepcopy(scene)
    bad_door = Opening(id="d1", wall_id="w1", kind="door", offset_m=0.5,
                       width_m=0.10, height_m=2.10)
    same, result = add_opening(scene, bad_door)
    assert not result.ok
    assert scene == snapshot
    assert same == snapshot


# --- rule pass cases ----------------------------------------------------------


def test_rule_pass_exact_door_minimum() -> None:
    scene = _room_scene()
    door = Opening(id="d1", wall_id="w1", kind="door", offset_m=0.5,
                   width_m=MIN_DOOR_WIDTH_M, height_m=2.10)
    _, result = add_opening(scene, door)
    assert result.ok


def test_rule_pass_exact_wall_thickness() -> None:
    scene = Scene(id="s")
    ext = Wall(id="we", a=(0.0, 0.0), b=(2.0, 0.0),
               thickness_m=EXTERIOR_WALL_THICKNESS_M, kind="exterior")
    _, r1 = add_wall(scene, ext)
    assert r1.ok
    interior = Wall(id="wi", a=(0.0, 0.0), b=(2.0, 0.0),
                    thickness_m=INTERIOR_WALL_THICKNESS_M, kind="interior")
    _, r2 = add_wall(scene, interior)
    assert r2.ok


def test_rule_pass_exact_habitable_minimums() -> None:
    scene = Scene(id="s")
    # 2 x 3 room: area 6 m2, side 2 m — the exact minimums.
    room = Room(id="r1", name="Cocina",
                polygon=[(0.0, 0.0), (3.0, 0.0), (3.0, 2.0), (0.0, 2.0)],
                function="kitchen")
    _, result = add_room(scene, room)
    assert result.ok or not any(
        "area" in e or "side" in e for e in result.errors
    )
    assert MIN_HABITABLE_ROOM_AREA_M2 == 6.0
    assert MIN_HABITABLE_ROOM_SIDE_M == 2.0


def test_ventilation_warning_below_ratio() -> None:
    scene = _room_scene()  # 9 m2 bedroom, no windows
    report = validate_scene(scene)
    assert report.ok  # warning, not error
    assert any("window/floor" in w for w in report.warnings)


def test_ventilation_pass_with_window() -> None:
    scene = _room_scene()
    with_window, r = add_opening(
        scene,
        Opening(id="v1", wall_id="w2", kind="window", offset_m=0.5,
                width_m=1.0, height_m=1.0, sill_m=0.9),  # 1 m2 / 9 m2 > 0.10
    )
    assert r.ok
    report = validate_scene(with_window)
    assert not any("window/floor" in w for w in report.warnings)
    assert MIN_WINDOW_TO_FLOOR_RATIO == pytest.approx(0.10)


# --- professional-required flags ----------------------------------------------


def test_flag_long_span_raised() -> None:
    wall = Wall(id="wl", a=(0.0, 0.0), b=(MAX_UNSUPPORTED_SPAN_M + 1.0, 0.0),
                thickness_m=0.20, kind="exterior")
    scene = Scene(id="s", walls=[wall])
    report = validate_scene(scene)
    assert report.ok  # flag, not error
    assert any(f.startswith(FLAG_SPAN) for f in report.flags)


def test_flag_span_not_raised_within_limit() -> None:
    wall = Wall(id="ws", a=(0.0, 0.0), b=(MAX_UNSUPPORTED_SPAN_M, 0.0),
                thickness_m=0.20, kind="exterior")
    scene = Scene(id="s", walls=[wall])
    report = validate_scene(scene)
    assert not any(f.startswith(FLAG_SPAN) for f in report.flags)


def test_flag_load_bearing_on_remove() -> None:
    wall = Wall(id="wlb", a=(0.0, 0.0), b=(2.0, 0.0),
                thickness_m=0.20, kind="exterior", load_bearing=True)
    scene = Scene(id="s", walls=[wall])
    removed, result = remove_wall(scene, "wlb")
    assert result.ok
    assert FLAG_LOAD_BEARING in result.flags
    assert removed.walls == []


def test_flag_no_load_bearing_for_partition() -> None:
    scene = _room_scene()
    _, result = remove_wall(scene, "w1")  # load_bearing defaults to False
    assert result.ok
    assert FLAG_LOAD_BEARING not in result.flags


def test_flag_second_floor_and_soil() -> None:
    scene = Scene(id="s")
    report = validate_scene(
        scene, ValidationContext(needs_second_floor=True, soil_unknown=True)
    )
    assert FLAG_SECOND_FLOOR in report.flags
    assert FLAG_SOIL in report.flags


def test_no_flags_by_default() -> None:
    report = validate_scene(_room_scene())
    assert report.flags == ()


# --- undo = replay up to N-1 ---------------------------------------------------


def test_undo_restores_previous_scene() -> None:
    base = _room_scene()
    s1, r1 = add_opening(
        base,
        Opening(id="d1", wall_id="w1", kind="door", offset_m=0.5,
                width_m=0.90, height_m=2.10),
    )
    assert r1.ok and r1.record is not None
    s2, r2 = move_opening(s1, "d1", 1.5)
    assert r2.ok and r2.record is not None
    history = [r1.record, r2.record]

    back1, h1 = undo(base, history)
    assert back1 == s1
    assert len(h1) == 1

    back0, h0 = undo(base, h1)
    assert back0 == base
    assert h0 == []


def test_undo_empty_history_returns_base() -> None:
    base = _room_scene()
    scene, history = undo(base, [])
    assert scene == base
    assert history == []


def test_replay_rebuilds_identical_scene() -> None:
    base = _room_scene()
    s1, r1 = add_opening(
        base,
        Opening(id="d1", wall_id="w1", kind="door", offset_m=0.5,
                width_m=0.90, height_m=2.10),
    )
    assert r1.ok and r1.record is not None
    s2, r2 = move_opening(s1, "d1", 1.2)
    assert r2.ok and r2.record is not None
    rebuilt = replay(base, [r1.record, r2.record])
    assert rebuilt == s2


def test_replay_unknown_op_raises() -> None:
    from server.scene.ops import OpRecord as R

    base = _room_scene()
    with pytest.raises(ValueError, match="unknown op"):
        replay(base, [R(op="fly", args={}, before_version=0, after_version=1, actor="user")])
