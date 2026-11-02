"""Opening widths are dimensioned on A-ANNO-DIMS next to the wall dimensions (phone finding 7).

Wall dimensions already exist (one per wall); only openings are added here. Offline, no Meta calls.
"""

from __future__ import annotations

import json
from pathlib import Path

import ezdxf
import pytest

from server.export.dxf import export_dxf, save_dxf
from server.scene.models import Scene

PLANS = Path(__file__).resolve().parents[2] / "samples" / "plans"


def _scene() -> Scene:
    return Scene(**json.loads((PLANS / "croquis_3x8_door_window.truth.json").read_text(encoding="utf-8")))


def _dims(doc: ezdxf.document.Drawing) -> list[tuple[float, str]]:
    out = []
    for dim in doc.modelspace().query("DIMENSION[layer=='A-ANNO-DIMS']"):
        block = doc.blocks.get(dim.dxf.geometry)
        texts = [e.text for e in block if e.dxftype() == "MTEXT"] + [e.dxf.text for e in block if e.dxftype() == "TEXT"]
        out.append((round(dim.get_measurement(), 3), texts[0]))
    return out


def test_walls_keep_their_dimensions_and_openings_add_their_widths() -> None:
    dims = _dims(export_dxf(_scene()))
    walls = sorted(d for d in dims if d[0] in (3.0, 8.0))
    assert [m for m, _ in walls] == [3.0, 3.0, 8.0, 8.0]  # not redone, not duplicated
    openings = sorted(d for d in dims if d[0] not in (3.0, 8.0))
    assert [m for m, _ in openings] == [1.0, 1.5]
    assert all(text == f"{m:.2f} m" for m, text in openings)


def test_opening_dimensions_survive_audit_and_reopen(tmp_path: Path) -> None:
    out = save_dxf(_scene(), tmp_path / "o.dxf")
    reopened = ezdxf.readfile(str(out))
    assert reopened.audit().errors == []
    assert sorted(m for m, _ in _dims(reopened)) == [1.0, 1.5, 3.0, 3.0, 8.0, 8.0]
    layers = {d.dxf.layer for d in reopened.modelspace().query("DIMENSION")}
    assert layers == {"A-ANNO-DIMS"}


def test_opening_dimension_sits_on_the_opening_not_beside_the_wall_dimension() -> None:
    doc = export_dxf(_scene())
    door = next(d for d in doc.modelspace().query("DIMENSION") if round(d.get_measurement(), 3) == 1.5)
    # The door is on w3 (a=(0,8) -> b=(0,0)), offset 3.68 m from a: it spans y = 4.32 down to 2.82 at x = 0.
    ys = sorted((door.dxf.defpoint2.y, door.dxf.defpoint3.y))
    assert ys == pytest.approx([2.82, 4.32], abs=0.01)
    assert door.dxf.defpoint2.x == pytest.approx(0.0, abs=0.01)
