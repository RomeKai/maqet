"""Intake never answers 200 while silently ignoring the human's input or
producing an empty Scene.

- The sample path used to drop `anchor_index`, so a human anchor correction
  (or an out-of-range one) came back 200 with the automatic anchor.
- A zero-meter anchor ("0,00") scaled every wall to a point and returned an
  empty Scene instead of asking the human for a real measure.
Offline, no Meta calls (sample replay only).
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from server.api import app
from server.intake.cleanup import ScaleError, select_anchor
from server.intake.schemas import IntakeProposal

FIXTURE = "croquis_nonproportional"
FIXTURE_PATH = (
    Path(__file__).resolve().parents[2] / "samples" / "plans" / f"{FIXTURE}.proposal.json"
)
client = TestClient(app)


def _proposal(**dim_override: str) -> IntakeProposal:
    raw = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))["proposal"]
    raw["dimensions"] = [{**d, **dim_override} for d in raw["dimensions"]]
    return IntakeProposal.model_validate(raw)


def test_sample_path_honours_anchor_index() -> None:
    res = client.post("/intake", data={"kind": "sketch", "sample": FIXTURE, "anchor_index": "1"})
    assert res.status_code == 200, res.text
    assert res.json()["anchor_index"] == 1
    assert res.json()["anchor_meters"] == pytest.approx(2.0)


def test_sample_path_rejects_out_of_range_anchor_index() -> None:
    res = client.post("/intake", data={"kind": "sketch", "sample": FIXTURE, "anchor_index": "99"})
    assert res.status_code == 400
    assert "anchor_index" in res.json()["detail"]


def test_zero_meter_explicit_anchor_asks_the_human() -> None:
    with pytest.raises(ScaleError):
        select_anchor(_proposal(text="0,00").dimensions, anchor_index=0)


def test_zero_meter_dimensions_are_never_picked_automatically() -> None:
    proposal = _proposal()
    dims = [proposal.dimensions[0].model_copy(update={"text": "0,00 total"}), *proposal.dimensions[1:]]
    index, meters = select_anchor(dims)
    assert index != 0
    assert meters > 0


def test_all_zero_dimensions_raise_scale_error() -> None:
    with pytest.raises(ScaleError):
        select_anchor(_proposal(text="0").dimensions)
