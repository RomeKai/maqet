"""Room.level: upper-floor rooms are stored, flagged and drawn apart.

A level > 1 room always raises the second-floor professional flag (from the
Scene itself, not only from the agent argument) and goes to "-L<level>" DXF
layers so the ground-floor plan stays clean. Offline, no Meta calls.
"""

from __future__ import annotations

from server.agent.executor import execute
from server.export.dxf import PROFESSIONAL_PREFIX, export_dxf
from server.scene import ops
from server.scene.models import Room, Scene, Wall
from server.scene.rules import PRO_FLAG_SECOND_FLOOR
from server.scene.validation import validate_scene


def _box() -> Scene:
    walls = [
        Wall(id="w1", a=(0.0, 0.0), b=(4.0, 0.0), thickness_m=0.20, kind="exterior"),
        Wall(id="w2", a=(4.0, 0.0), b=(4.0, 3.0), thickness_m=0.20, kind="exterior"),
        Wall(id="w3", a=(4.0, 3.0), b=(0.0, 3.0), thickness_m=0.20, kind="exterior"),
        Wall(id="w4", a=(0.0, 3.0), b=(0.0, 0.0), thickness_m=0.20, kind="exterior"),
    ]
    rooms = [Room(id="r1", name="Kitchen", polygon=[(0.0, 0.0), (4.0, 0.0), (4.0, 3.0), (0.0, 3.0)])]
    return Scene(id="lvl", scale_confirmed=True, walls=walls, rooms=rooms)


def _upstairs(rid: str = "r_up", level: int = 2) -> Room:
    return Room(
        id=rid, name="Upstairs", level=level,
        polygon=[(10.0, 0.0), (13.0, 0.0), (13.0, 3.0), (10.0, 3.0)],
    )


def test_old_room_json_without_level_defaults_to_ground_floor() -> None:
    raw = '{"id": "r", "name": "Old", "polygon": [[0, 0], [1, 0], [1, 1]]}'
    assert Room.model_validate_json(raw).level == 1


def test_level_must_be_positive() -> None:
    scene, res = ops.add_room(_box(), _upstairs(level=1).model_copy(update={"level": 0}))
    assert not res.ok


def test_upper_level_room_raises_second_floor_flag_from_scene() -> None:
    scene = _box().model_copy(update={"rooms": [*_box().rooms, _upstairs()]})
    assert PRO_FLAG_SECOND_FLOOR in [str(f) for f in validate_scene(scene).flags]
    after, res = ops.add_room(_box(), _upstairs())  # no needs_second_floor arg
    assert res.ok, res.errors
    assert PRO_FLAG_SECOND_FLOOR in after.professional_flags


def test_ground_rooms_raise_no_second_floor_flag() -> None:
    assert PRO_FLAG_SECOND_FLOOR not in [str(f) for f in validate_scene(_box()).flags]


def test_agent_level_argument_is_stored_on_the_room() -> None:
    scene, res = execute(
        _box(), [], "reform", "add_room",
        {
            "function": "bedroom", "name": "Up", "level": 2,
            "polygon": [[10.0, 0.0], [13.0, 0.0], [13.0, 3.0], [10.0, 3.0]],
        },
    )
    assert res.ok, res.errors
    assert next(r for r in scene.rooms if r.name == "Up").level == 2


def test_level_survives_save_load_round_trip() -> None:
    scene, _ = ops.add_room(_box(), _upstairs())
    reloaded = Scene.model_validate_json(scene.model_dump_json())
    assert next(r for r in reloaded.rooms if r.id == "r_up").level == 2


def test_dxf_puts_upper_level_rooms_on_l2_layers() -> None:
    scene, _ = ops.add_room(_box(), _upstairs())
    msp = export_dxf(scene).modelspace()
    by_text = {e.dxf.text: e.dxf.layer for e in msp if e.dxftype() == "TEXT"}
    assert by_text["Upstairs"] == "A-AREA-L2"
    assert by_text["Kitchen"] == "A-AREA"
    assert by_text["9.0 m2"] == "A-ANNO-TEXT-L2"
    assert by_text["12.0 m2"] == "A-ANNO-TEXT"
    polys = {e.dxf.layer for e in msp if e.dxftype() == "LWPOLYLINE"}
    assert "A-AREA-L2" in polys
    assert f"{PROFESSIONAL_PREFIX}{PRO_FLAG_SECOND_FLOOR}" in by_text
    assert by_text[f"{PROFESSIONAL_PREFIX}{PRO_FLAG_SECOND_FLOOR}"] == "A-ANNO-TEXT"


def test_ground_only_scene_creates_no_level_layers() -> None:
    doc = export_dxf(_box())
    assert not [layer.dxf.name for layer in doc.layers if layer.dxf.name.endswith("-L2")]


def test_upper_level_room_survives_later_wall_op_unchanged() -> None:
    scene, _ = ops.add_room(_box(), _upstairs())
    wall = Wall(id="w5", a=(2.0, 0.0), b=(2.0, 3.0), thickness_m=0.10, kind="interior")
    scene, res = ops.add_wall(scene, wall)
    assert res.ok, res.errors
    up = next(r for r in scene.rooms if r.id == "r_up")
    assert up == _upstairs()
