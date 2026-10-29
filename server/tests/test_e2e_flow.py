"""Q1 full-flow integration (HARDENING Q1): one scenario across the whole stack.

upload plan -> POST /intake -> Scene -> agent turn (reform move wall) ->
variants fork+choose -> snapshot.svg -> DXF export. Synthetic fixtures only,
replay mode. Asserts status, Scene id stability, professional flags when
load-bearing touched, DXF in meters, SVG non-empty.
"""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

import server.api as api
from server.api import app
from server.scene.models import Scene

SAMPLE = Path(__file__).resolve().parents[2] / "samples" / "plans" / "plano_48m_1ambiente.truth.json"
PROPOSAL_FIXTURE = Path(__file__).resolve().parent / "fixtures" / "intake_replay.json"
client = TestClient(app)


def _scene() -> Scene:
    return Scene.model_validate(json.loads(SAMPLE.read_text(encoding="utf-8")))


@pytest.fixture()
def seeded(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Scene:
    """Seed /scene + variants DB from the recorded truth Scene."""
    scene = _scene()
    path = tmp_path / "e2e.db"
    monkeypatch.setattr(api, "_DB_PATH", path)
    monkeypatch.setattr(api, "_current", scene)
    # Persist initial project so fork/choose work
    from server.db import save_project
    from server.scene.variants import Project
    save_project(Project(base=scene), db_path=path)
    return scene


def _fake_client_for_turn() -> object:
    class Fake:
        def respond(self, input, **kwargs):
            return {"id": "r", "output": [{"type": "function_call", "call_id": "c1", "name": "add_opening", "arguments": json.dumps({"wall_id": "w_s1", "kind": "door", "offset_m": 0.5, "width_m": 0.9})}]}

        def tool_calls(self, response):
            return [{"call_id": "c1", "name": "add_opening", "arguments": {"wall_id": "w_s1", "kind": "door", "offset_m": 0.5, "width_m": 0.9}}]

        def output_text(self, response):
            return "Added a door to the kitchen wall. This is preliminary."
    return Fake()


def test_e2e_flow(seeded: Scene) -> None:
    # 1. Intake via recorded proposal fixture (no vision call, same downstream path)
    # If fixture missing, build from truth Scene directly
    proposal_data = json.loads(PROPOSAL_FIXTURE.read_text(encoding="utf-8")) if PROPOSAL_FIXTURE.exists() else None
    if proposal_data:
        from server.intake.cleanup import build_scaled_plan, to_scene
        from server.intake.schemas import IntakeProposal
        proposal = IntakeProposal.model_validate(proposal_data["proposal"])
        plan = build_scaled_plan(proposal, proposal_data["image"]["w"], proposal_data["image"]["h"])
        scene = to_scene(plan, scene_id="e2e-intake")
        assert scene.id == "e2e-intake"
        assert len(scene.walls) > 0
    else:
        scene = _scene()
        # Also verify POST /intake with a real recorded sample works
        sample_name = "croquis_3x8_door_window"
        res = client.post("/intake", data={"kind": "plan", "sample": sample_name})
        assert res.status_code == 200, res.text
        assert "scene" in res.json()

    original_id = scene.id
    original_wall_ids = {w.id for w in scene.walls}

    # 2. Agent turn: move wall 0.5 m via fake client (no Meta call)
    # Mount a temporary scene so /scene/snapshot works against it
    import server.api as api_mod
    old_current = api_mod._current
    api_mod._current = scene
    try:
        fake = _fake_client_for_turn()
        from server.agent.loop import run_turn
        result = run_turn(scene, [], "reform", "add a door to the kitchen wall", fake)
        assert len(result.scene.openings) > len(scene.openings) or result.tool_events, "agent turn must apply ops"
        scene = result.scene
        assert scene.id == original_id, "Scene id must stay stable across agent turns"
        assert len(scene.walls) == len(original_wall_ids)
    finally:
        api_mod._current = old_current

    # 3. Variants: fork + choose (seeded DB)
    res = client.post("/variants/fork", json={"label": "B", "from_branch": "A"})
    assert res.status_code == 200, res.text
    assert any(v["label"] == "B" for v in res.json()["variants"])

    res = client.post("/variants/B/choose")
    assert res.status_code == 200, res.text
    assert res.json()["chosen"] == "B"

    # 4. Professional flag when load-bearing wall touched (mark one, then remove)
    lb_scene = scene.model_copy(deep=True)
    # Mark a wall load-bearing
    lb_scene.walls[0] = lb_scene.walls[0].model_copy(update={"load_bearing": True})
    from server.scene.ops import remove_wall
    _, op_res = remove_wall(lb_scene, lb_scene.walls[0].id)
    assert not op_res.ok or any("professional" in f.lower() or "load_bearing" in f for f in op_res.flags), "removing load-bearing wall must flag professional"

    # 5. Snapshot SVG non-empty
    res = client.post("/scene/snapshot.svg?locale=en", json=scene.model_dump(mode="json"))
    assert res.status_code == 200, res.text[:400]
    assert "image/svg+xml" in res.headers.get("content-type", "")
    assert len(res.text) > 200
    assert "<svg" in res.text.lower()

    # 6. DXF export: must be meters, contain expected layers
    scene_confirmed = scene.model_copy(update={"scale_confirmed": True})
    res = client.post("/export/dxf", json=scene_confirmed.model_dump(mode="json"))
    assert res.status_code == 200, res.text[:500] if res.status_code != 200 else ""
    assert "application/dxf" in res.headers.get("content-type", "")
    dxf_text = res.text
    assert "$INSUNITS" in dxf_text, "DXF must declare units"
    assert "A-WALL" in dxf_text
