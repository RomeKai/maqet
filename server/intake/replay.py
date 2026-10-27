"""Recorded sample replay (I16): offline intake without a vision call.

Sample fixtures live in ``samples/plans/<name>.proposal.json``::

    {"image": {"w": int, "h": int}, "proposal": {IntakeProposal}}

Replay runs the SAME ``build_scaled_plan -> to_scene`` path as uploads, so
warnings and ``scale_confirmed`` behave identically. Unknown names raise
``ReplayMiss`` (the API maps it to 409); malformed names raise ValueError
(400). Name allowlist (``^[A-Za-z0-9_-]+$``) makes path traversal impossible:
dots and slashes never match.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from server.intake.schemas import IntakeProposal

_SAMPLE_RE = re.compile(r"^[A-Za-z0-9_-]+$")
_SAMPLES_DIR = Path(__file__).resolve().parent.parent.parent / "samples" / "plans"


class ReplayMiss(ValueError):
    """Unknown sample name: the human can pick one of the recorded ones."""


def available_samples() -> list[str]:
    """Recorded fixture names (no vision, no cost)."""
    if not _SAMPLES_DIR.is_dir():
        return []
    suffix = ".proposal.json"
    return sorted(p.name[: -len(suffix)] for p in _SAMPLES_DIR.glob(f"*{suffix}"))


def load_sample(name: str) -> tuple[IntakeProposal, int, int]:
    """Load (proposal, image_w, image_h) for a recorded sample.

    Raises ValueError on malformed names, ReplayMiss when the name is
    well-formed but no fixture exists.
    """
    if not name or not _SAMPLE_RE.fullmatch(name):
        raise ValueError(
            f"invalid sample name {name!r}: use letters, numbers, '-' or '_' only"
        )
    path = _SAMPLES_DIR / f"{name}.proposal.json"
    if not path.is_file():
        known = ", ".join(available_samples()) or "none recorded"
        raise ReplayMiss(f"unknown sample {name!r}: pick one of: {known}")
    data = json.loads(path.read_text(encoding="utf-8"))
    proposal = IntakeProposal.model_validate(data["proposal"])
    image = data["image"]
    return proposal, int(image["w"]), int(image["h"])


__all__ = ["ReplayMiss", "available_samples", "load_sample"]
