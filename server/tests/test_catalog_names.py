"""Every catalog item has en and es-AR display names; takeoff lines carry them."""

import json

from server.export.takeoff import CATALOG_PATH, compute_takeoff
from server.scene.models import Scene


def test_every_catalog_item_has_en_and_es_names() -> None:
    catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    for group in ("materials", "furniture"):
        for item in catalog[group]:
            assert item.get("name"), item["id"]
            assert item.get("name_es_AR"), item["id"]


def test_takeoff_lines_carry_localized_names() -> None:
    scene = Scene.model_validate(
        {
            "id": "s",
            "walls": [
                {"id": "w1", "a": [0, 0], "b": [4, 0], "thickness_m": 0.2, "kind": "exterior"},
                {"id": "w2", "a": [4, 0], "b": [4, 3], "thickness_m": 0.2, "kind": "exterior"},
            ]
        }
    )
    items = [i for s in compute_takeoff(scene).stages for i in s.items]
    assert items
    for item in items:
        assert item.name and item.name != item.material_id
        assert item.name_es_AR and item.name_es_AR != item.material_id
