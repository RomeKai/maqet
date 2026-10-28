"""Agent evals runner (Day task, TDD test-first).

Ten scripted conversations live as data in server/tests/agent_evals/*.yaml.
Each case: starting Scene (a samples/plans truth file + optional patch),
stage, user utterance, scripted model behavior (tool calls + final reply),
and must-mention phrases the reply has to contain.

Runs against the planned API (night mission agent-loop owns it):

    run_turn(scene, history, stage, user_text, client, selected=None) -> TurnResult

TurnResult contract: `.scene` (Scene), `.history` (list), `.reply` (str),
`.tool_events` (list of {name, arguments, ok, flags} per executed call,
including failed attempts). The scripted fake below speaks raw Responses
API dicts shaped exactly like the real client output, so the loop under
test can parse them with the same helpers it uses in production.

Until server/agent/loop.py lands, every case skips (suite stays green).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
import yaml

from server.scene.models import Scene

loop = pytest.importorskip("server.agent.loop", reason="agent-loop lands tonight")

CASES_DIR = Path(__file__).resolve().parent / "agent_evals"
PLANS_DIR = CASES_DIR.parents[2] / "samples" / "plans"

CASE_FILES = sorted(CASES_DIR.glob("*.yaml"))
assert CASE_FILES, "agent eval cases missing"


class ScriptedClient:
    """Fake mme.client: replays one scripted Responses-API turn per case.

    Each script step is either {"calls": [{name, arguments}]} (a model turn
    emitting tool calls) or {"reply": str} (the final text answer).
    """

    def __init__(self, script: list[dict[str, Any]]) -> None:
        self._queue = [self._raw(step, i) for i, step in enumerate(script)]

    @staticmethod
    def _raw(step: dict[str, Any], i: int) -> dict[str, Any]:
        if "reply" in step:
            return {
                "id": f"resp_scripted_{i}",
                "output": [
                    {
                        "type": "message",
                        "content": [{"type": "output_text", "text": step["reply"]}],
                    }
                ],
            }
        calls = [
            {
                "type": "function_call",
                "call_id": f"call_scripted_{i}_{j}",
                "name": c["name"],
                "arguments": json.dumps(c.get("arguments", {})),
            }
            for j, c in enumerate(step.get("calls", []))
        ]
        return {"id": f"resp_scripted_{i}", "output": calls}

    def respond(self, input: Any, **kwargs: Any) -> dict[str, Any]:
        assert self._queue, "script exhausted: loop made more model calls than scripted"
        return self._queue.pop(0)

    @staticmethod
    def output_text(response: dict[str, Any]) -> str:
        parts = []
        for item in response.get("output", []):
            if item.get("type") == "message":
                parts += [
                    c.get("text", "")
                    for c in item.get("content", [])
                    if c.get("type") == "output_text"
                ]
        return "".join(parts)

    @staticmethod
    def tool_calls(response: dict[str, Any]) -> list[dict[str, Any]]:
        calls = []
        for item in response.get("output", []):
            if item.get("type") == "function_call":
                args = item.get("arguments") or "{}"
                calls.append(
                    {
                        "call_id": item.get("call_id") or item.get("id"),
                        "name": item.get("name"),
                        "arguments": json.loads(args) if isinstance(args, str) else args,
                    }
                )
        return calls


def _load_scene(case: dict[str, Any]) -> Scene:
    scene = Scene.model_validate_json((PLANS_DIR / case["scene"]).read_text(encoding="utf-8"))
    patch = case.get("scene_patch", {})
    for key in ("walls", "openings", "rooms"):
        for item_patch in patch.get(key, []):
            items = getattr(scene, key)
            idx = next(i for i, it in enumerate(items) if it.id == item_patch["id"])
            items[idx] = items[idx].model_copy(update={k: v for k, v in item_patch.items() if k != "id"})
    return scene


def _ev_get(ev: Any, key: str, default: Any = None) -> Any:
    if isinstance(ev, dict):
        return ev.get(key, default)
    return getattr(ev, key, default)


def _expected_tools(case: dict[str, Any]) -> list[dict[str, Any]]:
    return [c for step in case["script"] if "calls" in step for c in step["calls"]]


@pytest.mark.parametrize("case_file", CASE_FILES, ids=[p.stem for p in CASE_FILES])
def test_agent_eval(case_file: Path) -> None:
    case = yaml.safe_load(case_file.read_text(encoding="utf-8"))
    scene = _load_scene(case)
    before = scene.model_dump()

    result = loop.run_turn(
        scene=scene,
        history=[],
        stage=case["stage"],
        user_text=case["utterance"],
        client=ScriptedClient(case["script"]),
        selected=case.get("selected"),
    )

    # 1. The loop executed exactly the scripted tool calls, in order.
    events = list(result.tool_events)
    expected = _expected_tools(case)
    assert [str(_ev_get(e, "name")) for e in events] == [t["name"] for t in expected]
    for ev, t in zip(events, expected):
        actual_args = dict(_ev_get(ev, "arguments") or {})
        for k, v in t.get("arguments", {}).items():
            assert actual_args.get(k) == v, f"{t['name']}: arg {k!r}"

    # 2. The reply surfaces what the case requires (flags, violations, preliminary).
    reply = str(result.reply)
    assert reply.strip(), "empty reply"
    for phrase in case.get("must_mention", []):
        assert phrase.casefold() in reply.casefold(), f"reply missing {phrase!r}"

    # 3. Optional scene/flag effects.
    expect = case.get("expect", {})
    after = result.scene
    if "rooms_delta" in expect:
        assert len(after.rooms) - len(before["rooms"]) == expect["rooms_delta"]
    if "openings_delta" in expect:
        assert len(after.openings) - len(before["openings"]) == expect["openings_delta"]
    for wid in expect.get("walls_removed", []):
        assert all(w.id != wid for w in after.walls)
    if "flags_contain" in expect:
        seen = [f for e in events for f in (_ev_get(e, "flags") or [])]
        for flag in expect["flags_contain"]:
            # Prefix match: span flags carry the wall id suffix
            # (needs_professional:span_over_limit:w20).
            assert any(s == flag or s.startswith(flag + ":") for s in seen), (
                f"flag {flag!r} not in {seen}"
            )
