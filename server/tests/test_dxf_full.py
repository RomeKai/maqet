"""DXF full export tests (Day 5): openings, furniture, areas, dims, title, status.

Offline, no Meta calls. Gate checks: audit clean, reopen + per-layer counts,
bbox vs site (incl. DEMO), golden shapely geometry (never file bytes).
"""

from __future__ import annotations

import math
from pathlib import Path

import ezdxf
import pytest
from ezdxf import bbox as ezdxf_bbox
from shapely.geometry import Polygon

from server.export.dxf import (
    PRELIMINARY_NOTE,
    PROFESSIONAL_PREFIX,
    flag_notes,
    ScaleNotConfirmedError,
    export_dxf,
    save_dxf,
)
from server.scene.models import Furniture, Opening, Room, Scene, Wall
from server.scene.validation import validate_scene

TOL = 1e-6


def _door_scene() -> Scene:
    return Scene(
        id="door",
        scale_confirmed=True,
        walls=[Wall(id="w1", a=(0.0, 0.0), b=(5.0, 0.0), thickness_m=0.2, kind="exterior")],
        openings=[
            Opening(id="d1", wall_id="w1", kind="door", offset_m=1.0, width_m=0.9, height_m=2.05)
        ],
    )


def _window_scene() -> Scene:
    return Scene(
        id="win",
        scale_confirmed=True,
        walls=[Wall(id="w1", a=(0.0, 0.0), b=(4.0, 0.0), thickness_m=0.2, kind="exterior")],
        openings=[
            Opening(
                id="v1",
                wall_id="w1",
                kind="window",
                offset_m=1.0,
                width_m=1.5,
                height_m=1.2,
                sill_m=1.0,
            )
        ],
    )


def _rich_scene() -> Scene:
    """Walls + room + furniture for the end-to-end gate test."""
    return Scene(
        id="rich",
        scale_confirmed=True,
        walls=[
            Wall(id="w1", a=(0.0, 0.0), b=(5.0, 0.0), thickness_m=0.2, kind="exterior"),
            Wall(id="w2", a=(5.0, 0.0), b=(5.0, 3.5), thickness_m=0.2, kind="exterior"),
        ],
        openings=[
            Opening(id="d1", wall_id="w1", kind="door", offset_m=1.0, width_m=0.9, height_m=2.05)
        ],
        rooms=[
            Room(
                id="r1",
                name="LIVING",
                polygon=[(0.0, 0.0), (5.0, 0.0), (5.0, 3.5), (0.0, 3.5)],
                function="living",
            )
        ],
        furniture=[
            Furniture(
                id="f1",
                catalog_id="table-01",
                room_id="r1",
                position=(2.0, 1.5),
                rotation_deg=0.0,
                size_m=(1.2, 0.8, 0.75),
            )
        ],
    )


def _status_pair() -> tuple[Scene, Scene]:
    """base {w1, w2} vs current {w1, w3}."""
    base = Scene(
        id="base",
        scale_confirmed=True,
        walls=[
            Wall(id="w1", a=(0.0, 0.0), b=(4.0, 0.0), thickness_m=0.2, kind="exterior"),
            Wall(id="w2", a=(0.0, 0.0), b=(0.0, 3.0), thickness_m=0.2, kind="exterior"),
        ],
    )
    current = Scene(
        id="current",
        scale_confirmed=True,
        walls=[
            Wall(id="w1", a=(0.0, 0.0), b=(4.0, 0.0), thickness_m=0.2, kind="exterior"),
            Wall(id="w3", a=(4.0, 0.0), b=(4.0, 3.0), thickness_m=0.2, kind="exterior"),
        ],
    )
    return base, current


def _on(msp, layer: str, kind: str) -> list:
    return [e for e in msp if e.dxftype() == kind and e.dxf.layer == layer]


def test_export_blocked_without_scale_confirmed_with_and_without_base() -> None:
    unconfirmed = Scene(id="s", scale_confirmed=False)
    base, _ = _status_pair()
    with pytest.raises(ScaleNotConfirmedError):
        export_dxf(unconfirmed)
    with pytest.raises(ScaleNotConfirmedError):
        export_dxf(unconfirmed, base_scene=base)


def test_units_are_meters_explicit_on_reopen(tmp_path: Path) -> None:
    out = save_dxf(_door_scene(), tmp_path / "units.dxf")
    reopened = ezdxf.readfile(str(out))
    assert reopened.units == ezdxf.units.M
    assert reopened.header["$INSUNITS"] == 6  # 6 = meters, explicit


def test_door_cut_and_swing_arc() -> None:
    msp = export_dxf(_door_scene()).modelspace()
    polys = [
        Polygon([(p[0], p[1]) for p in e.get_points("xy")])
        for e in _on(msp, "A-WALL", "LWPOLYLINE")
    ]
    union_area = sum(p.area for p in polys)
    assert union_area == pytest.approx(5.0 * 0.2 - 0.9 * 0.2, abs=1e-9)

    arcs = _on(msp, "A-DOOR", "ARC")
    assert len(arcs) == 1
    arc = arcs[0]
    assert (arc.dxf.center.x, arc.dxf.center.y) == pytest.approx((1.0, 0.0), abs=TOL)
    assert arc.dxf.radius == pytest.approx(0.9, abs=TOL)
    assert arc.dxf.start_angle == pytest.approx(0.0, abs=TOL)
    assert arc.dxf.end_angle == pytest.approx(90.0, abs=TOL)


def test_window_cut_and_centerline() -> None:
    msp = export_dxf(_window_scene()).modelspace()
    polys = [
        Polygon([(p[0], p[1]) for p in e.get_points("xy")])
        for e in _on(msp, "A-WALL", "LWPOLYLINE")
    ]
    union_area = sum(p.area for p in polys)
    assert union_area == pytest.approx(4.0 * 0.2 - 1.5 * 0.2, abs=1e-9)

    lines = _on(msp, "A-GLAZ", "LINE")
    assert len(lines) == 1
    assert (lines[0].dxf.start.x, lines[0].dxf.start.y) == pytest.approx((1.0, 0.0), abs=TOL)
    assert (lines[0].dxf.end.x, lines[0].dxf.end.y) == pytest.approx((2.5, 0.0), abs=TOL)


def test_furniture_footprints_and_labels() -> None:
    scene = Scene(
        id="f",
        scale_confirmed=True,
        walls=[Wall(id="w1", a=(0.0, 0.0), b=(6.0, 0.0), thickness_m=0.2, kind="exterior")],
        furniture=[
            Furniture(
                id="f1",
                catalog_id="table-01",
                room_id="r1",
                position=(1.0, 1.0),
                rotation_deg=0.0,
                size_m=(1.2, 0.8, 0.75),
            ),
            Furniture(
                id="f2",
                concept_id="lounge-concept",
                room_id="r1",
                position=(3.0, 3.0),
                rotation_deg=90.0,
                size_m=(2.0, 1.0, 0.5),
                concept=True,
            ),
        ],
    )
    msp = export_dxf(scene).modelspace()
    footprints = _on(msp, "A-FLOR-FURN", "LWPOLYLINE")
    assert len(footprints) == 2
    assert all(e.closed for e in footprints)
    areas = sorted(
        Polygon([(p[0], p[1]) for p in e.get_points("xy")]).area for e in footprints
    )
    assert areas == pytest.approx([0.96, 2.0], abs=1e-9)
    # 90-degree rotation swaps the 2.0 x 1.0 sides around (3, 3).
    rotated = max(
        (Polygon([(p[0], p[1]) for p in e.get_points("xy")]) for e in footprints),
        key=lambda p: p.bounds[2],
    )
    minx, miny, maxx, maxy = rotated.bounds
    assert (maxx - minx) == pytest.approx(1.0, abs=TOL)
    assert (maxy - miny) == pytest.approx(2.0, abs=TOL)

    labels = sorted(e.dxf.text for e in _on(msp, "A-ANNO-TEXT", "TEXT") if e.dxf.text in ("Concept piece", "Furniture"))
    assert labels == ["Concept piece", "Furniture"]


def test_room_name_and_area_texts() -> None:
    scene = Scene(
        id="r",
        scale_confirmed=True,
        walls=[Wall(id="w1", a=(0.0, 0.0), b=(4.0, 0.0), thickness_m=0.2, kind="exterior")],
        rooms=[
            Room(
                id="r1",
                name="LIVING",
                polygon=[(0.0, 0.0), (4.0, 0.0), (4.0, 3.0), (0.0, 3.0)],
            )
        ],
    )
    msp = export_dxf(scene).modelspace()
    names = [e.dxf.text for e in _on(msp, "A-AREA", "TEXT")]
    assert names == ["LIVING"]
    areas = _on(msp, "A-ANNO-TEXT", "TEXT")
    area_texts = [e for e in areas if e.dxf.text == "12.0 m2"]
    assert len(area_texts) == 1
    insert = area_texts[0].dxf.insert
    assert math.dist((insert.x, insert.y), (2.0, 1.5)) < 0.6


def test_one_dimension_per_wall_with_measured_length() -> None:
    scene = Scene(
        id="d",
        scale_confirmed=True,
        walls=[
            Wall(id="w1", a=(0.0, 0.0), b=(5.0, 0.0), thickness_m=0.2, kind="exterior"),
            Wall(id="w2", a=(0.0, 0.0), b=(0.0, 3.5), thickness_m=0.1, kind="interior"),
        ],
    )
    msp = export_dxf(scene).modelspace()
    dims = _on(msp, "A-ANNO-DIMS", "DIMENSION")
    assert len(dims) == len(scene.walls)
    for dim, wall in zip(dims, scene.walls):
        measured = math.dist(
            (dim.dxf.defpoint2.x, dim.dxf.defpoint2.y),
            (dim.dxf.defpoint3.x, dim.dxf.defpoint3.y),
        )
        expected = math.dist(tuple(wall.a), tuple(wall.b))
        assert measured == pytest.approx(expected, abs=TOL)


def test_title_block_contents() -> None:
    long_wall = Scene(
        id="s",
        scale_confirmed=True,
        walls=[
            Wall(id="w1", a=(0.0, 0.0), b=(5.0, 0.0), thickness_m=0.20, kind="exterior")
        ],
    )
    flags = validate_scene(long_wall).flags
    assert flags, "fixture must raise at least one professional flag"
    texts = [
        e.dxf.text
        for e in export_dxf(long_wall, project_name="Casa Test").modelspace()
        if e.dxftype() == "TEXT"
    ]
    assert "Project: Casa Test" in texts
    assert any("Scale 1:100" in t for t in texts)
    assert PRELIMINARY_NOTE in texts
    notes = flag_notes(flags)
    for note in notes:
        assert f"{PROFESSIONAL_PREFIX}{note}" in texts
    assert sum(t.startswith(PROFESSIONAL_PREFIX) for t in texts) == len(notes)


def test_status_layers_with_base_and_plain_wall_without() -> None:
    base, current = _status_pair()
    msp = export_dxf(current, base_scene=base).modelspace()

    def polys(layer: str) -> list[Polygon]:
        return [
            Polygon([(p[0], p[1]) for p in e.get_points("xy")])
            for e in _on(msp, layer, "LWPOLYLINE")
        ]

    assert len(polys("A-WALL-EXST")) == 1  # w1
    assert len(polys("A-WALL-NEWW")) == 1  # w3
    assert len(polys("A-WALL-DEMO")) == 1  # w2
    assert polys("A-WALL") == []
    minx, miny, maxx, maxy = polys("A-WALL-DEMO")[0].bounds
    assert (minx, miny, maxx, maxy) == pytest.approx((-0.1, 0.0, 0.1, 3.0), abs=TOL)

    doc = export_dxf(current, base_scene=base)
    assert doc.layers.get("A-WALL-DEMO").dxf.linetype == "Dashed"

    plain = export_dxf(current).modelspace()
    assert len(_on(plain, "A-WALL", "LWPOLYLINE")) == len(current.walls)
    assert _on(plain, "A-WALL-EXST", "LWPOLYLINE") == []
    assert _on(plain, "A-WALL-NEWW", "LWPOLYLINE") == []
    assert _on(plain, "A-WALL-DEMO", "LWPOLYLINE") == []


def _fingerprint(msp) -> list:
    fp = []
    for e in msp:
        kind = e.dxftype()
        if kind == "LWPOLYLINE":
            fp.append((kind, e.dxf.layer, tuple(e.get_points("xy"))))
        elif kind == "TEXT":
            fp.append((kind, e.dxf.layer, e.dxf.text, tuple(e.dxf.insert)))
        elif kind == "ARC":
            fp.append(
                (kind, e.dxf.layer, tuple(e.dxf.center), e.dxf.radius,
                 e.dxf.start_angle, e.dxf.end_angle)
            )
        elif kind == "LINE":
            fp.append((kind, e.dxf.layer, tuple(e.dxf.start), tuple(e.dxf.end)))
        elif kind == "DIMENSION":
            fp.append(
                (kind, e.dxf.layer, tuple(e.dxf.defpoint),
                 tuple(e.dxf.defpoint2), tuple(e.dxf.defpoint3))
            )
        else:  # pragma: no cover - unexpected entity kinds fail loudly
            raise AssertionError(f"unexpected entity {kind}")
    return fp


def test_audit_reopen_bbox_and_determinism(tmp_path: Path) -> None:
    base, current = _status_pair()
    scene = current.model_copy(update={"rooms": [], "furniture": []})
    out = save_dxf(scene, tmp_path / "full.dxf", base_scene=base)
    reopened = ezdxf.readfile(str(out))
    assert reopened.audit().errors == []
    msp = reopened.modelspace()

    def on(layer: str, kind: str) -> list:
        return [e for e in msp if e.dxftype() == kind and e.dxf.layer == layer]

    assert len(on("A-WALL-EXST", "LWPOLYLINE")) == 1
    assert len(on("A-WALL-NEWW", "LWPOLYLINE")) == 1
    assert len(on("A-WALL-DEMO", "LWPOLYLINE")) == 1
    assert len(on("A-ANNO-DIMS", "DIMENSION")) == len(scene.walls)

    geometry = [
        e
        for e in msp
        if e.dxftype() == "LWPOLYLINE"
        and e.dxf.layer in ("A-WALL-EXST", "A-WALL-NEWW", "A-WALL-DEMO", "A-AREA")
    ]
    ext = ezdxf_bbox.extents(geometry)
    # Union of current walls and the DEMO-only base wall w2.
    assert ext.extmin.x == pytest.approx(-0.1, abs=TOL)
    assert ext.extmin.y == pytest.approx(-0.1, abs=TOL)
    assert ext.extmax.x == pytest.approx(4.1, abs=TOL)
    assert ext.extmax.y == pytest.approx(3.0, abs=TOL)

    first = _fingerprint(export_dxf(scene, base_scene=base).modelspace())
    second = _fingerprint(export_dxf(scene, base_scene=base).modelspace())
    assert first == second

    rich = _rich_scene()
    rich_fp = _fingerprint(export_dxf(rich).modelspace())
    assert _fingerprint(export_dxf(rich).modelspace()) == rich_fp


# --- Regression: interior openings always split the wall (hardening) ----------


def test_interior_opening_splits_wall_into_two_parts() -> None:
    # Door 0.8..1.7 on a 3 m wall: 0.8 + 0.9 == 1.7000000000000002 left a
    # hairline bridge, so the wall exported as one polyline across the door.
    from server.export.dxf_walls import wall_shapes
    from server.scene.models import Opening, Wall

    wall = Wall(id="w", a=(0.0, 0.0), b=(3.0, 0.0), thickness_m=0.20, kind="exterior")
    door = Opening(id="d", wall_id="w", kind="door", offset_m=0.8, width_m=0.9, height_m=2.05)
    parts = wall_shapes(wall, (door,))
    assert len(parts) == 2
    assert sorted(round(p.area, 9) for p in parts) == [0.16, 0.26]


def test_furniture_symbols_on_furn_layer_with_real_pose_and_label_on_text_layer() -> None:
    scene = Scene(
        id="sym",
        scale_confirmed=True,
        walls=[Wall(id="w1", a=(0.0, 0.0), b=(6.0, 0.0), thickness_m=0.2, kind="exterior")],
        furniture=[
            Furniture(id="b1", catalog_id="bed-single-90x190", room_id="r1", position=(2.0, 2.0), rotation_deg=90.0, size_m=(0.9, 1.9, 0.55)),
            Furniture(id="t1", catalog_id="table-120x75", room_id="r1", position=(4.0, 2.0), rotation_deg=0.0, size_m=(1.2, 0.75, 0.75)),
            Furniture(id="s1", catalog_id="stove-60x60", room_id="r1", position=(5.0, 1.0), rotation_deg=0.0, size_m=(0.6, 0.6, 0.9)),
        ],
    )
    msp = export_dxf(scene).modelspace()
    assert len(_on(msp, "A-FLOR-FURN", "LWPOLYLINE")) == 3
    lines = _on(msp, "A-FLOR-FURN", "LINE")
    assert len(lines) == 5 + 16  # bed: pillow rect + line; table: four chair squares
    assert len(_on(msp, "A-FLOR-FURN", "CIRCLE")) == 4  # burner marks
    # bed rotated 90 degrees about (2, 2): its pillow line (local v = -d/2 + 0.45) turns into a vertical line
    pillow = [e for e in lines if abs(e.dxf.start.x - e.dxf.end.x) < 1e-9 and abs(e.dxf.start.x - 2.0) > 0.4]
    assert any(abs(abs(e.dxf.start.y - e.dxf.end.y) - 0.9) < 1e-9 for e in pillow)
    labels = {e.dxf.text for e in _on(msp, "A-ANNO-TEXT", "TEXT")}
    assert {"Single bed 90x190", "Table 120x75", "Cooker 60x60"} <= labels
    assert not _on(msp, "A-FLOR-FURN", "TEXT")
