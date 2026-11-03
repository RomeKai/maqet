"""Nearly rectangular sketch -> exact axis-aligned Scene (real phone reading).

The fixture is the model's reading of a hand-drawn 3x8 m home photographed a
little tilted (~1 deg). Offline, no Meta calls.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

from server.agent.executor import execute
from server.intake.cleanup import build_scaled_plan, to_scene
from server.intake.schemas import IntakeProposal
from server.scene.models import Scene

FIXTURE = Path(__file__).parent / "fixtures" / "sketch_reading_3x8.json"
IMAGE_SIZES = [(3000, 4000), (1000, 1000), (4000, 3000)]


def _proposal() -> IntakeProposal:
    return IntakeProposal.model_validate(json.loads(FIXTURE.read_text(encoding="utf-8")))


def _scene(size: tuple[int, int]) -> Scene:
    return to_scene(build_scaled_plan(_proposal(), *size))


def _axis_aligned(wall) -> bool:
    return wall.a[0] == wall.b[0] or wall.a[1] == wall.b[1]


def _area(poly) -> float:
    return abs(sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1]
                   for i in range(len(poly)))) / 2


def _ground_area(scene: Scene) -> float:
    return sum(_area(r.polygon) for r in scene.rooms if r.level == 1)


def test_tilted_sketch_becomes_exact_axis_aligned_rectangle() -> None:
    for size in IMAGE_SIZES:
        scene = _scene(size)
        assert len(scene.walls) == 4
        assert all(_axis_aligned(w) for w in scene.walls), [(w.a, w.b) for w in scene.walls]
        lengths = sorted(round(math.dist(w.a, w.b), 6) for w in scene.walls)
        assert lengths == [3.0, 3.0, 8.0, 8.0]
        assert all(w.provenance == "written_on_sketch" for w in scene.walls)
        assert len(scene.rooms) == 1
        assert abs(_area(scene.rooms[0].polygon) - 24.0) < 1e-6


def test_door_stays_on_its_wall_at_the_written_position() -> None:
    scene = _scene((3000, 4000))
    (door,) = scene.openings
    wall = next(w for w in scene.walls if w.id == door.wall_id)
    assert math.isclose(math.dist(wall.a, wall.b), 8.0, abs_tol=1e-6)
    assert math.isclose(door.offset_m, 0.41 * 8.0, abs_tol=1e-6)
    assert door.offset_m + door.width_m <= 8.0


def test_three_by_four_room_next_to_house_is_aligned_and_totals_36() -> None:
    scene = _scene((3000, 4000))
    scene, res = execute(
        scene, [], "reform", "add_room",
        {"function": "bedroom", "next_to": scene.rooms[0].id, "size_m": [3.0, 4.0]},
    )
    assert res.ok, res.errors
    assert all(_axis_aligned(w) for w in scene.walls), [(w.a, w.b) for w in scene.walls]
    assert abs(_ground_area(scene) - 36.0) < 1e-6


def test_written_lengths_that_cannot_close_a_rectangle_stay_honest() -> None:
    raw = json.loads(FIXTURE.read_text(encoding="utf-8"))
    raw["dimensions"][2]["text"] = "4.00 m"  # bottom 4 vs top 3: cannot close
    plan = build_scaled_plan(IntakeProposal.model_validate(raw), 3000, 4000)
    assert any(w.startswith("contradiction") for w in plan.warnings), plan.warnings


def test_truly_diagonal_wall_is_kept_and_flagged() -> None:
    raw = json.loads(FIXTURE.read_text(encoding="utf-8"))
    raw["walls"][2]["a"] = [0.368, 0.60]  # bottom wall now ~30 deg off axis
    raw["dimensions"] = [d for d in raw["dimensions"] if d["wall_index"] != 2]
    plan = build_scaled_plan(IntakeProposal.model_validate(raw), 3000, 4000)
    scene = to_scene(plan)
    assert any(w.startswith("wall.diagonal_kept") for w in plan.warnings), plan.warnings
    assert sum(1 for w in scene.walls if not _axis_aligned(w)) >= 1
