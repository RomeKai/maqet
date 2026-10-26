"""DXF export tests, Day 1 (walls). Offline, no Meta calls.

Gate checks: audit clean, reopen + per-layer counts, bbox vs site, golden
shapely geometry (never file bytes). Full openings land on Day 5.
"""

from __future__ import annotations

from pathlib import Path

import ezdxf
import pytest
from ezdxf import bbox as ezdxf_bbox
from shapely.geometry import LineString, Polygon

from server.export.dxf import (
    PRELIMINARY_NOTE,
    PROFESSIONAL_PREFIX,
    ScaleNotConfirmedError,
    export_dxf,
    save_dxf,
    scene_bbox,
)
from server.scene.models import Scene, Wall

TRUTH = (
    Path(__file__).resolve().parents[2]
    / "samples"
    / "plans"
    / "croquis_ampliacion.truth.json"
)

TOL = 1e-6


@pytest.fixture(scope="module")
def scene() -> Scene:
    return Scene.model_validate_json(TRUTH.read_text(encoding="utf-8"))


def test_export_blocked_without_scale_confirmed() -> None:
    unconfirmed = Scene(id="s", scale_confirmed=False)
    with pytest.raises(ScaleNotConfirmedError):
        export_dxf(unconfirmed)


def test_units_are_meters(scene: Scene) -> None:
    assert export_dxf(scene).units == ezdxf.units.M


def test_audit_has_no_errors(scene: Scene, tmp_path: Path) -> None:
    out = save_dxf(scene, tmp_path / "plan.dxf")
    auditor = ezdxf.readfile(str(out)).audit()
    assert auditor.errors == []


def test_reopen_layer_counts_match_scene(scene: Scene, tmp_path: Path) -> None:
    out = save_dxf(scene, tmp_path / "plan.dxf")
    msp = ezdxf.readfile(str(out)).modelspace()

    def on(layer: str, kind: str) -> list:
        return [
            e for e in msp if e.dxftype() == kind and e.dxf.layer == layer
        ]

    assert len(on("A-WALL", "LWPOLYLINE")) == len(scene.walls)
    assert len(on("A-AREA", "LWPOLYLINE")) == len(scene.rooms)
    assert len(on("A-AREA", "TEXT")) == len(scene.rooms)
    notes = [e.dxf.text for e in on("A-ANNO-TEXT", "TEXT")]
    assert len(notes) >= 5  # project, date, units, scale, preliminary
    assert PRELIMINARY_NOTE in notes


def test_bbox_matches_site(scene: Scene, tmp_path: Path) -> None:
    out = save_dxf(scene, tmp_path / "plan.dxf")
    msp = ezdxf.readfile(str(out)).modelspace()
    geometry = [
        e
        for e in msp
        if e.dxftype() == "LWPOLYLINE" and e.dxf.layer in ("A-WALL", "A-AREA")
    ]
    ext = ezdxf_bbox.extents(geometry)
    min_x, min_y, max_x, max_y = scene_bbox(scene)
    assert ext.extmin.x == pytest.approx(min_x, abs=TOL)
    assert ext.extmin.y == pytest.approx(min_y, abs=TOL)
    assert ext.extmax.x == pytest.approx(max_x, abs=TOL)
    assert ext.extmax.y == pytest.approx(max_y, abs=TOL)


def test_golden_wall_geometry_matches_shapely(scene: Scene, tmp_path: Path) -> None:
    out = save_dxf(scene, tmp_path / "plan.dxf")
    msp = ezdxf.readfile(str(out)).modelspace()
    exported = [
        Polygon([(p[0], p[1]) for p in e.get_points("xy")])
        for e in msp
        if e.dxftype() == "LWPOLYLINE" and e.dxf.layer == "A-WALL"
    ]
    assert len(exported) == len(scene.walls)
    for wall, poly in zip(scene.walls, exported):
        expected = LineString([tuple(wall.a), tuple(wall.b)]).buffer(
            wall.thickness_m / 2.0, cap_style="flat"
        )
        assert expected.symmetric_difference(poly).area == pytest.approx(0.0, abs=1e-9)


def test_golden_room_geometry_matches_shapely(scene: Scene, tmp_path: Path) -> None:
    out = save_dxf(scene, tmp_path / "plan.dxf")
    msp = ezdxf.readfile(str(out)).modelspace()
    exported = [
        Polygon([(p[0], p[1]) for p in e.get_points("xy")])
        for e in msp
        if e.dxftype() == "LWPOLYLINE" and e.dxf.layer == "A-AREA"
    ]
    assert len(exported) == len(scene.rooms)
    for room, poly in zip(scene.rooms, exported):
        expected = Polygon([tuple(p) for p in room.polygon])
        assert expected.symmetric_difference(poly).area == pytest.approx(0.0, abs=1e-9)


def test_title_block_lists_professional_flags() -> None:
    long_wall = Scene(
        id="s",
        scale_confirmed=True,
        walls=[
            Wall(id="w1", a=(0.0, 0.0), b=(5.0, 0.0), thickness_m=0.20, kind="exterior")
        ],
    )
    texts = [
        e.dxf.text
        for e in export_dxf(long_wall).modelspace()
        if e.dxftype() == "TEXT"
    ]
    assert PRELIMINARY_NOTE in texts
    assert any(t.startswith(PROFESSIONAL_PREFIX) for t in texts)


def test_self_intersecting_room_polygon_raises() -> None:
    from server.scene.models import Room

    bowtie = Scene(
        id="s",
        scale_confirmed=True,
        rooms=[
            Room(
                id="r1",
                name="X",
                # Two lobes sharing one vertex: repairs to a MultiPolygon,
                # which has no single exterior ring to export.
                polygon=[
                    (0.0, 0.0),
                    (1.0, 0.0),
                    (1.0, 1.0),
                    (2.0, 1.0),
                    (2.0, 2.0),
                    (1.0, 2.0),
                    (1.0, 1.0),
                    (0.0, 1.0),
                ],
            )
        ],
    )
    with pytest.raises(ValueError, match="r1"):
        export_dxf(bowtie)
