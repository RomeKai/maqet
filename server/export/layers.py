"""AIA layer table for DXF export.

Single source of layer name / AutoCAD ACI color / linetype. Layers are
created up front from this table; nothing else in the codebase may invent
layer names. The one derived family is ``<name>-L<level>`` for rooms on
upper floors (level_layer), created only when such a room exists.
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
    LayerDef("A-WALL-EXST", 7, "Continuous"),
    LayerDef("A-WALL-NEWW", 3, "Continuous"),
    LayerDef("A-WALL-DEMO", 1, "Dashed"),
    LayerDef("A-DOOR", 2, "Continuous"),
    LayerDef("A-GLAZ", 4, "Continuous"),
    LayerDef("A-FLOR-FURN", 6, "Continuous"),
    LayerDef("A-ANNO-TEXT", 3, "Continuous"),
    LayerDef("A-ANNO-DIMS", 1, "Continuous"),
    LayerDef("A-AREA", 8, "Dashed"),
)

LAYER_NAMES: frozenset[str] = frozenset(layer.name for layer in LAYERS)


_LAYERS_BY_NAME = {layer.name: layer for layer in LAYERS}


def level_layer(doc: ezdxf.document.Drawing, name: str, level: int) -> str:
    """Layer for an entity on floor ``level``: the base layer on the ground
    floor, else ``<name>-L<level>`` (created on first use with the base
    layer's color and linetype) so upper floors never clutter the ground plan."""
    if level <= 1:
        return name
    base = _LAYERS_BY_NAME[name]
    upper = f"{name}-L{level}"
    if upper not in doc.layers:
        doc.layers.add(upper, color=base.color, linetype=base.linetype)
    return upper


def ensure_layers(doc: ezdxf.document.Drawing) -> None:
    """Create every LAYERS entry up front (idempotent)."""
    for layer in LAYERS:
        if layer.name not in doc.layers:
            doc.layers.add(layer.name, color=layer.color, linetype=layer.linetype)
