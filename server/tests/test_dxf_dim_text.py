"""The number a builder reads off a DXF dimension is the wall length in
meters, and an estimated wall says so.

ezdxf's default "EZDXF" dimstyle (doc setup) displays 1 drawing unit = 1 m
as centimeters (dimlfac=100), so a 3.456 m wall used to read "345.6" under
a title block that says "Units: meters". Offline, no Meta calls.
"""

from __future__ import annotations

import ezdxf

from server.export.dxf import export_dxf
from server.scene.models import Scene, Wall


def _dim_texts(doc: ezdxf.document.Drawing) -> dict[str, str]:
    """Rendered text of each wall's DIMENSION, keyed by wall length."""
    out: dict[str, str] = {}
    for dim in doc.modelspace().query("DIMENSION"):
        block = doc.blocks.get(dim.dxf.geometry)
        texts = [e.text for e in block if e.dxftype() == "MTEXT"]
        texts += [e.dxf.text for e in block if e.dxftype() == "TEXT"]
        assert len(texts) == 1, texts
        out[f"{dim.get_measurement():.3f}"] = texts[0]
    return out


def _scene() -> Scene:
    return Scene(
        id="dims",
        scale_confirmed=True,
        walls=[
            Wall(
                id="w1", a=(0.0, 0.0), b=(3.456, 0.0), thickness_m=0.2, kind="exterior",
                provenance="measured_tape", measured_length_m=3.456,
            ),
            Wall(id="w2", a=(0.0, 2.0), b=(2.0, 2.0), thickness_m=0.1, kind="interior"),
        ],
    )


def test_measured_wall_dimension_reads_in_meters() -> None:
    assert _dim_texts(export_dxf(_scene()))["3.456"] == "3.46 m"


def test_estimated_wall_dimension_is_labelled_estimated() -> None:
    assert _dim_texts(export_dxf(_scene()))["2.000"] == "2.00 m (estimated)"
