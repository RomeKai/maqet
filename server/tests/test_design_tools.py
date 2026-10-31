"""Design stage tools: deterministic furniture placement (ADR-002), undo, replay."""

from __future__ import annotations

import math

import pytest
from shapely.geometry import LineString, Polygon

from server.agent.executor import execute
from server.scene import ops
from server.scene.models import Scene


def _scene() -> Scene:
    pts = [(0, 0), (4, 0), (4, 3), (0, 3)]
    walls = [
        {"id": f"w{i+1}", "a": pts[i], "b": pts[(i + 1) % 4], "thickness_m": 0.2, "kind": "exterior"}
        for i in range(4)
    ]
    return Scene.model_validate(
        {
            "id": "s",
            "walls": walls,
            "openings": [
                {"id": "d1", "wall_id": "w1", "kind": "door", "offset_m": 1.5, "width_m": 0.9, "height_m": 2.1}
            ],
            "rooms": [{"id": "r1", "name": "Bedroom", "polygon": pts, "function": "bedroom"}],
        }
    )


def _poly(f) -> Polygon:
    w, d, _ = f.size_m
    t = math.radians(f.rotation_deg)
    c, s = math.cos(t), math.sin(t)
    return Polygon(
        [(f.position[0] + x * c - y * s, f.position[1] + x * s + y * c)
         for x, y in ((-w / 2, -d / 2), (w / 2, -d / 2), (w / 2, d / 2), (-w / 2, d / 2))]
    )


def _walls(scene):
    return [LineString([w.a, w.b]).buffer(w.thickness_m / 2, cap_style=2) for w in scene.walls]


def test_place_bed_uses_catalog_dims_inside_room_without_touching_walls() -> None:
    scene, hist = _scene(), []
    new, res = execute(scene, hist, "design", "place_furniture", {"catalog_id": "bed-single-90x190", "room": "Bedroom"})
    assert res.ok, res.errors
    (f,) = new.furniture
    assert f.size_m == (0.9, 1.9, 0.55)
    assert f.room_id == "r1" and f.rotation_deg % 90 == 0
    p = _poly(f)
    assert Polygon(new.rooms[0].polygon).buffer(1e-6).contains(p)
    assert all(p.intersection(w).area < 1e-6 for w in _walls(new))
    assert len(hist) == 1 and new.version == scene.version + 1


def test_place_is_deterministic_and_second_item_does_not_overlap() -> None:
    a, _ = execute(_scene(), [], "design", "place_furniture", {"catalog_id": "wardrobe-120x60", "room": "r1"})
    b, _ = execute(_scene(), [], "design", "place_furniture", {"catalog_id": "wardrobe-120x60", "room": "r1"})
    assert a.furniture == b.furniture
    both, res = execute(a, [], "design", "place_furniture", {"catalog_id": "bed-single-90x190", "room": "r1"})
    assert res.ok
    assert _poly(both.furniture[0]).intersection(_poly(both.furniture[1])).area < 1e-6


def test_scale_only_within_twenty_percent() -> None:
    ok, res = execute(_scene(), [], "design", "place_furniture", {"catalog_id": "table-120x75", "room": "r1", "scale": 1.2})
    assert res.ok and ok.furniture[0].size_m[0] == pytest.approx(1.44)
    _, bad = execute(_scene(), [], "design", "place_furniture", {"catalog_id": "table-120x75", "room": "r1", "scale": 1.5})
    assert not bad.ok


def test_unknown_catalog_item_and_no_space() -> None:
    _, res = execute(_scene(), [], "design", "place_furniture", {"catalog_id": "nope", "room": "r1"})
    assert not res.ok and res.errors[0].code == "catalog.unknown_item"
    scene = _scene()
    for _ in range(12):
        scene, res = execute(scene, [], "design", "place_furniture", {"catalog_id": "wardrobe-120x60", "room": "r1"})
        if not res.ok:
            break
    assert not res.ok and res.errors[0].code == "furniture.no_space"


def test_door_swing_zone_stays_free() -> None:
    scene = _scene()
    for _ in range(3):
        scene, res = execute(scene, [], "design", "place_furniture", {"catalog_id": "wardrobe-120x60", "room": "r1"})
        if not res.ok:
            break
    zone = Polygon([(1.5, 0), (2.4, 0), (2.4, 0.9), (1.5, 0.9)])
    assert all(_poly(f).intersection(zone).area < 1e-6 for f in scene.furniture)


def test_move_rotate_remove_and_undo() -> None:
    hist: list = []
    s, _ = execute(_scene(), hist, "design", "place_furniture", {"catalog_id": "chair-45x45", "room": "r1", "item_id": "c1"})
    s, res = execute(s, hist, "design", "move_item", {"item": "c1", "position": [2.0, 2.0]})
    assert res.ok and s.furniture[0].position == (2.0, 2.0)
    _, res = execute(s, hist, "design", "move_item", {"item": "c1", "position": [0.0, 0.0]})
    assert not res.ok  # inside the wall body
    s, res = execute(s, hist, "design", "rotate_item", {"item": "c1", "rotation_deg": 100})
    assert res.ok and s.furniture[0].rotation_deg == 90
    s, res = execute(s, hist, "design", "remove_item", {"item": "last"})
    assert res.ok and s.furniture == []
    s, res = execute(s, hist, "design", "undo", {})
    assert res.ok and len(s.furniture) == 1 and s.furniture[0].rotation_deg == 90
    s, _ = execute(s, hist, "design", "undo", {})
    assert s.furniture[0].rotation_deg == 0


def test_replay_reproduces_design_history() -> None:
    hist: list = []
    base = _scene()
    s, _ = execute(base, hist, "design", "place_furniture", {"catalog_id": "sofa-3seat-200x90", "room": "r1"})
    s, _ = execute(s, hist, "design", "rotate_item", {"item": "last", "delta_deg": 90})
    again = ops.replay(base, hist)
    assert again.furniture == s.furniture


def test_design_tools_not_allowed_in_reform() -> None:
    _, res = execute(_scene(), [], "reform", "place_furniture", {"catalog_id": "chair-45x45"})
    assert res.errors[0].code == "stage.tool_not_allowed"


def test_set_surface_material_floor_and_inward_wall_sides_reach_takeoff() -> None:
    from server.export.takeoff import compute_takeoff

    hist: list = []
    s, res = execute(_scene(), hist, "design", "set_surface_material",
                     {"room": "r1", "part": "floor", "material_id": "floor-wood-laminate"})
    assert res.ok, res.errors
    s, res = execute(s, hist, "design", "set_surface_material",
                     {"room": "r1", "part": "walls", "material_id": "wall-paint-white"})
    assert res.ok, res.errors
    wall_surfaces = [x for x in s.surfaces if x.target.type == "wall"]
    assert len(wall_surfaces) == 4  # one inward side per wall
    # inward = side holding the room centre: w1 runs +x along the south edge, room is on its left
    assert next(x for x in wall_surfaces if x.target.wall_id == "w1").target.side == "left"
    finishes = next(st for st in compute_takeoff(s).stages if st.name == "finishes")
    ids = {i.material_id for i in finishes.items}
    assert {"floor-wood-laminate", "wall-paint-white"} <= ids
    s, _ = execute(s, hist, "design", "set_surface_material",
                   {"room": "r1", "part": "floor", "material_id": "floor-cement-screed"})
    assert [x.material_id for x in s.surfaces if x.target.type == "room"] == ["floor-cement-screed"]
    s, _ = execute(s, hist, "design", "undo", {})
    assert [x.material_id for x in s.surfaces if x.target.type == "room"] == ["floor-wood-laminate"]


def test_surface_material_rejects_wrong_surface_kind_and_unknown() -> None:
    _, bad = execute(_scene(), [], "design", "set_surface_material", {"room": "r1", "part": "floor", "material_id": "wall-paint-white"})
    assert bad.errors[0].code == "catalog.unknown_item"
    _, bad = execute(_scene(), [], "design", "set_surface_material", {"room": "r1", "part": "walls", "material_id": "nope"})
    assert bad.errors[0].code == "catalog.unknown_item"


def test_brighter_hint_when_room_has_no_window() -> None:
    _, res = execute(_scene(), [], "design", "set_surface_material", {"room": "r1", "part": "walls", "material_id": "wall-paint-white"})
    assert any("window" in w for w in res.warnings)
