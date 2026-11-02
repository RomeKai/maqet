"""DXF professional notes: readable text, one line per condition (matches the app banner)."""

from __future__ import annotations

from server.export.dxf import PROFESSIONAL_PREFIX, export_dxf
from server.export.flag_text import flag_notes
from server.scene.models import Scene, Wall
from server.scene.validation import validate_scene


def _room_3x8() -> Scene:
    walls = [
        Wall(id="w1", a=(0.0, 0.0), b=(8.0, 0.0), thickness_m=0.20, kind="exterior"),
        Wall(id="w2", a=(8.0, 0.0), b=(8.0, 3.0), thickness_m=0.20, kind="exterior"),
        Wall(id="w3", a=(8.0, 3.0), b=(0.0, 3.0), thickness_m=0.20, kind="exterior"),
        Wall(id="w4", a=(0.0, 3.0), b=(0.0, 0.0), thickness_m=0.20, kind="exterior"),
    ]
    return Scene(id="s", scale_confirmed=True, walls=walls)


def test_span_flags_collapse_to_one_readable_line_listing_the_walls() -> None:
    notes = flag_notes(["needs_professional:span_over_limit:w1", "needs_professional:span_over_limit:w3"])
    assert notes == ["span over the limit (walls 1, 3)"]


def test_other_codes_have_plain_text() -> None:
    assert flag_notes(["needs_professional:second_floor", "needs_professional:unknown_soil"]) == [
        "second floor",
        "foundations on unknown soil",
    ]


def test_unknown_code_never_leaks_raw_text() -> None:
    (note,) = flag_notes(["needs_professional:something_new"])
    assert ":" not in note and "_" not in note


def test_dxf_has_one_line_per_condition_and_no_raw_codes() -> None:
    scene = _room_3x8()
    flags = validate_scene(scene).flags
    assert len(flags) == 2  # w1 and w3, one per wall
    doc = export_dxf(scene)
    texts = [e.dxf.text for e in doc.modelspace() if e.dxftype() == "TEXT"]
    lines = [t for t in texts if t.startswith(PROFESSIONAL_PREFIX)]
    assert lines == [f"{PROFESSIONAL_PREFIX}span over the limit (walls 1, 3)"]
    assert not any("needs_professional" in t or "span_over_limit" in t for t in texts)
