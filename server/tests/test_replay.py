"""I16 replay tests (RED first): sample replay, ReplayMiss -> 409, CORS-safe 500.

Offline: no mme.client calls on the replay path (FakeClient raises if touched).
"""

from __future__ import annotations

import io
import json
import sys
import types
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from PIL import Image

import server.api as api_module
from server.api import app

client = TestClient(app)
# Unhandled-exception path must surface as a 500 response, not re-raise.
no_raise_client = TestClient(app, raise_server_exceptions=False)

FIXTURE = "croquis_nonproportional"
FIXTURE_PATH = (
    Path(__file__).resolve().parents[2] / "samples" / "plans" / f"{FIXTURE}.proposal.json"
)


@pytest.fixture(autouse=True)
def _reset_store() -> Any:
    api_module._current = None
    yield
    api_module._current = None


def _fixture_proposal() -> dict[str, Any]:
    return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))["proposal"]


def _fixture_dims() -> tuple[int, int]:
    image = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))["image"]
    return int(image["w"]), int(image["h"])


class ExplodingClient:
    """Fails loudly if vision is ever called (replay must be offline)."""

    def chat_json(self, messages: Any, **kwargs: Any) -> dict[str, Any]:
        raise AssertionError("vision must not run on the sample-replay path")


def _install_exploding(monkeypatch: pytest.MonkeyPatch) -> None:
    module = types.ModuleType("mme.client")
    module.client = lambda: ExplodingClient()  # type: ignore[attr-defined]
    pkg = types.ModuleType("mme")
    pkg.client = module  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "mme", pkg)
    monkeypatch.setitem(sys.modules, "mme.client", module)


def _sample_post(sample: str, kind: str = "sketch") -> Any:
    return client.post("/intake", data={"kind": kind, "sample": sample})


def test_unknown_sample_is_409_with_name_and_hint(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_exploding(monkeypatch)
    res = _sample_post("nope_missing")
    assert res.status_code == 409, res.text
    detail = res.json()["detail"].lower()
    assert "nope_missing" in detail
    assert "pick one of" in detail


def test_sample_replay_matches_upload_shape(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_exploding(monkeypatch)
    res = _sample_post(FIXTURE)
    assert res.status_code == 200, res.text
    replay = res.json()
    assert set(replay) >= {
        "proposal",
        "scene",
        "warnings",
        "scale_m_per_px",
        "anchor_index",
        "anchor_meters",
    }
    assert replay["proposal"]["input_kind"] == "sketch"
    # Mode C sketch with every wall written on it counts as scale confirmed (ADR-025).
    assert replay["scene"]["scale_confirmed"] is True
    assert len(replay["scene"]["walls"]) == 6
    assert replay["anchor_meters"] == pytest.approx(6.0)
    # Every fixture wall carries a written length, so no warnings here; the
    # shape (list) is what the contract guarantees.
    assert isinstance(replay["warnings"], list)
    # Stored as current: /scene serves the replayed draft.
    assert client.get("/scene").status_code == 200


def test_sample_replay_equals_vision_upload(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Same proposal through upload + replay gives the identical draft."""
    from server.tests.test_api_intake import FakeClient, _install, _make_image_bytes

    proposal = _fixture_proposal()
    _install(FakeClient([proposal]), monkeypatch)
    w, h = _fixture_dims()
    upload = client.post(
        "/intake",
        files={"file": ("sketch.png", _make_image_bytes(w, h), "image/png")},
        data={"kind": "sketch"},
    )
    assert upload.status_code == 200, upload.text

    monkeypatch.setitem(sys.modules, "mme", types.ModuleType("mme"))
    _install_exploding(monkeypatch)
    replay = _sample_post(FIXTURE)
    assert replay.status_code == 200, replay.text
    assert replay.json() == upload.json()


def test_path_traversal_sample_is_400(monkeypatch: pytest.MonkeyPatch) -> None:
    _install_exploding(monkeypatch)
    res = _sample_post("../secret")
    assert res.status_code == 400, res.text
    assert client.get("/scene").status_code == 404  # nothing stored


def test_unhandled_error_is_500_with_cors_and_preliminary_label(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def _boom(*args: Any, **kwargs: Any) -> Any:
        raise RuntimeError("boom")

    monkeypatch.setattr(api_module, "build_scaled_plan", _boom)
    res = no_raise_client.post(
        "/intake",
        data={"kind": "sketch", "sample": FIXTURE},
        headers={"Origin": "http://example.com"},
    )
    assert res.status_code == 500, res.text
    assert res.json()["detail"].lower().startswith("preliminary") or "preliminary" in res.json()["detail"].lower()
    assert res.headers.get("access-control-allow-origin") == "*"


def test_replay_miss_is_value_error() -> None:
    from server.intake.replay import ReplayMiss

    assert issubclass(ReplayMiss, ValueError)


def test_upload_replay_miss_is_409_not_500(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Upload with no cached vision response -> 409, not 500.

    In MME_MODE=replay the harness raises mme.client.ReplayMiss (a
    RuntimeError duck-typed by class name: api.py must not import the
    harness at module top). The route must map it to 409 with an
    actionable detail; genuine crashes stay on the 500 path.
    """
    from server.tests.test_api_intake import _make_image_bytes

    HarnessReplayMiss = type("ReplayMiss", (RuntimeError,), {})

    class NoCacheClient:
        def chat_json(self, messages: Any, **kwargs: Any) -> dict[str, Any]:
            raise HarnessReplayMiss(
                "no cached response for /v1/responses (abc123.json); "
                "record it in live mode first"
            )

    module = types.ModuleType("mme.client")
    module.client = lambda: NoCacheClient()  # type: ignore[attr-defined]
    pkg = types.ModuleType("mme")
    pkg.client = module  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "mme", pkg)
    monkeypatch.setitem(sys.modules, "mme.client", module)

    res = client.post(
        "/intake",
        files={"file": ("photo.png", _make_image_bytes(800, 600), "image/png")},
        data={"kind": "plan"},
    )
    assert res.status_code == 409, res.text
    detail = res.json()["detail"].lower()
    assert "sample" in detail
    assert "live" in detail
    assert client.get("/scene").status_code == 404  # nothing stored
