"""The vision prompt must keep door drawings out of the wall list (real phone sketch, 2026-11-03)."""

from server.intake.read_plan import SYSTEM_PROMPT


def test_prompt_says_a_door_drawing_is_not_a_wall() -> None:
    prompt = SYSTEM_PROMPT.lower()
    assert "swing arc" in prompt
    assert "never transcribe the arc or the leaf as walls" in prompt


def test_prompt_keeps_one_wall_across_a_door_gap() -> None:
    prompt = SYSTEM_PROMPT.lower()
    assert "one straight wall across the gap" in prompt
    assert "width of the opening" in prompt
