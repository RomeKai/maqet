"""Readable names for rooms and furniture in exports and messages (finding 8)."""

from __future__ import annotations

import re

from server.export.dxf import export_dxf
from server.render.snapshot import render_snapshot
from server.scene.fit import furniture_fit_warnings
from server.scene.models import Furniture, Room, Scene, Wall
from server.scene.names import furniture_display_name, room_display_name

RAW = re.compile(r"\broom-\d|\bbed-double-140x190\b|\bf\d+\b")


def test_room_ids_become_readable() -> None:
    assert room_display_name("room-1") == "Room 1"
    assert room_display_name("r3") == "Room 3"
    assert room_display_name("Kitchen") == "Kitchen"
    assert room_display_name("room-1", "es-AR") == "Ambiente 1"


def test_furniture_uses_catalog_name_in_both_locales() -> None:
    item = Furniture(id="f6", catalog_id="bed-double-140x190", room_id="r", position=(1, 1), size_m=(1.4, 1.9, 0.5))
    assert furniture_display_name(item) == "Double bed 140x190"
    assert furniture_display_name(item, "es-AR").startswith("Cama")
    nameless = Furniture(id="f6", room_id="r", position=(1, 1), size_m=(1, 1, 1))
    assert furniture_display_name(nameless) == "Furniture"


def _scene() -> Scene:
    walls = [
        Wall(id="w1", a=(0, 0), b=(3, 0), thickness_m=0.2, kind="exterior"),
        Wall(id="w2", a=(3, 0), b=(3, 3), thickness_m=0.2, kind="exterior"),
        Wall(id="w3", a=(3, 3), b=(0, 3), thickness_m=0.2, kind="exterior"),
        Wall(id="w4", a=(0, 3), b=(0, 0), thickness_m=0.2, kind="exterior"),
    ]
    room = Room(id="room-1", name="room-1", polygon=[(0, 0), (3, 0), (3, 3), (0, 3)])
    bed = Furniture(id="f6", catalog_id="bed-double-140x190", room_id="room-1", position=(1.5, 1.5), size_m=(1.4, 1.9, 0.5))
    return Scene(id="s", scale_confirmed=True, walls=walls, rooms=[room], furniture=[bed])


def test_dxf_labels_are_readable() -> None:
    texts = [e.dxf.text for e in export_dxf(_scene()).modelspace() if e.dxftype() == "TEXT"]
    assert "Room 1" in texts and "Double bed 140x190" in texts
    assert not [t for t in texts if RAW.search(t)]


def test_snapshot_text_is_readable() -> None:
    svg = render_snapshot(_scene())
    visible = re.findall(r">([^<]+)<", svg)
    assert "Room 1" in visible
    assert not [t for t in visible if RAW.search(t)]


def test_passage_warning_names_the_furniture() -> None:
    scene = _scene()
    scene = scene.model_copy(update={"furniture": [
        Furniture(id="f6", catalog_id="bed-double-140x190", room_id="room-1", position=(1.05, 1.5), size_m=(1.4, 2.8, 0.5)),
    ]})
    msgs = [str(f) for f in furniture_fit_warnings(scene)]
    passage = [m for m in msgs if "passage" in m]
    assert passage, msgs
    assert not [m for m in passage if RAW.search(m)]
