"""Scripted multi-turn eval on the real croquis_3x8 sample (round 10, Y).

A fake model replays the call sequences the live model produced (and a dozen
common phrasings) through the real loop, executor and addressing code. Each
scenario carries (Scene, op history, chat) from turn to turn, exactly like the
web client, and must end with the expected Scene. The results table is written
to docs/AGENT_EVAL.md.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

import pytest
from fastapi.testclient import TestClient
from shapely.geometry import Polygon

from server.agent.loop import run_turn
from server.api import app
from server.scene.models import Scene
from server.tests.test_agent_loop import ScriptedClient

DOC = Path(__file__).resolve().parents[2] / "docs" / "AGENT_EVAL.md"
RESULTS: list[tuple[str, str, str]] = []  # (scenario, phrasing, outcome)


@pytest.fixture(scope="module")
def sample() -> Scene:
    res = TestClient(app).post("/intake", data={"kind": "plan", "sample": "croquis_3x8_door_window"})
    assert res.status_code == 200, res.text
    return Scene.model_validate(res.json()["scene"])


@dataclass
class Session:
    """What the web client holds for one variant: Scene, op history, chat."""

    scene: Scene
    history: list = field(default_factory=list)
    chat: list[dict[str, str]] = field(default_factory=list)

    def say(self, text: str, *steps: dict[str, Any]) -> Any:
        client = ScriptedClient(list(steps))
        result = run_turn(
            self.scene, self.history, "reform", text, client, conversation=list(self.chat)
        )
        self.chat += [{"role": "user", "text": text}, {"role": "assistant", "text": result.reply}]
        self.scene = result.scene
        self.history = list(self.history)  # run_turn appends in place
        # the model must have been given the whole chat on every later turn
        if len(self.chat) > 2:
            assert isinstance(client.calls[0]["input"], list)
        self.last_events = result.tool_events
        return result


def call(tool: str, /, **arguments: Any) -> dict[str, Any]:
    return {"calls": [{"name": tool, "arguments": arguments}]}


def reply(text: str) -> dict[str, Any]:
    return {"reply": text}


def area(room) -> float:
    return Polygon(room.polygon).area


def record(scenario: str, phrasing: str, ok: bool) -> None:
    RESULTS.append((scenario, phrasing, "pass" if ok else "FAIL"))


def check(scenario: str, phrasing: str, condition: bool, message: str = "") -> None:
    record(scenario, phrasing, bool(condition))
    assert condition, f"{scenario} / {phrasing}: {message}"


BEDROOM = dict(function="bedroom", name="Bedroom 2", next_to="r0", size_m=[3.0, 4.0])


def test_add_room_then_window_to_the_new_room(sample: Scene) -> None:
    s = Session(sample)
    s.say("add another 3x4 room", call("add_room", **BEDROOM, wall="wall 1"), reply("Added the bedroom."))
    check("add room, then window", "add a 3x4 room", len(s.scene.rooms) == 2 and abs(area(s.scene.rooms[-1]) - 12) < 1.5)
    # the live model guessed "wall 9", "wall 10", "wall 8": now it names room + side
    s.say("add a window to the new room", call("add_opening", room="new", side="north", kind="window"), reply("Window added."))
    ev = s.last_events[0]
    check("add room, then window", "add a window to the new room", ev["ok"], str(ev.get("error_messages")))
    new = s.scene.rooms[-1]
    window = s.scene.openings[-1]
    wall = next(w for w in s.scene.walls if w.id == window.wall_id)
    on_new = Polygon(new.polygon).exterior.distance(Polygon([wall.a, wall.b, wall.b]).centroid) < 0.5
    check("add room, then window", "window is on the new room", window.kind == "window" and on_new)


def test_the_guessed_wall_numbers_now_get_actionable_errors(sample: Scene) -> None:
    s = Session(sample)
    s.say("add a 3x4 bedroom", call("add_room", **BEDROOM, wall="wall 1"), reply("ok"))
    for guess in ("wall 9", "wall 10", "wall 8"):
        s.say("add a window to the new room", call("add_opening", wall=guess, room="new", kind="window"), reply("hm"))
        event = s.last_events[0]
        message = event["error_messages"][0] if not event["ok"] else ""
        ok = event["ok"] or ("valid walls of" in message)
        check("guessed wall numbers", guess, ok, message)


def test_widen_the_door(sample: Scene) -> None:
    s = Session(sample)
    door = next(o for o in s.scene.openings if o.kind == "door")
    s.say("make the door bigger", call("set_opening_size", opening=door.id, width_m=1.8), reply("Door is now 1.80 m."))
    after = next(o for o in s.scene.openings if o.id == door.id)
    check("widen the door", "make the door bigger", s.last_events[0]["ok"] and after.width_m == pytest.approx(1.8))


def test_add_a_room_on_the_window_wall(sample: Scene) -> None:
    s = Session(sample)
    window_wall = next(o.wall_id for o in s.scene.openings if o.kind == "window")
    label = f"wall {[w.id for w in s.scene.walls].index(window_wall) + 1}"
    before = len(s.scene.openings)
    s.say("add a 3x4 room on the window wall", call("add_room", **BEDROOM, wall=label), reply("Added; the window stays as an opening."))
    check("room on the window wall", "wall with a window", s.last_events[0]["ok"] and len(s.scene.rooms) == 2)
    win = [o for o in s.scene.openings if o.kind == "window" and o.wall_id == window_wall]
    check("room on the window wall", "window is kept", len(win) == 1)
    check("room on the window wall", "door goes in a free span", len(s.scene.openings) >= before + 1)


def test_switching_variant_mid_conversation_keeps_each_scene(sample: Scene) -> None:
    a, b = Session(sample), Session(sample)
    a.say("add a 3x4 bedroom", call("add_room", **BEDROOM, wall="wall 1"), reply("ok"))
    b.say("add a 3x3 study", call("add_room", function="study", name="Study", next_to="r0", size_m=[3.0, 3.0], wall="wall 1"), reply("ok"))
    # back to A: its Scene and chat are exactly what its last turn returned
    a.say("add a window to the new room", call("add_opening", room="new", side="north", kind="window"), reply("ok"))
    check("variant switch", "A keeps Bedroom 2", [r.name for r in a.scene.rooms][-1] == "Bedroom 2")
    check("variant switch", "B keeps Study", [r.name for r in b.scene.rooms][-1] == "Study")
    check("variant switch", "window only in A", len(a.scene.openings) == len(b.scene.openings) + 1 - 0 or a.scene.openings != b.scene.openings)
    check("variant switch", "chats are separate", len(a.chat) == 4 and len(b.chat) == 2)


def test_undo_then_redo_the_request(sample: Scene) -> None:
    s = Session(sample)
    s.say("add a 3x4 bedroom", call("add_room", **BEDROOM, wall="wall 1"), reply("ok"))
    s.say("undo that", call("undo"), reply("Undone."))
    check("undo, redo", "undo restores the house", len(s.scene.rooms) == 1 and len(s.scene.walls) == len(sample.walls))
    s.say("add it again", call("add_room", **BEDROOM, wall="wall 1"), reply("ok"))
    check("undo, redo", "redo gives the room back", len(s.scene.rooms) == 2 and abs(area(s.scene.rooms[-1]) - 12) < 1.5)


def test_resize_the_new_room(sample: Scene) -> None:
    s = Session(sample)
    s.say("add a 3x4 bedroom", call("add_room", **BEDROOM, wall="wall 1"), reply("ok"))
    s.say("make the new room 3 by 5", call("resize_room", room="new", width_m=3.0, depth_m=5.0), reply("Resized."))
    check("resize the new room", "make the new room 3 by 5", s.last_events[0]["ok"] and abs(area(s.scene.rooms[-1]) - 15) < 1.5, str(s.last_events[0]))


def test_split_a_room(sample: Scene) -> None:
    s = Session(sample)
    big = s.scene.rooms[0].name
    s.say("split the big room in two", call("split_room", room=big, axis="x", at_ratio=0.5), reply("Split."))
    check("split a room", "split the big room in two", s.last_events[0]["ok"] and len(s.scene.rooms) == 2, str(s.last_events[0]))
    check("split a room", "areas are about half", abs(area(s.scene.rooms[0]) - area(s.scene.rooms[1])) < 3.0)


PHRASINGS: list[tuple[str, dict[str, Any], Callable[[Scene, Scene], bool]]] = [
    ("add a window to the new room (north)", call("add_opening", room="new", side="north", kind="window"), lambda b, a: len(a.openings) == len(b.openings) + 1),
    ("put a window on the east side of the new room", call("add_opening", room="new", side="east", kind="window"), lambda b, a: len(a.openings) == len(b.openings) + 1),
    ("a window on the north wall of the new bedroom", call("add_opening", wall="north wall of the new bedroom", kind="window"), lambda b, a: len(a.openings) == len(b.openings) + 1),
    ("window on the new room's outside wall", call("add_opening", room="new", side="west", kind="window"), lambda b, a: len(a.openings) == len(b.openings) + 1),
    ("make the new room 3 x 5", call("resize_room", room="new", width_m=3.0, depth_m=5.0), lambda b, a: abs(area(a.rooms[-1]) - 15) < 1.5),
    ("make the last room bigger", call("resize_room", room="last", width_m=4.0, depth_m=4.0), lambda b, a: abs(area(a.rooms[-1]) - 16) < 1.5),
    ("rename the new room to Study", call("rename_room", room="new", name="Study"), lambda b, a: a.rooms[-1].name == "Study"),
    ("split the new room in two", call("split_room", room="new", axis="x", at_ratio=0.5), lambda b, a: len(a.rooms) == len(b.rooms) + 1),
    ("move the north wall of the new room 0.5 m", call("move_wall", room="new", side="north", offset_m=0.5), lambda b, a: a.walls != b.walls),
    ("make the wall facing the garden of the new room 3 m", call("set_wall_length", room="new", side="east", length_m=3.0), lambda b, a: a.walls != b.walls),
    ("door on the new room's north wall", call("add_opening", room="new", side="north", kind="door"), lambda b, a: len(a.openings) == len(b.openings) + 1),
]


@pytest.mark.parametrize(("phrase", "step", "expect"), PHRASINGS, ids=[p[0] for p in PHRASINGS])
def test_common_phrasings_on_a_room_just_added(
    sample: Scene, phrase: str, step: dict[str, Any], expect: Callable[[Scene, Scene], bool]
) -> None:
    s = Session(sample)
    s.say("add a 3x4 bedroom", call("add_room", **BEDROOM, wall="wall 1"), reply("ok"))
    before = s.scene
    s.say(phrase, step, reply("done"))
    ok = s.last_events[0]["ok"] and expect(before, s.scene)
    check("phrasings on the new room", phrase, ok, str(s.last_events[0]))


def test_a_window_on_the_shared_wall_is_refused_with_a_reason(sample: Scene) -> None:
    """The shared wall is short and already holds the connecting door: refuse, explain."""
    s = Session(sample)
    s.say("add a 3x4 bedroom", call("add_room", **BEDROOM, wall="wall 1"), reply("ok"))
    s.say("window on the shared wall", call("add_opening", room="new", side="shared", kind="window"), reply("hm"))
    ev = s.last_events[0]
    check("refusals", "window on the shared wall", not ev["ok"] and "overlap" in ev["error_messages"][0], str(ev))
    s.say("window on the south wall of the new room", call("add_opening", wall="south wall of the new bedroom", kind="window"), reply("hm"))
    check("refusals", "south side of the new room is the shared wall", not s.last_events[0]["ok"])


def test_write_results_table() -> None:
    """Runs last (file order): regenerates docs/AGENT_EVAL.md from this run."""
    assert RESULTS, "scenario tests must run before the table is written"
    passed = sum(1 for r in RESULTS if r[2] == "pass")
    lines = [
        "# Agent multi-turn eval",
        "",
        "Scripted fake model replaying real and common call sequences through the real loop, executor and",
        "addressing code on the `croquis_3x8_door_window` sample. Source: `server/tests/test_agent_multiturn_eval.py`.",
        "Regenerated on every pytest run.",
        "",
        f"Result: {passed}/{len(RESULTS)} checks pass.",
        "",
        "| Scenario | Check / phrasing | Result |",
        "|---|---|---|",
        *[f"| {s} | {p} | {o} |" for s, p, o in RESULTS],
        "",
    ]
    DOC.write_text("\n".join(lines), encoding="utf-8")
    assert passed == len(RESULTS)
    assert math.isfinite(passed)
