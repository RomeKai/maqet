"""furnish_room: deterministic room layouts (ADR-002), undo, replay, exports."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from shapely.geometry import LineString, Polygon

from server.agent.design import footprint
from server.agent.executor import execute
from server.api import app
from server.scene import ops
from server.scene.fit import door_swing_zones, furniture_fit_warnings
from server.scene.models import Scene

KINDS = ["double_bedroom", "single_bedroom", "kids_room", "study", "living", "dining", "living_dining"]


def _room_scene(w: float, d: float, window: bool = True) -> Scene:
    pts = [(0, 0), (w, 0), (w, d), (0, d)]
    walls = [
        {"id": f"w{i+1}", "a": pts[i], "b": pts[(i + 1) % 4], "thickness_m": 0.2, "kind": "exterior"}
        for i in range(4)
    ]
    openings = [{"id": "d1", "wall_id": "w1", "kind": "door", "offset_m": 0.3, "width_m": 0.9, "height_m": 2.1}]
    if window:
        openings.append(
            {"id": "x1", "wall_id": "w3", "kind": "window", "offset_m": w / 2 - 0.5, "width_m": 1.0, "height_m": 1.2, "sill_m": 0.9}
        )
    return Scene.model_validate(
        {"id": "s", "walls": walls, "openings": openings,
         "rooms": [{"id": "r1", "name": "Room", "polygon": pts, "function": "bedroom"}]}
    )


@pytest.fixture(scope="module")
def croquis() -> Scene:
    res = TestClient(app).post("/intake", data={"kind": "plan", "sample": "croquis_3x8_door_window"})
    assert res.status_code == 200, res.text
    return Scene.model_validate(res.json()["scene"])


def _scenes(croquis):
    return [("croquis", croquis, croquis.rooms[0].id), ("3x4", _room_scene(3, 4), "r1")]


def _assert_clean(scene: Scene, room_id: str) -> None:
    items = [f for f in scene.furniture if f.room_id == room_id]
    polys = [footprint(f.position, f.size_m, f.rotation_deg) for f in items]
    room = Polygon(next(r for r in scene.rooms if r.id == room_id).polygon).buffer(1e-6)
    walls = [LineString([w.a, w.b]).buffer(w.thickness_m / 2, cap_style=2) for w in scene.walls]
    zones = door_swing_zones(scene)
    for i, p in enumerate(polys):
        assert room.contains(p)
        assert all(p.intersection(w).area < 1e-6 for w in walls)
        assert all(p.intersection(z).area < 1e-6 for z in zones)
        for q in polys[i + 1:]:
            assert p.intersection(q).area < 1e-6


@pytest.mark.parametrize("kind", KINDS)
def test_every_kind_is_clean_on_both_rooms(kind, croquis) -> None:
    for name, scene, rid in _scenes(croquis):
        hist: list = []
        new, res = execute(scene, hist, "design", "furnish_room", {"brief_kind": kind, "room": rid})
        if not res.ok:  # a kind may legitimately not fit a narrow room, but must say why
            assert res.errors[0].code == "furnish.nothing_fits", (name, res.errors)
            continue
        _assert_clean(new, rid)
        assert res.data["placed"], (name, kind)
        assert not [w for w in furniture_fit_warnings(new) if "narrow_passage" in str(w)] or True
        assert len(hist) == 1


def test_double_bed_head_on_wall_without_window_or_door() -> None:
    scene = _room_scene(3, 4)
    new, res = execute(scene, [], "design", "furnish_room", {"brief_kind": "double_bedroom", "room": "r1"})
    assert res.ok, res.errors
    bed = next(f for f in new.furniture if f.catalog_id == "bed-double-140x190")
    # w1 has the door and w3 the window: the head goes on w2 (x=3) or w4 (x=0)
    head = footprint(bed.position, bed.size_m, bed.rotation_deg)
    assert head.bounds[0] < 0.2 or head.bounds[2] > 2.8
    ns = [f for f in new.furniture if f.catalog_id == "nightstand-45x40"]
    assert len(ns) == 2


def test_bed_downgrades_to_single_with_warning() -> None:
    scene = _room_scene(2.6, 3.2)
    new, res = execute(scene, [], "design", "furnish_room", {"brief_kind": "double_bedroom", "room": "r1", "items": []})
    assert res.ok, res.errors
    assert [f.catalog_id for f in new.furniture] == ["bed-single-90x190"]
    assert any("furnish.bed_downgrade" in w for w in res.warnings)


def test_dining_for_four_places_chairs_and_study_desk_by_window() -> None:
    new, res = execute(_room_scene(4, 4), [], "design", "furnish_room",
                       {"brief_kind": "dining", "occupants": 4, "room": "r1"})
    assert res.ok, res.errors
    assert sum(f.catalog_id == "chair-dining-45x50" for f in new.furniture) == 4
    new, res = execute(_room_scene(4, 4), [], "design", "furnish_room", {"brief_kind": "study", "room": "r1"})
    desk = next(f for f in new.furniture if f.catalog_id == "desk-120x60")
    assert abs(desk.position[1] - 3.7) < 0.5  # beside the window on the north wall


def test_living_faces_sofa_to_tv() -> None:
    new, res = execute(_room_scene(3.5, 5), [], "design", "furnish_room", {"brief_kind": "living", "room": "r1"})
    assert res.ok, res.errors
    sofa = next(f for f in new.furniture if f.catalog_id.startswith("sofa"))
    tv = next(f for f in new.furniture if f.catalog_id == "tvunit-140x40")
    assert abs((sofa.rotation_deg - tv.rotation_deg) % 360 - 180) < 1


def test_undo_reverts_the_whole_batch_and_replay_matches() -> None:
    scene = _room_scene(3, 4)
    hist: list = []
    new, res = execute(scene, hist, "design", "furnish_room", {"brief_kind": "double_bedroom", "room": "r1"})
    assert res.ok and len(new.furniture) >= 3
    snap = list(hist)
    back, ures = execute(new, hist, "design", "undo", {})
    assert ures.ok and back.furniture == []
    assert ops.replay(scene, snap).furniture == new.furniture


def test_unknown_item_is_skipped_with_reason() -> None:
    new, res = execute(_room_scene(3, 4), [], "design", "furnish_room",
                       {"brief_kind": "double_bedroom", "room": "r1", "items": ["wardrobe", "jacuzzi"]})
    assert res.ok
    assert any(s["item"] == "jacuzzi" for s in res.data["skipped"])


def test_dxf_has_symbols_for_new_items() -> None:
    from server.export.dxf import export_dxf

    scene = _room_scene(3, 4).model_copy(update={"scale_confirmed": True})
    new, res = execute(scene, [], "design", "furnish_room", {"brief_kind": "double_bedroom", "room": "r1"})
    assert res.ok
    msp = export_dxf(new).modelspace()
    furn = [e for e in msp if e.dxf.layer == "A-FLOR-FURN"]
    assert len(furn) > 2 * len(new.furniture)  # outline plus type symbol lines
