"""Agent tool inputs never reach the Scene as NaN, infinite or degenerate
geometry. Every bad input comes back as a ToolError the agent can relay,
never a raw exception, and the Scene is unchanged. Offline, no Meta calls.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import pytest
from pydantic import ValidationError

from server.agent.executor import execute
from server.scene.models import Room, Scene, Wall

SAMPLE = Path(__file__).resolve().parents[2] / "samples" / "plans" / "plano_48m_1ambiente.truth.json"
NAN, INF = math.nan, math.inf


def _sample() -> Scene:
    return Scene.model_validate(json.loads(SAMPLE.read_text(encoding="utf-8")))


BAD_CALLS = [
    ("add_wall", {"a": [0, 0], "b": [0, 0], "kind": "interior"}),
    ("add_wall", {"a": [NAN, 0], "b": [1, 0], "kind": "interior"}),
    ("add_wall", {"a": [INF, 0], "b": [1, 0], "kind": "interior"}),
    ("add_wall", {"a": [0, 0], "b": [1, 0], "kind": "interior", "thickness_m": INF}),
    ("add_wall", {"a": [0, 0], "b": [1, 0], "kind": "interior", "thickness_m": 0}),
    ("add_wall", {"a": [0, 0], "b": [1, 0], "kind": "interior", "thickness_m": -0.1}),
    ("add_room", {"function": "bedroom", "polygon": [[0, 0], [NAN, 0], [1, 1]]}),
    ("add_room", {"function": "bedroom", "size_m": [INF, 3]}),
    ("add_room", {"function": "bedroom", "size_m": [0, 3]}),
    ("add_room", {"function": "bedroom", "size_m": [-3, 3]}),
    ("add_opening", {"wall_id": "w_s1", "kind": "door", "width_m": NAN}),
    ("add_opening", {"wall_id": "w_s1", "kind": "door", "offset_m": INF}),
    ("move_opening", {"opening_id": "nope", "new_offset_m": NAN}),
]


@pytest.mark.parametrize(("tool", "args"), BAD_CALLS)
def test_bad_numeric_input_is_a_relayable_error(tool: str, args: dict) -> None:
    scene = _sample()
    after, res = execute(scene, [], "reform", tool, args)
    assert not res.ok
    assert res.errors[0].code == "tool.invalid_args", res.errors
    assert after is scene


@pytest.mark.parametrize(
    ("tool", "args"),
    [
        ("add_opening", {"wall_id": "nope", "kind": "door"}),
        ("remove_wall", {"wall_id": "nope"}),
        ("move_opening", {"opening_id": "nope", "new_offset_m": 1.0}),
    ],
)
def test_unknown_ids_fail_cleanly(tool: str, args: dict) -> None:
    scene = _sample()
    after, res = execute(scene, [], "reform", tool, args)
    assert not res.ok
    assert res.errors[0].code == "anchor.unknown"
    assert after is scene


def test_scene_models_reject_non_finite_and_zero_length_geometry() -> None:
    with pytest.raises(ValidationError):
        Wall(id="w", a=(0.0, 0.0), b=(0.0, 0.0), thickness_m=0.2, kind="interior")
    with pytest.raises(ValidationError):
        Wall(id="w", a=(NAN, 0.0), b=(1.0, 0.0), thickness_m=0.2, kind="interior")
    with pytest.raises(ValidationError):
        Wall(id="w", a=(0.0, 0.0), b=(1.0, 0.0), thickness_m=INF, kind="interior")
    with pytest.raises(ValidationError):
        Room(id="r", name="r", polygon=[(0.0, 0.0), (INF, 0.0), (1.0, 1.0)])


def test_scene_json_with_nan_is_rejected_at_the_boundary() -> None:
    raw = json.loads(SAMPLE.read_text(encoding="utf-8"))
    raw["walls"][0]["a"] = [NAN, 0.0]
    with pytest.raises(ValidationError):
        Scene.model_validate(raw)


def test_intake_drops_walls_that_collapse_to_a_point() -> None:
    from server.intake.cleanup import build_scaled_plan, to_scene
    from server.intake.schemas import IntakeProposal

    proposal = IntakeProposal(
        input_kind="plan",
        walls=[
            {"a": [0.1, 0.1], "b": [0.9, 0.1], "kind": "exterior"},
            {"a": [0.5, 0.5], "b": [0.5, 0.5], "kind": "interior"},
            {"a": [0.1, 0.9], "b": [0.9, 0.9], "kind": "exterior"},
        ],
        openings=[
            {"wall_index": 1, "t0": 0.0, "t1": 1.0, "kind": "door"},
            {"wall_index": 2, "t0": 0.25, "t1": 0.375, "kind": "window"},
        ],
        labels=[],
        dimensions=[{"text": "8,00", "a": [0.1, 0.1], "b": [0.9, 0.1], "wall_index": 0}],
    )
    plan = build_scaled_plan(proposal, 1000, 1000)
    assert len(plan.walls) == 2
    assert any(w.startswith("wall_dropped") for w in plan.warnings)
    assert any(w.startswith("opening_dropped") for w in plan.warnings)
    assert [o.wall_index for o in plan.openings] == [1]  # renumbered, still the top wall
    scene = to_scene(plan)
    assert len(scene.walls) == 2
    assert scene.openings[0].wall_id == scene.walls[1].id
