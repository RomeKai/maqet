"""Readable text for professional-required flags in exports.

Server flags look like "needs_professional:span_over_limit:w1" (code plus an
optional wall id). Exports show one plain line per condition, the same
grouping the app banner uses, with the affected walls listed once.
"""

from __future__ import annotations

import re
from collections.abc import Sequence

CODE_TEXT = {
    "needs_professional:second_floor": "second floor",
    "needs_professional:load_bearing_wall": "load-bearing wall",
    "needs_professional:span_over_limit": "span over the limit",
    "needs_professional:unknown_soil": "foundations on unknown soil",
}
GENERIC_TEXT = "structural work"
_WALL_ID = re.compile(r"^w(\d+)$")


def _stable_code(flag: str) -> tuple[str, str | None]:
    parts = flag.split(":", 2)
    code = ":".join(parts[:2])
    return code, parts[2] if len(parts) > 2 else None


def _wall_name(wall_id: str) -> str:
    match = _WALL_ID.match(wall_id)
    return match.group(1) if match else wall_id.replace("_", " ")


def flag_notes(flags: Sequence[str]) -> list[str]:
    """One readable phrase per condition, first-seen order, walls listed once."""
    order: list[str] = []
    walls: dict[str, list[str]] = {}
    for flag in flags:
        code, wall_id = _stable_code(flag)
        if code not in walls:
            walls[code] = []
            order.append(code)
        if wall_id is not None and _wall_name(wall_id) not in walls[code]:
            walls[code].append(_wall_name(wall_id))
    notes: list[str] = []
    for code in order:
        text = CODE_TEXT.get(code, GENERIC_TEXT)
        if walls[code]:
            text += f" (walls {', '.join(walls[code])})"
        notes.append(text)
    return notes
