"""Readable names for rooms and furniture.

Internal ids (``room-1``, ``f6``, ``bed-double-140x190``) never belong in text
a person reads. Exports and messages call these helpers instead.
"""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path

from server.scene.models import Furniture

CATALOG_PATH = Path(__file__).resolve().parents[2] / "assets" / "catalog.json"

_ROOM_WORD = {"en": "Room", "es-AR": "Ambiente"}
_FURNITURE_WORD = {"en": "Furniture", "es-AR": "Mueble"}
_CONCEPT_WORD = {"en": "Concept piece", "es-AR": "Pieza conceptual"}
_ROOM_ID = re.compile(r"^(?:room[-_ ]?|r)(\d+)$", re.IGNORECASE)


@lru_cache(maxsize=1)
def _catalog_names() -> dict[str, dict[str, str]]:
    data = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    return {
        f["id"]: {"en": f["name"], "es-AR": f.get("name_es_AR") or f["name"]}
        for f in data["furniture"]
    }


def room_display_name(name: str, locale: str = "en") -> str:
    """A user-given name stays; an internal id such as ``room-1`` becomes "Room 1"."""
    match = _ROOM_ID.match(name.strip())
    if match is None:
        return name
    return f"{_ROOM_WORD.get(locale, _ROOM_WORD['en'])} {match.group(1)}"


def furniture_display_name(item: Furniture, locale: str = "en") -> str:
    """Catalog name in the locale; concept and unknown pieces get a generic word, never the id."""
    names = _catalog_names().get(item.catalog_id or "")
    if names is not None:
        name = names.get(locale, names["en"])
        return f"{name} (concept)" if item.concept else name
    words = _CONCEPT_WORD if item.concept or item.concept_id else _FURNITURE_WORD
    return words.get(locale, words["en"])
