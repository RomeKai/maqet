"""Human wall labels (bug F): 'wall 2 (north, 8.0 m)', mapped back to ids in code."""

from __future__ import annotations

from pathlib import Path

from server.agent.executor import execute
from server.agent.loop import scene_summary
from server.agent.wall_labels import resolve_wall_ref, wall_label, wall_number
from server.tests.test_edit_tools import _house

PROMPT = Path(__file__).resolve().parents[1] / "agent" / "prompts" / "reform_v1.md"


def test_label_is_number_orientation_length() -> None:
    scene = _house()  # w1 south 8 m, w2 east 3 m, w3 north 8 m, w4 west 3 m
    assert wall_label(scene, "w1") == "wall 1 (south, 8.0 m)"
    assert wall_label(scene, "w2") == "wall 2 (east, 3.0 m)"
    assert wall_label(scene, "w3") == "wall 3 (north, 8.0 m)"
    assert wall_label(scene, "w4") == "wall 4 (west, 3.0 m)"
    assert wall_number(scene, "w3") == 3


def test_labels_resolve_back_to_ids() -> None:
    scene = _house()
    for ref in ("wall 3", "Wall 3", "3", "muro 3", "w3", "W3", "wall 3 (north, 8.0 m)"):
        assert resolve_wall_ref(scene, ref) == "w3", ref
    assert resolve_wall_ref(scene, "wall 9") is None
    assert resolve_wall_ref(scene, "") is None


def test_summary_lists_walls_by_label_with_id_mapping() -> None:
    summary = scene_summary(_house())
    assert "wall 3 (north, 8.0 m)" in summary
    assert "id w3" in summary  # mapping for tool arguments only


def test_tools_accept_the_human_label() -> None:
    scene, history = _house(), []
    new, res = execute(scene, history, "reform", "add_opening",
                       {"wall": "wall 3", "kind": "window", "at_ratio": 0.5})
    assert res.ok, res.errors
    assert new.openings[-1].wall_id == "w3"
    new2, res2 = execute(new, history, "reform", "set_wall_length",
                         {"wall": "wall 2", "length_m": 3.5})
    assert res2.ok, res2.errors


def test_prompt_tells_the_model_to_ask_with_labels_never_ids() -> None:
    text = PROMPT.read_text(encoding="utf-8").casefold()
    assert "never" in text and "raw id" in text
    assert "wall 2 (north" in text
