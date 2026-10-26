"""Intake e2e in replay (day 2 gate): fixture -> validated proposal -> cleanup.

Covers a clean drawn plan AND a hand-drawn sketch (croquis): the proposal
is validated (verbatim dimensions, never invented), scaled from ONE read
measurement (auto anchor, no explicit index), turned into a Scene with
scale_confirmed=False, then confirmed by the human (ADR-002), which unblocks
DXF export. Offline: no network, no samples/replay reads.
"""

from __future__ import annotations

import io

import pytest
from PIL import Image

from server.intake.cleanup import build_scaled_plan, to_scene
from server.intake.schemas import IntakeProposal


def _make_image_bytes(width: int, height: int) -> bytes:
    img = Image.new("RGB", (width, height), color=(250, 247, 240))
    out = io.BytesIO()
    img.save(out, format="PNG")
    return out.getvalue()


def _image_size(image_bytes: bytes) -> tuple[int, int]:
    with Image.open(io.BytesIO(image_bytes)) as img:
        return img.size


def _plan_proposal() -> dict:
    return {
        "input_kind": "plan",
        "walls": [
            {"a": [0.1, 0.1], "b": [0.9, 0.1], "kind": "exterior"},
            {"a": [0.9, 0.1], "b": [0.9, 0.9], "kind": "exterior"},
            {"a": [0.9, 0.9], "b": [0.1, 0.9], "kind": "exterior"},
            {"a": [0.1, 0.9], "b": [0.1, 0.1], "kind": "exterior"},
        ],
        "openings": [{"wall_index": 0, "t0": 0.2, "t1": 0.4, "kind": "door"}],
        "labels": [{"text": "Estar", "at": [0.5, 0.5]}],
        "dimensions": [{"text": "8,00 m", "a": [0.0, 0.02], "b": [1.0, 0.02]}],
    }


def _sketch_proposal() -> dict:
    # Hand-drawn croquis (sketch): wobbly quad, comma-decimal written measure.
    return {
        "input_kind": "sketch",
        "walls": [
            {"a": [0.1, 0.1], "b": [0.9, 0.12], "kind": "exterior"},
            {"a": [0.9, 0.12], "b": [0.88, 0.9], "kind": "exterior"},
            {"a": [0.88, 0.9], "b": [0.12, 0.88], "kind": "exterior"},
            {"a": [0.12, 0.88], "b": [0.1, 0.1], "kind": "exterior"},
        ],
        "openings": [
            {"wall_index": 0, "t0": 0.3, "t1": 0.5, "kind": "door"},
            {"wall_index": 2, "t0": 0.2, "t1": 0.6, "kind": "window"},
        ],
        "labels": [{"text": "DORM", "at": [0.5, 0.5]}],
        "dimensions": [{"text": "6,00", "a": [0.0, 0.02], "b": [1.0, 0.02]}],
    }


def test_e2e_plan_fixture_to_confirmed_scene() -> None:
    image_w, image_h = _image_size(_make_image_bytes(1600, 1200))
    proposal = IntakeProposal.model_validate(_plan_proposal())
    assert proposal.input_kind == "plan"
    assert proposal.dimensions[0].text == "8,00 m"  # verbatim, comma survives

    scaled = build_scaled_plan(proposal, image_w, image_h)  # auto anchor
    assert scaled.anchor_meters == pytest.approx(8.0)
    assert scaled.scale_m_per_px == pytest.approx(8.0 / image_w)
    assert len(scaled.rooms) == 1

    scene = to_scene(scaled, scene_id="e2e-plan")
    assert scene.units == "m"
    assert scene.scale_confirmed is False  # auto anchor: human confirms
    assert len(scene.walls) == 4
    assert len(scene.rooms) == 1

    from server.export.dxf import ScaleNotConfirmedError, export_dxf

    with pytest.raises(ScaleNotConfirmedError):
        export_dxf(scene)
    confirmed = scene.model_copy(update={"scale_confirmed": True})
    assert confirmed.scale_confirmed is True
    import ezdxf

    assert export_dxf(confirmed).units == ezdxf.units.M


def test_e2e_sketch_croquis_to_confirmed_scene() -> None:
    # sketch path: same pipeline, croquis with a written "6,00" measurement.
    image_w, image_h = _image_size(_make_image_bytes(1200, 700))
    proposal = IntakeProposal.model_validate(_sketch_proposal())
    assert proposal.input_kind == "sketch"
    assert proposal.dimensions[0].text == "6,00"

    scaled = build_scaled_plan(proposal, image_w, image_h)  # auto anchor
    assert scaled.anchor_meters == pytest.approx(6.0)
    assert scaled.scale_m_per_px == pytest.approx(6.0 / image_w)
    assert len(scaled.rooms) == 1
    assert len(scaled.openings) == 2

    scene = to_scene(scaled, scene_id="e2e-sketch")
    assert scene.units == "m"
    assert scene.scale_confirmed is False
    assert {o.kind for o in scene.openings} == {"door", "window"}

    from server.export.dxf import ScaleNotConfirmedError, export_dxf

    with pytest.raises(ScaleNotConfirmedError):
        export_dxf(scene)
    confirmed = scene.model_copy(update={"scale_confirmed": True})
    assert confirmed.scale_confirmed is True
    import ezdxf

    assert export_dxf(confirmed).units == ezdxf.units.M
