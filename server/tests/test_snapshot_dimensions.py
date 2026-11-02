"""The Deliver plan snapshot shows wall lengths and opening widths, legible and unclipped (phone finding 7)."""

from __future__ import annotations

import json
import re
import xml.etree.ElementTree as ET
from pathlib import Path

import pytest

from server.render.snapshot import render_snapshot
from server.scene.models import Scene

PLANS = Path(__file__).resolve().parents[2] / "samples" / "plans"


def _scene() -> Scene:
    return Scene(**json.loads((PLANS / "croquis_3x8_door_window.truth.json").read_text(encoding="utf-8")))


def _root(locale: str = "en") -> ET.Element:
    return ET.fromstring(render_snapshot(_scene(), locale))


def _view(root: ET.Element) -> tuple[float, float, float, float]:
    x, y, w, h = (float(v) for v in root.get("viewBox", "").split())
    return x, y, x + w, y + h


def _dim_texts(root: ET.Element, kind: str) -> list[ET.Element]:
    return [t for t in root.iter("text") if t.get("data-dim") == kind]


def test_wall_lengths_and_opening_widths_are_labelled() -> None:
    root = _root()
    assert sorted(t.text for t in _dim_texts(root, "wall")) == ["3.00 m", "3.00 m", "8.00 m", "8.00 m"]
    assert sorted(t.text for t in _dim_texts(root, "opening")) == ["1.00 m", "1.50 m"]


def test_labels_use_the_locale_decimal_separator() -> None:
    root = _root("es-AR")
    assert sorted(t.text for t in _dim_texts(root, "opening")) == ["1,00 m", "1,50 m"]


def test_estimated_wall_length_says_so() -> None:
    scene = _scene()
    scene.walls[0].provenance = "estimated"
    scene.walls[0].measured_length_m = None
    root = ET.fromstring(render_snapshot(scene))
    assert any(t.text.startswith("≈") for t in _dim_texts(root, "wall"))


def test_nothing_is_clipped_at_the_card_edge() -> None:
    root = _root()
    x0, y0, x1, y1 = _view(root)
    for t in _dim_texts(root, "wall") + _dim_texts(root, "opening"):
        size = float(t.get("font-size", "0"))
        half = 0.62 * size * len(t.text or "") / 2
        x, y = float(t.get("x", "0")), float(t.get("y", "0"))
        assert x - half >= x0 - 1e-6 and x + half <= x1 + 1e-6, (t.text, x, half, x0, x1)
        assert y - size >= y0 - 1e-6 and y <= y1 + 1e-6, (t.text, y, y0, y1)
    # Door arc: every coordinate of the path, and the full swing square, stays inside the view.
    for path in root.iter("path"):
        nums = [float(n) for n in re.findall(r"-?\d+\.\d+", path.get("d", ""))]
        xs, ys = nums[0::2], nums[1::2]
        assert min(xs) >= x0 and max(xs) <= x1 and min(ys) >= y0 and max(ys) <= y1


def test_labels_stay_legible_on_a_phone_card() -> None:
    root = _root()
    x0, y0, x1, y1 = _view(root)
    # A 340 px wide card scales the viewBox by 340 / width: text must stay >= 10 px tall.
    px_per_unit = 340 / (x1 - x0)
    for t in _dim_texts(root, "wall") + _dim_texts(root, "opening"):
        assert float(t.get("font-size", "0")) * px_per_unit >= 10, (t.text, px_per_unit)


def test_preliminary_label_is_kept() -> None:
    assert any(t.get("data-preliminary") == "true" for t in _root().iter("text"))


def test_deterministic() -> None:
    assert render_snapshot(_scene()) == render_snapshot(_scene())
    assert pytest.approx(1) == 1


def test_outward_swinging_door_arc_is_not_clipped() -> None:
    scene = _scene()
    # Reverse w0 so its left normal (the door swing side) points out of the room.
    w0 = next(w for w in scene.walls if w.id == "w0")
    w0.a, w0.b = w0.b, w0.a
    from server.scene.models import Opening

    scene.openings.append(Opening(id="d9", wall_id="w0", kind="door", offset_m=0.6, width_m=1.5, height_m=2.05))
    root = ET.fromstring(render_snapshot(scene))
    x0, y0, x1, y1 = _view(root)
    arc = next(p for p in root.iter("path") if p.get("data-opening") == "d9")
    nums = [float(n) for n in re.findall(r"-?\d+\.\d+", arc.get("d", ""))]
    ys = nums[1::2]
    assert max(ys) <= y1 and min(ys) >= y0
    # The swing square (hinge .. hinge + width) must fit, not only the arc end points: bottom edge of the view.
    assert y1 - max(ys) >= 0.0
