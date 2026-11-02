"""Persisted "needs a licensed professional" flags (Scene.professional_flags).

The agent raises them per tool call; they must survive later ops, save/load
and reach the DXF title block, including through POST /export/dxf where the
client posts the Scene back. Offline, no Meta calls.
"""

from __future__ import annotations

import io

import ezdxf
from fastapi.testclient import TestClient

from server.agent.executor import execute
from server.api import app
from server.export.dxf import PRELIMINARY_NOTE, PROFESSIONAL_PREFIX, export_dxf
from server.scene import ops
from server.scene.models import Room, Scene, Wall
from server.scene.rules import (
    PRO_FLAG_LOAD_BEARING,
    PRO_FLAG_SECOND_FLOOR,
    PRO_FLAG_SOIL,
    PRO_FLAG_SPAN,
)


def _base() -> Scene:
    walls = [
        Wall(id="w1", a=(0.0, 0.0), b=(4.0, 0.0), thickness_m=0.20, kind="exterior"),
        Wall(id="w2", a=(4.0, 0.0), b=(4.0, 3.0), thickness_m=0.20, kind="exterior"),
        Wall(id="w3", a=(4.0, 3.0), b=(0.0, 3.0), thickness_m=0.20, kind="exterior"),
        Wall(id="w4", a=(0.0, 3.0), b=(0.0, 0.0), thickness_m=0.20, kind="exterior"),
        Wall(
            id="w_lb", a=(2.0, 0.0), b=(2.0, 3.0), thickness_m=0.20,
            kind="interior", load_bearing=True,
        ),
    ]
    rooms = [
        Room(id="r1", name="West", polygon=[(0.0, 0.0), (2.0, 0.0), (2.0, 3.0), (0.0, 3.0)]),
        Room(id="r2", name="East", polygon=[(2.0, 0.0), (4.0, 0.0), (4.0, 3.0), (2.0, 3.0)]),
    ]
    return Scene(id="flags", scale_confirmed=True, walls=walls, rooms=rooms)


def _room_args(name: str, x0: float, **extra: object) -> dict:
    return {
        "function": "bedroom",
        "name": name,
        "polygon": [[x0, 0.0], [x0 + 3.0, 0.0], [x0 + 3.0, 3.0], [x0, 3.0]],
        **extra,
    }


def _dxf_texts(doc: ezdxf.document.Drawing) -> list[str]:
    return [
        e.dxf.text
        for e in doc.modelspace()
        if e.dxftype() == "TEXT" and e.dxf.layer == "A-ANNO-TEXT"
    ]


def test_old_scene_json_without_field_still_validates() -> None:
    raw = '{"id": "old", "scale_confirmed": true, "walls": [], "rooms": []}'
    assert Scene.model_validate_json(raw).professional_flags == []


def test_second_floor_and_soil_flags_persist_deduplicated() -> None:
    scene, history = _base(), []
    scene, res = execute(
        scene, history, "reform", "add_room",
        _room_args("Upstairs", 10.0, level=2, foundation_unknown_soil=True),
    )
    assert res.ok, res.errors
    scene, res = execute(scene, history, "reform", "add_room", _room_args("Up 2", 20.0, level=2))
    assert res.ok, res.errors
    assert scene.professional_flags.count(PRO_FLAG_SECOND_FLOOR) == 1
    assert PRO_FLAG_SOIL in scene.professional_flags


def test_load_bearing_flag_survives_later_unrelated_op() -> None:
    scene, res = ops.remove_wall(_base(), "w_lb")
    assert res.ok, res.errors
    assert scene.professional_flags == [PRO_FLAG_LOAD_BEARING]
    scene, res = ops.add_room(
        scene, Room(id="r9", name="Far", polygon=[(10.0, 0.0), (13.0, 0.0), (13.0, 3.0), (10.0, 3.0)])
    )
    assert res.ok, res.errors
    assert PRO_FLAG_LOAD_BEARING in scene.professional_flags


def test_span_flag_persists_as_stable_code() -> None:
    long_wall = Wall(id="w_long", a=(0.0, 5.0), b=(6.0, 5.0), thickness_m=0.20, kind="exterior")
    scene, res = ops.add_wall(_base(), long_wall)
    assert res.ok, res.errors
    assert PRO_FLAG_SPAN in scene.professional_flags  # code, not "...:w_long"


def test_undo_replay_reproduces_persisted_flags() -> None:
    base, history = _base(), []
    scene, res = execute(base, history, "reform", "add_room", _room_args("Up", 10.0, level=2))
    assert res.ok, res.errors
    assert ops.replay(base, history).professional_flags == scene.professional_flags


def test_flags_survive_save_load_round_trip() -> None:
    scene, _ = ops.remove_wall(_base(), "w_lb")
    reloaded = Scene.model_validate_json(scene.model_dump_json())
    assert reloaded.professional_flags == [PRO_FLAG_LOAD_BEARING]


def test_persisted_flag_written_next_to_preliminary_note() -> None:
    scene = _base().model_copy(update={"professional_flags": [PRO_FLAG_SECOND_FLOOR]})
    texts = _dxf_texts(export_dxf(scene))
    line = f"{PROFESSIONAL_PREFIX}second floor"
    assert texts.count(line) == 1
    assert texts.index(line) == texts.index(PRELIMINARY_NOTE) + 1


def test_export_route_writes_flags_from_posted_scene() -> None:
    scene = _base().model_copy(update={"professional_flags": [PRO_FLAG_SOIL]})
    res = TestClient(app).post("/export/dxf", json=scene.model_dump(mode="json"))
    assert res.status_code == 200, res.text
    doc = ezdxf.read(io.StringIO(res.content.decode("utf-8")))
    assert f"{PROFESSIONAL_PREFIX}foundations on unknown soil" in _dxf_texts(doc)
