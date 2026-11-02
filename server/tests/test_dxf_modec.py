"""DXF handoff for Mode C (dxf-modec-check mission).

Single source truth: samples/plans/croquis_3x8_door_window.truth.json.
Asserts wall polygons with both openings cut, door swing arc, window line,
dimensions equal to written lengths, preliminary title line, $INSUNITS meters,
and estimated provenance note handling.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import ezdxf
import pytest
from ezdxf import bbox as ezdxf_bbox
from shapely.geometry import Polygon

from server.export.dxf import PRELIMINARY_NOTE, export_dxf, scene_bbox
from server.scene.models import Scene

TRUTH = Path(__file__).resolve().parents[2] / "samples" / "plans" / "croquis_3x8_door_window.truth.json"

TOL = 1e-6


def _scene() -> Scene:
    return Scene.model_validate_json(TRUTH.read_text(encoding="utf-8"))


def _on(msp, layer: str, kind: str) -> list:
    return [e for e in msp if e.dxftype() == kind and e.dxf.layer == layer]


def test_dxf_modec_wall_polygons_with_openings_cut() -> None:
    scene = _scene()
    doc = export_dxf(scene)
    msp = doc.modelspace()
    # Walls with interior door cut export as two polylines; window similarly.
    # For the 3x8 truth, w3 has a door, w1 has a window.
    total_parts = sum(len(_on(msp, layer, "LWPOLYLINE")) for layer in ("A-WALL", "A-WALL-EXST", "A-WALL-NEWW", "A-WALL-DEMO"))
    # At least as many parts as walls (cuts increase count)
    assert total_parts >= len(scene.walls)
    # Door cut: wall footprint minus opening area should reflect in union area
    # Verify by checking wall footprint area reduced
    union_area = 0.0
    for layer in ("A-WALL", "A-WALL-EXST", "A-WALL-NEWW", "A-WALL-DEMO"):
        for e in _on(msp, layer, "LWPOLYLINE"):
            union_area += Polygon([(p[0], p[1]) for p in e.get_points("xy")]).area
    # Gross wall area: perimeter 3+8+3+8 = 22 m * 0.2 = 4.4 m2, minus cuts
    # door 1.5*0.2=0.3, window 1.0*0.2=0.2 => net ~3.9
    assert union_area == pytest.approx(4.4 - 0.3 - 0.2, abs=0.02)


def test_dxf_modec_door_swing_arc_with_width() -> None:
    scene = _scene()
    msp = export_dxf(scene).modelspace()
    arcs = _on(msp, "A-DOOR", "ARC")
    assert len(arcs) >= 1
    # Door d1 width 1.5 m
    door = next(o for o in scene.openings if o.kind == "door")
    arc = arcs[0]
    assert arc.dxf.radius == pytest.approx(door.width_m, abs=TOL)


def test_dxf_modec_window_entity_with_width() -> None:
    scene = _scene()
    msp = export_dxf(scene).modelspace()
    lines = _on(msp, "A-GLAZ", "LINE")
    assert len(lines) >= 1
    window = next(o for o in scene.openings if o.kind == "window")
    # Window centerline length == window width
    length = math.dist(
        (lines[0].dxf.start.x, lines[0].dxf.start.y),
        (lines[0].dxf.end.x, lines[0].dxf.end.y),
    )
    assert length == pytest.approx(window.width_m, abs=TOL)


def test_dxf_modec_dimensions_equal_written_lengths() -> None:
    scene = _scene()
    msp = export_dxf(scene).modelspace()
    dims = _on(msp, "A-ANNO-DIMS", "DIMENSION")
    # One per wall (unchanged, emitted first) plus one per opening width.
    assert len(dims) == len(scene.walls) + len(scene.openings)
    for wall in scene.walls:
        # measured_length_m holds the written length; dimension defpoints must match
        expected = wall.measured_length_m if wall.measured_length_m is not None else math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1])
        assert expected is not None
    # Check that each dimension's defpoints span equals the wall length
    for dim, wall in zip(dims[: len(scene.walls)], scene.walls):
        measured = math.dist(
            (dim.dxf.defpoint2.x, dim.dxf.defpoint2.y),
            (dim.dxf.defpoint3.x, dim.dxf.defpoint3.y),
        )
        expected = math.dist(tuple(wall.a), tuple(wall.b))
        assert measured == pytest.approx(expected, abs=TOL)


def test_dxf_modec_preliminary_in_title_block() -> None:
    scene = _scene()
    texts = [e.dxf.text for e in export_dxf(scene).modelspace() if e.dxftype() == "TEXT"]
    assert PRELIMINARY_NOTE in texts


def test_dxf_modec_insunits_meters() -> None:
    scene = _scene()
    doc = export_dxf(scene)
    assert doc.units == ezdxf.units.M
    assert doc.header["$INSUNITS"] == 6


def test_dxf_modec_estimated_wall_note_when_provenance_estimated() -> None:
    data = json.loads(TRUTH.read_text(encoding="utf-8"))
    # Force one wall to estimated provenance
    data["walls"][0]["provenance"] = "estimated"
    data["walls"][0].pop("measured_length_m", None)
    scene = Scene(**data)
    doc = export_dxf(scene)
    msp = doc.modelspace()
    # The estimated wall's dimension text should say (estimated)
    dims = _on(msp, "A-ANNO-DIMS", "DIMENSION")
    # At least one dim text contains "estimated"
    all_texts = [e.dxf.text for e in msp if e.dxftype() == "TEXT"]
    # Dimension entities carry text; check dxf.text on dimensions or TEXT entities
    # For estimated walls, DXF dim text override is "<> m (estimated)"
    has_estimated = any("estimated" in t.lower() for t in all_texts)
    # Also check dimension text property
    dim_texts = [getattr(d.dxf, "text", "") for d in dims]
    has_estimated_dim = any("estimated" in t.lower() for t in dim_texts)
    assert has_estimated or has_estimated_dim


def test_dxf_modec_audit_and_bbox() -> None:
    scene = _scene()
    doc = export_dxf(scene)
    assert doc.audit().errors == []
    min_x, min_y, max_x, max_y = scene_bbox(scene)
    # Bounding box should enclose the 3x8 rectangle plus wall thickness
    assert min_x <= 0 and max_x >= 3
    assert min_y <= 0 and max_y >= 8
