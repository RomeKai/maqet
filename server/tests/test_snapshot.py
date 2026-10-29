"""Top-view SVG snapshot tests (Day 3). Offline, hand-built Scene fixtures."""

from __future__ import annotations

import math
import xml.etree.ElementTree as ET

import pytest

from server.render.snapshot import SUPPORTED_LOCALES, render_snapshot
from server.scene.models import Furniture, Opening, Room, Scene, Wall


def make_scene() -> Scene:
    return Scene(
        id="snap",
        walls=[
            Wall(id="w1", a=(0.0, 0.0), b=(5.0, 0.0), thickness_m=0.2, kind="exterior"),
            Wall(id="w2", a=(5.0, 0.0), b=(5.0, 4.0), thickness_m=0.1, kind="interior"),
        ],
        openings=[
            Opening(id="o_d", wall_id="w1", kind="door",
                    offset_m=2.0, width_m=1.0, height_m=2.0),
            Opening(id="o_w", wall_id="w2", kind="window",
                    offset_m=1.0, width_m=1.2, height_m=1.2, sill_m=0.9),
            Opening(id="o_ghost", wall_id="nope", kind="door",
                    offset_m=0.0, width_m=1.0, height_m=2.0),
        ],
        rooms=[
            Room(id="r1", name="Living & Kitchen",
                 polygon=[(0.0, 0.0), (5.0, 0.0), (5.0, 4.0), (0.0, 4.0)]),
            Room(id="r2", name="Bath",
                 polygon=[(5.0, 0.0), (8.0, 0.0), (8.0, 3.0), (5.0, 3.0)]),
        ],
        furniture=[
            Furniture(id="f1", room_id="r1", position=(2.0, 2.0),
                      rotation_deg=0.0, size_m=(2.0, 1.0, 0.5)),
            Furniture(id="f2", room_id="r2", position=(6.5, 1.5),
                      rotation_deg=90.0, size_m=(1.6, 0.8, 0.45), concept=True),
        ],
    )


def wall_polys(root: ET.Element, wall_id: str) -> list[ET.Element]:
    return [p for p in root.findall(".//polygon") if p.get("data-wall") == wall_id]


def test_deterministic_byte_identical() -> None:
    scene = make_scene()
    assert render_snapshot(scene) == render_snapshot(scene)


def test_valid_xml() -> None:
    root = ET.fromstring(render_snapshot(make_scene()))
    assert root.tag == "svg"


def test_every_room_label_present() -> None:
    svg = render_snapshot(make_scene())
    assert "Living &amp; Kitchen" in svg  # escaped in markup...
    root = ET.fromstring(svg)
    texts = [t.text or "" for t in root.findall(".//text")]
    assert "Living & Kitchen" in texts  # ...parsed back exactly
    assert "20.0 m²" in texts
    assert "Bath" in texts
    assert "9.0 m²" in texts


def test_scale_bar_matches_meters() -> None:
    root = ET.fromstring(render_snapshot(make_scene()))
    px_per_m = float(root.get("data-px-per-m", "0"))
    assert px_per_m == 100
    bars = root.findall(".//g[@data-meters]")
    assert len(bars) == 1
    meters = float(bars[0].get("data-meters", "0"))
    rect = bars[0].find("rect")
    assert rect is not None
    assert float(rect.get("width", "0")) == pytest.approx(meters)
    assert float(rect.get("width", "0")) * px_per_m == pytest.approx(meters * 100)
    label = bars[0].find("text")
    assert label is not None and label.text == f"{meters:g} m"


def _xs(polys: list[ET.Element]) -> list[float]:
    out = []
    for p in polys:
        for pair in (p.get("points") or "").split():
            out.append(float(pair.split(",")[0]))
    return out


def test_openings_produce_gaps() -> None:
    root = ET.fromstring(render_snapshot(make_scene()))
    # Door at offset 2..3 on a 5 m wall -> two solid segments, nothing inside.
    segs = wall_polys(root, "w1")
    assert len(segs) == 2
    assert all(x <= 2.001 or x >= 2.999 for x in _xs(segs))
    # Door swing: quarter-circle arc path + leaf line.
    assert root.findall('.//path[@data-opening="o_d"]') != []
    leaf = root.findall('.//line[@data-opening="o_d"]')
    assert len(leaf) == 1
    dx = float(leaf[0].get("x2", "0")) - float(leaf[0].get("x1", "0"))
    dy = float(leaf[0].get("y2", "0")) - float(leaf[0].get("y1", "0"))
    assert math.hypot(dx, dy) == pytest.approx(1.0)
    # Window at offset 1..2.2 -> gap + two parallel lines across it.
    assert len(wall_polys(root, "w2")) == 2
    wlines = root.findall('.//line[@data-opening="o_w"]')
    assert len(wlines) == 2
    dirs = []
    for ln in wlines:
        dirs.append((
            float(ln.get("x2", "0")) - float(ln.get("x1", "0")),
            float(ln.get("y2", "0")) - float(ln.get("y1", "0")),
        ))
    assert all(math.hypot(*d) > 0 for d in dirs)
    cross = dirs[0][0] * dirs[1][1] - dirs[0][1] * dirs[1][0]
    assert cross == pytest.approx(0.0, abs=1e-6)


def test_unknown_wall_opening_ignored() -> None:
    root = ET.fromstring(render_snapshot(make_scene()))
    assert root.findall('.//*[@data-opening="o_ghost"]') == []


def test_opening_past_wall_end_clamped_away() -> None:
    scene = Scene(
        id="clamp",
        walls=[Wall(id="w", a=(0.0, 0.0), b=(5.0, 0.0),
                    thickness_m=0.2, kind="interior")],
        openings=[Opening(id="o_far", wall_id="w", kind="door",
                          offset_m=10.0, width_m=1.0, height_m=2.0)],
    )
    root = ET.fromstring(render_snapshot(scene))
    assert len(wall_polys(root, "w")) == 1
    assert root.findall('.//*[@data-opening="o_far"]') == []


def test_locale_es_ar() -> None:
    svg = render_snapshot(make_scene(), locale="es-AR")
    assert "Preliminar" in svg
    assert "Preliminary" not in svg
    assert "20,0 m²" in svg


def test_locale_en_default() -> None:
    assert "en" in SUPPORTED_LOCALES and "es-AR" in SUPPORTED_LOCALES
    svg = render_snapshot(make_scene())
    assert "Preliminary" in svg
    assert "20.0 m²" in svg


def test_locale_invalid_raises() -> None:
    with pytest.raises(ValueError):
        render_snapshot(make_scene(), locale="fr")


def test_empty_scene() -> None:
    root = ET.fromstring(render_snapshot(Scene(id="empty")))
    assert root.tag == "svg"
    assert root.get("viewBox") == "0 0 100 100"
    prelim = [t for t in root.findall(".//text") if t.get("data-preliminary")]
    assert len(prelim) == 1 and (prelim[0].text or "") == "Preliminary"
    assert root.findall(".//polygon") == []
