"""Intake schema + read_plan tests (F1). Offline: fake mme.client transport only.

No network, no samples/replay reads. The fake records the payload kwargs so
the tests pin the call contract (tier/tag/cache key/max_tokens) without the
harness installed.
"""

from __future__ import annotations

import base64
import sys
import types
from typing import Any

import pytest
from pydantic import ValidationError

from server.intake.read_plan import (
    MAX_TOKENS,
    PROMPT_CACHE_KEY,
    TAG,
    ReadPlanError,
    downscale_image,
    read_plan,
)
from server.intake.schemas import IntakeProposal


def _valid_payload(kind: str = "plan") -> dict[str, Any]:
    return {
        "input_kind": kind,
        "walls": [
            {"a": [0.1, 0.1], "b": [0.9, 0.1], "kind": "exterior"},
            {"a": [0.9, 0.1], "b": [0.9, 0.7], "kind": "exterior"},
        ],
        "openings": [{"wall_index": 0, "t0": 0.2, "t1": 0.5, "kind": "door"}],
        "labels": [{"text": "DORM", "at": [0.5, 0.4]}],
        "dimensions": [
            {"text": "3,50", "a": [0.1, 0.05], "b": [0.9, 0.05]},
            {"text": "2.80 m", "a": [0.95, 0.1], "b": [0.95, 0.7]},
        ],
    }


class FakeClient:
    """Fake mme.client transport: queued dict responses, recorded kwargs."""

    def __init__(self, responses: list[dict[str, Any]]) -> None:
        self._responses = list(responses)
        self.calls: list[dict[str, Any]] = []

    def chat_json(self, messages: Any, **kwargs: Any) -> dict[str, Any]:
        self.calls.append({"messages": messages, **kwargs})
        return self._responses.pop(0)


@pytest.fixture
def _fake_transport(monkeypatch: pytest.MonkeyPatch) -> FakeClient:
    fake = FakeClient([_valid_payload()])
    module = types.ModuleType("mme.client")
    module.client = lambda: fake  # type: ignore[attr-defined]
    pkg = types.ModuleType("mme")
    pkg.client = module  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "mme", pkg)
    monkeypatch.setitem(sys.modules, "mme.client", module)
    return fake


def _install(fake: FakeClient, monkeypatch: pytest.MonkeyPatch) -> None:
    module = types.ModuleType("mme.client")
    module.client = lambda: fake  # type: ignore[attr-defined]
    pkg = types.ModuleType("mme")
    pkg.client = module  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "mme", pkg)
    monkeypatch.setitem(sys.modules, "mme.client", module)


# --- schema validation (pure, no transport) ---------------------------------


def test_valid_proposal_passes() -> None:
    proposal = IntakeProposal.model_validate(_valid_payload())
    assert proposal.input_kind == "plan"
    assert len(proposal.walls) == 2
    assert proposal.dimensions[0].text == "3,50"  # comma decimal survives


def test_sketch_kind_accepted() -> None:
    proposal = IntakeProposal.model_validate(_valid_payload(kind="sketch"))
    assert proposal.input_kind == "sketch"


def test_dimension_point_decimal_accepted() -> None:
    proposal = IntakeProposal.model_validate(_valid_payload())
    assert proposal.dimensions[1].text == "2.80 m"


def test_out_of_range_coordinate_fails() -> None:
    bad = _valid_payload()
    bad["walls"][0]["a"] = [1.5, 0.1]
    with pytest.raises(ValidationError):
        IntakeProposal.model_validate(bad)


def test_opening_wall_index_out_of_range_fails() -> None:
    bad = _valid_payload()
    bad["openings"][0]["wall_index"] = 7
    with pytest.raises(ValidationError):
        IntakeProposal.model_validate(bad)


def test_opening_reversed_span_fails() -> None:
    bad = _valid_payload()
    bad["openings"][0]["t0"] = 0.8
    bad["openings"][0]["t1"] = 0.2
    with pytest.raises(ValidationError):
        IntakeProposal.model_validate(bad)


def test_wall_kind_nullable_and_empty_lists_explicit() -> None:
    proposal = IntakeProposal.model_validate(
        {
            "input_kind": "sketch",
            "walls": [{"a": [0.0, 0.0], "b": [1.0, 0.0], "kind": None}],
            "openings": [],
            "labels": [],
            "dimensions": [],
        }
    )
    assert proposal.walls[0].kind is None
    empty = IntakeProposal.model_validate(
        {
            "input_kind": "plan",
            "walls": [],
            "openings": [],
            "labels": [],
            "dimensions": [],
        }
    )
    assert empty.walls == [] and empty.dimensions == []


def test_strict_schema_forbids_additional_properties() -> None:
    schema = IntakeProposal.model_json_schema()
    assert schema.get("additionalProperties") is False
    for name in ("IntakeWall", "IntakeOpening", "IntakeLabel", "IntakeDimension"):
        assert schema["$defs"][name].get("additionalProperties") is False


def _all_object_schemas(node: Any) -> Any:
    if isinstance(node, dict):
        if "properties" in node:
            yield node
        for value in node.values():
            yield from _all_object_schemas(value)
    elif isinstance(node, list):
        for value in node:
            yield from _all_object_schemas(value)


def test_strict_schema_requires_every_property() -> None:
    schema = IntakeProposal.model_json_schema()
    objects = list(_all_object_schemas(schema))
    assert objects, "no object schemas found"
    for subschema in objects:
        properties = set(subschema.get("properties", {}).keys())
        required = set(subschema.get("required", []))
        assert required == properties, (
            f"strict mode needs required == properties, got required={sorted(required)} "
            f"properties={sorted(properties)}"
        )


# --- read_plan via fake transport --------------------------------------------


def test_read_plan_success_pins_call_contract(
    monkeypatch: pytest.MonkeyPatch, _fake_transport: FakeClient
) -> None:
    image = _make_image_bytes(800, 600)  # real PNG, passes downscale through
    proposal = read_plan(image, "plan")

    assert proposal.input_kind == "plan"
    assert proposal.dimensions[0].text == "3,50"
    assert len(_fake_transport.calls) == 1
    call = _fake_transport.calls[0]
    assert call["tier"] == "draft"
    assert call["tag"] == TAG == "plan->walls"
    assert call["prompt_cache_key"] == PROMPT_CACHE_KEY == "intake-v1"
    assert call["max_tokens"] == MAX_TOKENS >= 2048
    assert "input_kind" in call["json_schema"]["properties"]

    user_parts = call["messages"][1]["content"]
    image_part = next(p for p in user_parts if p["type"] == "image_url")
    assert image_part["image_url"]["url"] == (
        "data:image/png;base64," + base64.b64encode(image).decode("ascii")
    )


def test_read_plan_downscales_before_sending(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import io

    from PIL import Image

    fake = FakeClient([_valid_payload()])
    _install(fake, monkeypatch)

    read_plan(_make_image_bytes(3000, 1500), "plan")

    assert len(fake.calls) == 1
    user_parts = fake.calls[0]["messages"][1]["content"]
    image_part = next(p for p in user_parts if p["type"] == "image_url")
    url = image_part["image_url"]["url"]
    assert url.startswith("data:image/jpeg;base64,")
    sent = base64.b64decode(url.split(",", 1)[1])
    with Image.open(io.BytesIO(sent)) as img:
        assert max(img.size) <= 2048


def test_read_plan_retries_once_with_validation_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    bad = _valid_payload()
    bad["openings"][0]["wall_index"] = 9
    fake = FakeClient([bad, _valid_payload(kind="sketch")])
    _install(fake, monkeypatch)

    proposal = read_plan(_make_image_bytes(400, 300), "sketch")

    assert proposal.input_kind == "sketch"
    assert len(fake.calls) == 2
    retry_text = fake.calls[1]["messages"][1]["content"][0]["text"]
    assert "wall_index" in retry_text


def test_read_plan_fails_loudly_after_two_bad_responses(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    bad = _valid_payload()
    bad["walls"] = []  # orphans openings[0].wall_index
    fake = FakeClient([bad, bad])
    _install(fake, monkeypatch)

    with pytest.raises(ReadPlanError, match="failed validation"):
        read_plan(_make_image_bytes(400, 300), "plan")
    assert len(fake.calls) == 2


def test_read_plan_empty_bytes_never_calls(
    monkeypatch: pytest.MonkeyPatch, _fake_transport: FakeClient
) -> None:
    with pytest.raises(ReadPlanError, match="empty image"):
        read_plan(b"", "plan")
    assert _fake_transport.calls == []


def test_read_plan_rejects_unknown_kind(
    monkeypatch: pytest.MonkeyPatch, _fake_transport: FakeClient
) -> None:
    with pytest.raises(ReadPlanError, match="input_kind"):
        read_plan(_make_image_bytes(100, 100), "photo")  # type: ignore[arg-type]
    assert _fake_transport.calls == []


def _make_image_bytes(width: int, height: int) -> bytes:
    import io

    from PIL import Image

    img = Image.new("RGB", (width, height), color=(250, 247, 240))
    out = io.BytesIO()
    img.save(out, format="PNG")
    return out.getvalue()


def test_downscale_caps_long_side_at_2048() -> None:
    import io

    from PIL import Image

    big = _make_image_bytes(3000, 1500)
    small = downscale_image(big)
    with Image.open(io.BytesIO(small)) as img:
        assert max(img.size) <= 2048
        assert img.size == (2048, 1024)


def test_downscale_leaves_small_images_untouched() -> None:
    small = _make_image_bytes(800, 600)
    assert downscale_image(small) == small
