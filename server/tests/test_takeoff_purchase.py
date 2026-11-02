"""Purchasable quantities: whole bags and pieces; quantity stays unrounded (finding 8)."""

from __future__ import annotations

import csv
import io
import json
import math
from pathlib import Path

from server.export.takeoff import TakeoffItem, compute_takeoff, to_csv
from server.scene.models import Scene

SAMPLES = Path(__file__).resolve().parents[2] / "samples" / "plans"


def _item(unit: str, quantity: float) -> TakeoffItem:
    return TakeoffItem(material_id="cement-bag-50kg", unit=unit, quantity=quantity, waste_factor=1.05, recipe_source="x")


def test_bags_and_pieces_round_up_to_whole_units() -> None:
    assert _item("bag", 13.2).purchase_quantity == 14
    assert _item("bag", 14.0).purchase_quantity == 14
    assert _item("bag", 14.0000000001).purchase_quantity == 14  # float noise is not a new bag
    assert _item("piece", 0.2).purchase_quantity == 1


def test_continuous_units_round_up_to_two_decimals() -> None:
    assert _item("m3", 1.234).purchase_quantity == 1.24
    assert _item("m2", 10.0).purchase_quantity == 10.0


def test_unrounded_quantity_is_kept() -> None:
    assert _item("bag", 13.2).quantity == 13.2


def test_csv_carries_both_columns() -> None:
    scene = Scene.model_validate(json.loads((SAMPLES / "croquis_ampliacion.truth.json").read_text(encoding="utf-8")))
    takeoff = compute_takeoff(scene)
    rows = list(csv.DictReader(io.StringIO(to_csv(takeoff))))
    assert rows and "purchase_quantity" in rows[0]
    for row in rows:
        if row["unit"] in ("bag", "piece"):
            assert float(row["purchase_quantity"]) == math.ceil(float(row["quantity"]) - 1e-9)
        assert float(row["purchase_quantity"]) >= float(row["quantity"]) - 1e-9
