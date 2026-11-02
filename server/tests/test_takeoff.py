"""Staged construction takeoff tests (ADR-021, ADR-024).

Offline: fixtures + catalog only, no network, no mme.client.
Hand-computed expectations live in each test; implementation must match.
"""

from __future__ import annotations

import csv
import json
from pathlib import Path

import pytest

from server.export.takeoff import STAGE_ORDER, Takeoff, compute_takeoff, to_csv
from server.scene.models import Scene

PLANS = Path(__file__).resolve().parents[2] / "samples" / "plans"


def _load(name: str) -> Scene:
    return Scene(**json.loads((PLANS / name).read_text(encoding="utf-8")))


def _items_by_material(takeoff: Takeoff, stage: str) -> dict[str, float]:
    st = next(s for s in takeoff.stages if s.name == stage)
    return {i.material_id: i.quantity for i in st.items}


def test_contract_shape() -> None:
    scene = _load("croquis_ampliacion.truth.json")
    takeoff = compute_takeoff(scene)
    assert [s.name for s in takeoff.stages] == list(STAGE_ORDER)
    assert STAGE_ORDER == (
        "foundations",
        "walls",
        "bond_beams_roof",
        "openings",
        "finishes",
    )
    for stage in takeoff.stages:
        for item in stage.items:
            assert set(type(item).model_fields) == {
                "material_id",
                "unit",
                "quantity",
                "purchase_quantity",
                "waste_factor",
                "recipe_source",
                "estimated",
                "name",
                "name_es_AR",
                "width_m",
                "note",
                "note_es_AR",
            }
    assert takeoff.preliminary is True
    assert isinstance(takeoff.professional_flags, list)
    assert isinstance(takeoff.has_estimated, bool)
    header = to_csv(takeoff).splitlines()[0]
    assert header == (
        "stage,material_id,unit,quantity,waste_factor,recipe_source,estimated,purchase_quantity"
    )


def test_croquis_foundations() -> None:
    scene = _load("croquis_ampliacion.truth.json")
    takeoff = compute_takeoff(scene)
    # 7 walls: 3+3+3+3+3.5+3.5+3.5 = 22.5 m; V = 22.5 * 0.4 * 0.6 = 5.4 m3.
    items = _items_by_material(takeoff, "foundations")
    assert items["gravel-m3"] == pytest.approx(5.4 * 0.7 * 1.1)
    assert items["sand-m3"] == pytest.approx(5.4 * 0.45 * 1.1)
    assert items["cement-bag-50kg"] == pytest.approx(5.4 * 7.0 * 1.05)
    stage = next(s for s in takeoff.stages if s.name == "foundations")
    assert stage.items and all(i.estimated for i in stage.items)


def test_croquis_walls() -> None:
    scene = _load("croquis_ampliacion.truth.json")
    takeoff = compute_takeoff(scene)
    items = _items_by_material(takeoff, "walls")
    # Exterior 0.20 m: 19 m * 2.6 = 49.4 gross; openings 1.845+1.8+1.44+0.8
    # = 5.885 -> net 43.515 m2. Interior 0.10 m: 3.5*2.6 = 9.1 - 1.64 = 7.46.
    assert items["brick-solid-common-20"] == pytest.approx(43.515 * 108 * 1.05)
    assert items["brick-hollow-12-10"] == pytest.approx(7.46 * 15 * 1.05)
    # Mortar on total net 50.975 m2: raw 50.975*0.03 = 1.52925 m3.
    assert items["mortar-13"] == pytest.approx(1.52925 * 1.1)
    assert items["cement-bag-50kg"] == pytest.approx(1.52925 * 9 * 1.05)
    assert items["sand-m3"] == pytest.approx(1.52925 * 1.1 * 1.1)


def test_croquis_beam_roof() -> None:
    scene = _load("croquis_ampliacion.truth.json")
    takeoff = compute_takeoff(scene)
    items = _items_by_material(takeoff, "bond_beams_roof")
    # Beam = 22.5 m; roof = 3.5*3.5 + 2.5*3.5 = 21.0 m2.
    assert items["steel-bar-6mm"] == pytest.approx(22.5 * 5 * 1.1)
    assert items["steel-bar-8mm"] == pytest.approx(22.5 * 4 * 1.1)
    assert items["roofing-sheet-galv"] == pytest.approx(21.0 * 1.15 * 1.05)


def test_croquis_openings() -> None:
    scene = _load("croquis_ampliacion.truth.json")
    takeoff = compute_takeoff(scene)
    items = _items_by_material(takeoff, "openings")
    # Doors 0.90 / 0.80 and windows 1.50 / 1.20 / 1.00: only the stocked sizes land on the catalog items.
    assert items["door-90"] == pytest.approx(1.0)
    assert items["window-120"] == pytest.approx(1.0)
    # Every other width keeps its real size on its own flagged line (never silently swapped for door-90 / window-120).
    assert items["door-80"] == pytest.approx(1.0)
    assert items["window-150"] == pytest.approx(1.0)
    assert items["window-100"] == pytest.approx(1.0)


def test_written_widths_reach_the_takeoff_with_a_flag() -> None:
    """Finding 5: a 1.50 m door and a 1.00 m window are not door-90 / window-120."""
    scene = _load("croquis_3x8_door_window.truth.json")
    takeoff = compute_takeoff(scene)
    st = next(s for s in takeoff.stages if s.name == "openings")
    by_id = {i.material_id: i for i in st.items}
    assert "door-90" not in by_id and "window-120" not in by_id
    assert by_id["door-150"].width_m == pytest.approx(1.5)
    assert by_id["window-100"].width_m == pytest.approx(1.0)
    for item in by_id.values():
        assert item.estimated is True and item.note and item.note_es_AR
        assert "1.50" in item.name or "1.00" in item.name


def test_croquis_finishes_empty_surfaces() -> None:
    scene = _load("croquis_ampliacion.truth.json")
    takeoff = compute_takeoff(scene)
    stage = next(s for s in takeoff.stages if s.name == "finishes")
    floors = {
        (i.material_id, i.quantity)
        for i in stage.items
        if i.unit == "m2" and i.quantity in (12.25, 8.75)
    }
    assert len(floors) == 2  # 12.25 + 8.75 m2, material 'unspecified'
    wall_finish = sum(
        i.quantity for i in stage.items if i.material_id == "unspecified"
    ) - (12.25 + 8.75)
    # Net wall m2 per side 50.975, both sides = 101.95.
    assert wall_finish == pytest.approx(101.95)


def test_base_vs_reform_diff() -> None:
    base = _load("croquis_ampliacion.truth.json")
    data = json.loads((PLANS / "croquis_ampliacion.truth.json").read_text())
    data["walls"] = [w for w in data["walls"] if w["id"] != "w_e1"]
    for w in data["walls"]:
        if w["id"] == "w_s1":
            w["b"] = [3.1, 0.0]  # moved endpoint -> demolished + built
    data["walls"].append(
        {"id": "w_new", "a": [6, 0], "b": [6, 2], "thickness_m": 0.2,
         "kind": "exterior"}
    )
    variant = Scene(**data)
    takeoff = compute_takeoff(variant, base=base)
    # Built: w_s1 moved (3.1 m) + w_new (2.0 m). Demolished: w_e1 (3.5) + w_s1 (3.0).
    assert takeoff.built_m == pytest.approx(5.1)
    assert takeoff.demolished_m == pytest.approx(6.5)
    assert takeoff.built_m2 == pytest.approx(5.1 * 2.6)
    assert takeoff.demolished_m2 == pytest.approx(6.5 * 2.6)
    # Foundations only on built walls: V = 5.1 * 0.4 * 0.6 = 1.224.
    items = _items_by_material(takeoff, "foundations")
    assert items["gravel-m3"] == pytest.approx(1.224 * 0.7 * 1.1)


def test_estimated_flag() -> None:
    scene = _load("croquis_ampliacion.truth.json")
    data = scene.model_dump()
    for w in data["walls"]:
        w["provenance"] = "measured_tape"
    data["walls"][0]["provenance"] = "estimated"
    scene2 = Scene(**data)
    takeoff = compute_takeoff(scene2)
    assert takeoff.has_estimated is True
    stage = next(s for s in takeoff.stages if s.name == "foundations")
    assert all(i.estimated for i in stage.items)  # footings always estimated
    walls = next(s for s in takeoff.stages if s.name == "walls")
    # w_s1 is exterior 0.20 m: its brick line must be estimated.
    brick = next(i for i in walls.items if i.material_id == "brick-solid-common-20")
    assert brick.estimated is True


def test_effective_height() -> None:
    scene = _load("croquis_ampliacion.truth.json")
    data = scene.model_dump()
    data["walls"][0]["height_m"] = 3.0  # beats scene.ceiling_height_m = 2.6
    scene2 = Scene(**data)
    takeoff = compute_takeoff(scene2)
    # w_s1 gross 3*3.0 = 9.0 instead of 7.8 -> net exterior +1.2 m2.
    items = _items_by_material(takeoff, "walls")
    assert items["brick-solid-common-20"] == pytest.approx((43.515 + 1.2) * 108 * 1.05)


def test_per_wall_height_override_lowers_wall_quantities() -> None:
    """A wall overridden to 2.40 m (uneven ceiling) counts at 2.40, not 2.60."""
    scene = _load("croquis_ampliacion.truth.json")
    data = scene.model_dump()
    data["walls"][0]["height_m"] = 2.4  # w_s1: 3 m long, 0.2 m exterior
    takeoff = compute_takeoff(Scene(**data))
    items = _items_by_material(takeoff, "walls")
    # gross 3*2.4 = 7.2 instead of 7.8 -> net exterior 43.515 - 0.6 m2.
    assert items["brick-solid-common-20"] == pytest.approx((43.515 - 0.6) * 108 * 1.05)


def test_professional_flags_and_csv() -> None:
    scene = _load("croquis_ampliacion.truth.json")
    data = scene.model_dump()
    data["walls"].append(
        {"id": "w_long", "a": [0, 0], "b": [5, 0], "thickness_m": 0.2,
         "kind": "exterior"}
    )
    scene2 = Scene(**data)
    takeoff = compute_takeoff(scene2)
    assert any("span_over_limit" in f for f in takeoff.professional_flags)
    assert any("unknown_soil" in f for f in takeoff.professional_flags)
    # Determinism: identical input -> identical output.
    assert compute_takeoff(scene2).model_dump() == takeoff.model_dump()
    csv_text = to_csv(takeoff)
    lines = csv_text.splitlines()
    total_items = sum(len(s.items) for s in takeoff.stages)
    assert len(lines) == total_items + 1
    # No model calls: module must not reference the Meta gateway client.
    src = Path(__file__).resolve().parents[1] / "export" / "takeoff.py"
    assert "mme" not in src.read_text(encoding="utf-8")


def test_48m_plan_spotcheck() -> None:
    scene = _load("plano_48m_1ambiente.truth.json")
    takeoff = compute_takeoff(scene)
    # Lengths: 4+4+4+4+3+3+3+3+4+4+2.5 = 38.5 m -> V = 38.5*0.24 = 9.24 m3.
    items = _items_by_material(takeoff, "foundations")
    assert items["gravel-m3"] == pytest.approx(9.24 * 0.7 * 1.1)
    assert takeoff.built_m == pytest.approx(38.5)
    assert takeoff.demolished_m == pytest.approx(0.0)


def test_empty_scene_is_zero_takeoff() -> None:
    scene = Scene(id="empty", units="m")
    takeoff = compute_takeoff(scene)
    assert takeoff.built_m == 0.0
    assert all(len(s.items) == 0 for s in takeoff.stages)
    assert "unknown_soil" not in " ".join(takeoff.professional_flags)
    assert to_csv(takeoff).splitlines() == [
        "stage,material_id,unit,quantity,waste_factor,recipe_source,estimated,purchase_quantity"
    ]


def test_compute_does_not_mutate_scene() -> None:
    scene = _load("croquis_ampliacion.truth.json")
    before = scene.model_dump()
    compute_takeoff(scene)
    compute_takeoff(scene, base=scene)
    assert scene.model_dump() == before
