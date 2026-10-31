"""Agent tool tests (mission agent-tools, stage 2/4 build).

No model calls anywhere: the stage-scoped executor is called directly.
Written first (TDD); server/agent/{stages,tools,executor}.py make them pass.
"""

import json
from pathlib import Path

import pytest

from server.agent.executor import ToolResult, execute
from server.agent.stages import STAGES, allowed_tools
from server.scene import ops
from server.scene.models import Room, Scene, Wall
from server.scene.ops import OpRecord
from server.scene.rules import (
    DOOR_WIDTH_M,
    PRO_FLAG_LOAD_BEARING,
    PRO_FLAG_SECOND_FLOOR,
    PRO_FLAG_SOIL,
    PRO_FLAG_SPAN,
)


def _walls_3x3(load_bearing_w1: bool = False, w1_id: str = "w1") -> list[Wall]:
    return [
        Wall(
            id=w1_id,
            a=(0.0, 0.0),
            b=(3.0, 0.0),
            thickness_m=0.20,
            kind="exterior",
            load_bearing=load_bearing_w1,
        ),
        Wall(id="w2", a=(3.0, 0.0), b=(3.0, 3.0), thickness_m=0.20, kind="exterior"),
        Wall(id="w3", a=(3.0, 3.0), b=(0.0, 3.0), thickness_m=0.20, kind="exterior"),
        Wall(id="w4", a=(0.0, 3.0), b=(0.0, 0.0), thickness_m=0.20, kind="exterior"),
    ]


def _kitchen_scene(**kwargs) -> Scene:
    # 3x3 kitchen: area 9 m2, side 3 m — passes habitable minimums.
    return Scene(
        id="s",
        scale_confirmed=True,
        walls=_walls_3x3(**kwargs),
        rooms=[
            Room(
                id="r1",
                name="Kitchen",
                polygon=[(0.0, 0.0), (3.0, 0.0), (3.0, 3.0), (0.0, 3.0)],
                function="kitchen",
            )
        ],
    )


# --- Stages / gating ----------------------------------------------------------


def test_stage_toolsets_exact() -> None:
    assert STAGES["reform"] == (
        "add_room",
        "add_wall",
        "remove_wall",
        "add_opening",
        "move_opening",
        "resize_room",
        "set_wall_length",
        "move_wall",
        "set_opening_size",
        "split_room",
        "rename_room",
        "undo",
    )
    assert STAGES["design"] == (
        "list_catalog",
        "place_furniture",
        "move_item",
        "rotate_item",
        "remove_item",
        "set_surface_material",
        "undo",
    )
    assert STAGES["present"] == ("create_variant", "render_view")
    assert allowed_tools("reform") == list(STAGES["reform"])


def test_unknown_stage() -> None:
    scene, history = _kitchen_scene(), []
    scene2, res = execute(scene, history, "capture", "add_wall", {"a": [0, 0], "b": [1, 0]})
    assert res.ok is False
    assert res.errors[0].code == "stage.unknown_stage"
    assert scene2.model_dump() == scene.model_dump()
    assert history == []


def test_out_of_stage_tool_refusal_lists_allowed() -> None:
    scene, history = _kitchen_scene(), []
    before = scene.model_dump()
    scene2, res = execute(scene, history, "reform", "place_furniture", {"catalog_id": "bed-01"})
    assert res.ok is False
    assert res.errors[0].code == "stage.tool_not_allowed"
    assert "add_room" in res.errors[0].message  # allowed tools listed
    assert scene2.model_dump() == before
    assert history == []
    # undo is not a present tool either: gated like any other non-listed tool.
    _, res_present = execute(scene, history, "present", "undo", {})
    assert res_present.errors[0].code == "stage.tool_not_allowed"


def test_unknown_tool() -> None:
    scene, history = _kitchen_scene(), []
    _, res = execute(scene, history, "reform", "teleport", {})
    assert res.ok is False
    assert res.errors[0].code == "tool.unknown_tool"
    assert history == []


# --- Reform happy paths -------------------------------------------------------


def test_add_wall_happy() -> None:
    scene, history = _kitchen_scene(), []
    scene2, res = execute(
        scene, history, "reform", "add_wall", {"a": [3.0, 0.0], "b": [6.0, 0.0]}
    )
    assert res.ok is True
    assert scene2.version == scene.version + 1
    assert len(history) == 1
    assert res.changed_ids == [w.id for w in scene2.walls if w.id not in {w.id for w in scene.walls}]
    assert len(scene2.walls) == len(scene.walls) + 1


def test_add_room_next_to_kitchen_case_insensitive() -> None:
    scene, history = _kitchen_scene(), []
    scene2, res = execute(
        scene,
        history,
        "reform",
        "add_room",
        {"function": "bedroom", "next_to": "KITCHEN", "size_m": [3.0, 3.0]},
    )
    assert res.ok is True
    assert scene2.version == 1
    assert len(history) == 1 and res.changed_ids[0] == "r2"
    new_room = next(r for r in scene2.rooms if r.id == res.changed_ids[0])
    assert new_room.function == "bedroom"
    # Deterministic geometry: east-adjacent to the kitchen bbox, shared edge.
    assert min(p[0] for p in new_room.polygon) == pytest.approx(3.0)
    assert max(p[0] for p in new_room.polygon) == pytest.approx(6.0)


def test_add_opening_door_defaults() -> None:
    scene, history = _kitchen_scene(), []
    scene2, res = execute(
        scene, history, "reform", "add_opening", {"wall": "w1", "kind": "door"}
    )
    assert res.ok is True
    assert scene2.version == 1 and len(history) == 1
    opening = next(o for o in scene2.openings if o.id == res.changed_ids[0])
    assert opening.width_m == pytest.approx(DOOR_WIDTH_M)  # 0.90 m default


def test_move_opening_happy() -> None:
    scene, history = _kitchen_scene(), []
    scene, res = execute(scene, history, "reform", "add_opening", {"wall": "w1", "kind": "door"})
    assert res.ok is True
    oid = res.changed_ids[0]
    scene2, res2 = execute(
        scene, history, "reform", "move_opening", {"opening_id": oid, "new_offset_m": 1.5}
    )
    assert res2.ok is True
    assert scene2.version == 2 and len(history) == 2
    assert next(o for o in scene2.openings if o.id == oid).offset_m == pytest.approx(1.5)


def test_remove_wall_non_load_bearing() -> None:
    scene, history = _kitchen_scene(), []
    scene2, res = execute(scene, history, "reform", "remove_wall", {"wall_id": "w4"})
    assert res.ok is True
    assert scene2.version == 1 and len(history) == 1
    assert [w.id for w in scene2.walls] == ["w1", "w2", "w3"]
    assert res.changed_ids == ["w4"]


# --- Rules errors and professional-required flags -------------------------------


def test_add_room_tiny_reports_area_error_unchanged() -> None:
    scene, history = _kitchen_scene(), []
    before = scene.model_dump()
    _, res = execute(
        scene,
        history,
        "reform",
        "add_room",
        {"function": "bedroom", "next_to": "kitchen", "size_m": [1.0, 1.0]},
    )
    assert res.ok is False
    assert "room.area_below_minimum" in [e.code for e in res.errors]
    assert scene.model_dump() == before  # unchanged
    assert history == []
    assert res.version == scene.version


def test_add_opening_overflow() -> None:
    scene, history = _kitchen_scene(), []
    _, res = execute(
        scene,
        history,
        "reform",
        "add_opening",
        {"wall": "w1", "kind": "door", "offset_m": 2.5},  # 2.5 + 0.9 > 3.0
    )
    assert res.ok is False
    assert "opening.overflows_wall" in [e.code for e in res.errors]
    assert history == []


def test_long_wall_raises_span_flag() -> None:
    scene, history = _kitchen_scene(), []
    _, res = execute(
        scene, history, "reform", "add_wall", {"a": [0.0, 0.0], "b": [5.0, 0.0]}
    )
    assert res.ok is True  # flags never block geometry
    assert any(f.startswith(PRO_FLAG_SPAN) for f in res.flags)


def test_remove_load_bearing_wall_flags_professional() -> None:
    # Eval case: "sacá el muro entre la cocina y el living".
    scene = _kitchen_scene(load_bearing_w1=True, w1_id="w-kitchen-living")
    history: list = []
    scene2, res = execute(
        scene, history, "reform", "remove_wall", {"between": "kitchen", "and": "living"}
    )
    assert res.ok is True
    assert PRO_FLAG_LOAD_BEARING in res.flags
    assert "w-kitchen-living" not in [w.id for w in scene2.walls]


def test_add_room_second_floor_flags_professional() -> None:
    scene, history = _kitchen_scene(), []
    _, res = execute(
        scene,
        history,
        "reform",
        "add_room",
        {"function": "bedroom", "next_to": "kitchen", "size_m": [3.0, 3.0], "level": 2},
    )
    assert res.ok is True  # still applies the valid op
    assert PRO_FLAG_SECOND_FLOOR in res.flags


def test_add_room_unknown_soil_flags_professional() -> None:
    scene, history = _kitchen_scene(), []
    _, res = execute(
        scene,
        history,
        "reform",
        "add_room",
        {
            "function": "bedroom",
            "next_to": "kitchen",
            "size_m": [3.0, 3.0],
            "foundation_unknown_soil": True,
        },
    )
    assert res.ok is True
    assert PRO_FLAG_SOIL in res.flags


# --- Semantic anchors ------------------------------------------------------------


def test_selected_resolves_this_wall() -> None:
    scene, history = _kitchen_scene(), []
    scene2, res = execute(
        scene,
        history,
        "reform",
        "remove_wall",
        {"selected": {"kind": "wall", "id": "W2"}},  # case-insensitive id
    )
    assert res.ok is True
    assert [w.id for w in scene2.walls] == ["w1", "w3", "w4"]


def test_ambiguous_and_unknown_anchors() -> None:
    scene = _kitchen_scene()
    scene.rooms.append(
        Room(
            id="r2",
            name="kitchen",  # duplicate (case-insensitive) room name
            polygon=[(3.0, 0.0), (6.0, 0.0), (6.0, 3.0), (3.0, 3.0)],
            function="bedroom",
        )
    )
    history: list = []
    _, res = execute(
        scene,
        history,
        "reform",
        "add_room",
        {"function": "bedroom", "next_to": "kitchen", "size_m": [3.0, 3.0]},
    )
    assert res.ok is False
    assert res.errors[0].code == "anchor.ambiguous"
    _, res2 = execute(
        scene,
        history,
        "reform",
        "add_room",
        {"function": "bedroom", "next_to": "bathroom", "size_m": [3.0, 3.0]},
    )
    assert res2.errors[0].code == "anchor.unknown"
    assert history == []


# --- Undo / stubs / result shape ---------------------------------------------------


def test_undo_add_wall_restores_scene() -> None:
    base = _kitchen_scene()
    before = base.model_dump()
    history: list = []
    scene, res = execute(
        base, history, "reform", "add_wall", {"a": [3.0, 0.0], "b": [6.0, 0.0]}
    )
    assert res.ok is True
    scene2, undo_res = execute(scene, history, "reform", "undo", {})
    assert undo_res.ok is True
    assert scene2.model_dump() == before  # scene + version restored
    assert history == []  # record popped


def test_undo_empty_history() -> None:
    _, res = execute(_kitchen_scene(), [], "reform", "undo", {})
    assert res.ok is False
    assert res.errors[0].code == "history.empty"


def test_undo_is_global_across_stages() -> None:
    scene, history = _kitchen_scene(), []
    scene, res = execute(
        scene, history, "reform", "add_wall", {"a": [3.0, 0.0], "b": [6.0, 0.0]}
    )
    assert res.ok is True
    scene2, undo_res = execute(scene, history, "design", "undo", {})
    assert undo_res.ok is True  # pops the reform op: undo is global
    assert [w.id for w in scene2.walls] == ["w1", "w2", "w3", "w4"]
    assert history == []


def test_unimplemented_ops_report_not_implemented() -> None:
    stubs = {
        "present": ["create_variant", "render_view"],
    }
    for stage, names in stubs.items():
        for name in names:
            scene, history = _kitchen_scene(), []
            before = scene.model_dump()
            _, res = execute(scene, history, stage, name, {})
            assert res.ok is False, name
            assert res.errors[0].code == "op.not_implemented", name
            assert "ops.py" in res.errors[0].message, name
            assert scene.model_dump() == before
            assert history == []


def test_list_catalog_shape() -> None:
    scene, history = _kitchen_scene(), []
    _, res = execute(scene, history, "design", "list_catalog", {})
    assert isinstance(res, ToolResult)
    assert res.ok is True  # read-only: never mutates
    items = res.data["items"]
    assert items, "assets/catalog.json now ships the construction catalog"
    for item in items:
        assert {"id", "kind", "name"} <= set(item), item.get("id")
    catalog = json.loads(
        (Path(__file__).resolve().parents[2] / "assets" / "catalog.json").read_text(
            encoding="utf-8"
        )
    )
    expected_ids = {m["id"] for m in catalog["materials"]} | {
        f["id"] for f in catalog["furniture"]
    }
    assert {i["id"] for i in items} == expected_ids
    assert not any("catalog" in w for w in res.warnings)  # catalog found, no warning
    assert res.version == scene.version
    assert history == []


def test_error_shape_and_determinism() -> None:
    scene, history = _kitchen_scene(), []
    _, res = execute(scene, history, "reform", "place_furniture", {"catalog_id": "bed-01"})
    err = res.errors[0]
    assert set(err.model_dump()) == {"code", "message"}

    def _sequence(base: Scene, hist: list):
        s, r = execute(
            base,
            hist,
            "reform",
            "add_room",
            {"function": "bedroom", "next_to": "kitchen", "size_m": [3.0, 3.0]},
        )
        assert r.ok
        s, r = execute(
            s, hist, "reform", "add_opening", {"wall": "w1", "kind": "door", "at_ratio": 0.5}
        )
        assert r.ok
        return s

    h1: list = []
    h2: list = []
    s1, s2 = _sequence(_kitchen_scene(), h1), _sequence(_kitchen_scene(), h2)
    assert s1.model_dump() == s2.model_dump()
    # R4: namespaced _undo keys in record args must not break ops.replay.
    assert ops.replay(_kitchen_scene(), h1).model_dump() == s1.model_dump()
