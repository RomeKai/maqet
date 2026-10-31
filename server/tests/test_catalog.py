"""Catalog tests: assets/catalog.json (ADR-024) is well-formed and sane.

Offline: reads the JSON file only, no network, no mme.client.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

CATALOG_PATH = Path(__file__).resolve().parents[2] / "assets" / "catalog.json"

REQUIRED_MATERIAL_KEYS = {
    "id",
    "name",
    "name_es_AR",
    "kind",
    "unit",
    "recipe",
    "waste_factor",
    "recipe_source",
    "source_url",
    "license",
    "local_path",
}

# Sanity bounds for recipe.qty by unit (estimates, not engineering values).
QTY_BOUNDS = {
    "piece": (0.0, 200.0),  # bricks per m2 of wall live here
    "m3": (0.0, 2.0),  # mortar m3 per m2 of wall, sand/gravel m3 per m3 of mix
    "bag": (0.0, 20.0),  # cement bags per m3 of mortar
    "m": (0.0, 20.0),  # steel metres per metre of beam
    "m2": (1.0, 1.5),  # roofing m2 per m2 of roof (overlap included)
}


def _catalog() -> dict[str, Any]:
    return json.loads(CATALOG_PATH.read_text(encoding="utf-8"))


def test_catalog_file_loads_with_materials_and_furniture() -> None:
    catalog = _catalog()
    assert catalog["schema_version"] == 1
    assert len(catalog["materials"]) >= 12
    assert len(catalog["furniture"]) >= 6


def test_ids_unique_across_materials_and_furniture() -> None:
    catalog = _catalog()
    ids = [m["id"] for m in catalog["materials"]] + [
        f["id"] for f in catalog["furniture"]
    ]
    assert len(ids) == len(set(ids))


def test_every_material_has_unit_recipe_waste_and_source() -> None:
    for material in _catalog()["materials"]:
        assert REQUIRED_MATERIAL_KEYS <= set(material), material.get("id")
        assert material["unit"]
        assert isinstance(material["recipe"], dict) and material["recipe"].get(
            "qty"
        ) not in (None, 0)
        assert 1.0 <= material["waste_factor"] <= 1.3, material["id"]
        assert material["recipe_source"]


def test_recipe_values_positive_and_sane() -> None:
    for material in _catalog()["materials"]:
        qty = material["recipe"]["qty"]
        assert qty > 0, material["id"]
        low, high = QTY_BOUNDS[material["unit"]]
        if material["kind"] == "finish":  # 1 m2 of finish per m2 of surface
            assert qty == 1.0, material["id"]
            continue
        assert low < qty <= high, (material["id"], qty)


def test_brick_recipes_cover_required_wall_thicknesses() -> None:
    thicknesses = {
        m["recipe"]["wall_thickness_m"]
        for m in _catalog()["materials"]
        if m["kind"] == "masonry"
    }
    assert {0.2, 0.1, 0.18} <= thicknesses


def test_every_file_asset_is_cc0_with_source() -> None:
    entries = _catalog()["materials"] + _catalog()["furniture"]
    file_assets = [e for e in entries if e.get("local_path")]
    # Zero file assets is allowed (e.g. GLBs not yet produced); any that
    # exist must be CC0 with a declared source.
    for entry in file_assets:
        assert entry["license"] == "CC0", entry["id"]
        assert entry["source_url"], entry["id"]


def test_furniture_dims_sane() -> None:
    for item in _catalog()["furniture"]:
        dims = item["dims_m"]
        assert 0.0 < dims["w"] < 3.0, item["id"]
        assert 0.0 < dims["d"] < 3.0, item["id"]
        assert 0.0 <= dims["h"] <= 2.5, item["id"]


def test_door_swing_arc_is_clearance_only_with_no_model() -> None:
    arc = next(
        f for f in _catalog()["furniture"] if f["id"] == "door-swing-arc-90"
    )
    assert arc["clearance_only"] is True
    assert arc["local_path"] is None
    assert arc["diameter_m"] == 0.9


def test_solid_common_brick_yield_for_020_wall() -> None:
    brick = next(
        m for m in _catalog()["materials"] if m["id"] == "brick-solid-common-20"
    )
    assert brick["recipe"]["wall_thickness_m"] == 0.2
    assert 100 <= brick["recipe"]["qty"] <= 120, brick["recipe"]["qty"]


def test_hollow_18_brick_id_matches_thickness_and_yield() -> None:
    brick = next(
        m for m in _catalog()["materials"] if m["id"] == "brick-hollow-18-18"
    )
    assert brick["recipe"]["wall_thickness_m"] == 0.18
    assert 13 <= brick["recipe"]["qty"] <= 16, brick["recipe"]["qty"]


def test_furniture_without_glb_is_marked_pending() -> None:
    for item in _catalog()["furniture"]:
        status = item.get("asset_status")
        assert status in {"ready", "pending", "n/a"}, item["id"]
        if status == "pending":
            assert item["local_path"] is None, item["id"]
