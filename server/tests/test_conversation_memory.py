"""The agent has no memory of its own: the web sends the recent chat (bug T).

Root cause pinned: run_turn called client.respond(user_text, previous_response_id=None),
so after a clarifying question ("which wall?") the answer ("wall 3") reached the
model alone and it started over. The server stays stateless: the conversation
travels in the request and becomes the Responses `input`.
"""

from __future__ import annotations

from server.agent.loop import CONVERSATION_LIMIT, _turn_input, run_turn
from server.tests.test_agent_loop import ScriptedClient, _base_scene


def test_no_conversation_keeps_the_bare_string_so_replay_fixtures_hit() -> None:
    assert _turn_input("add a room", None) == "add a room"
    assert _turn_input("add a room", []) == "add a room"


def test_conversation_is_capped_and_the_new_message_comes_last() -> None:
    convo = [{"role": "user" if i % 2 == 0 else "assistant", "text": f"m{i}"} for i in range(30)]
    items = _turn_input("now", convo)
    assert len(items) == CONVERSATION_LIMIT + 1
    assert items[0]["content"] == "m18"
    assert items[-2]["content"] == "m29"
    assert items[-1] == {"role": "user", "content": "now"}


def test_three_turn_clarification_flow_remembers_turn_one() -> None:
    scene = _base_scene()
    client = ScriptedClient(
        [
            {"reply": "Which wall: wall 1 (south, 4.0 m) or wall 3 (north, 4.0 m)?"},
            {"calls": [{"name": "add_room", "arguments": {"function": "bedroom", "name": "Bed",
                        "next_to": scene.rooms[0].id, "wall": "wall 3", "size_m": [3.0, 4.0]}}]},
            {"reply": "Added the bedroom on wall 3."},
        ]
    )
    first = run_turn(scene, [], "reform", "add a 3x4 bedroom", client)
    assert "Which wall" in first.reply
    assert client.calls[0]["input"] == "add a 3x4 bedroom"  # first turn: bare string

    conversation = [
        {"role": "user", "text": "add a 3x4 bedroom"},
        {"role": "assistant", "text": first.reply},
    ]
    second = run_turn(first.scene, [], "reform", "wall 3", client, conversation=conversation)
    turn_two_input = client.calls[1]["input"]
    assert turn_two_input == [
        {"role": "user", "content": "add a 3x4 bedroom"},
        {"role": "assistant", "content": first.reply},
        {"role": "user", "content": "wall 3"},
    ]
    assert client.calls[1]["kwargs"]["previous_response_id"] is None
    assert any(e["name"] == "add_room" and e["ok"] for e in second.tool_events)
    assert len(second.scene.rooms) == len(scene.rooms) + 1
