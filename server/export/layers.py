"""AIA layer table for DXF export.

Single source of layer name / AutoCAD ACI color / linetype. Layers are
created up front from this table; nothing else in the codebase may invent
layer names.
"""

from __future__ import annotations

from dataclasses import dataclass

import ezdxf


@dataclass(frozen=True)
class LayerDef:
    """One DXF layer: AIA name, ACI color number, linetype name."""

    name: str
    color: int
    linetype: str


LAYERS: tuple[LayerDef, ...] = (
    LayerDef("A-WALL", 7, "Continuous"),
    LayerDef("A-DOOR", 2, "Continuous"),
    LayerDef("A-GLAZ", 4, "Continuous"),
    LayerDef("A-FLOR-FURN", 6, "Continuous"),
    LayerDef("A-ANNO-TEXT", 3, "Continuous"),
    LayerDef("A-ANNO-DIMS", 1, "Continuous"),
    LayerDef("A-AREA", 8, "Dashed"),
)

LAYER_NAMES: frozenset[str] = frozenset(layer.name for layer in LAYERS)


def ensure_layers(doc: ezdxf.document.Drawing) -> None:
    """Create every LAYERS entry up front (idempotent)."""
    for layer in LAYERS:
        if layer.name not in doc.layers:
            doc.layers.add(layer.name, color=layer.color, linetype=layer.linetype)
