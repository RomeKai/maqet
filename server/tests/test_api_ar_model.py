"""AR model hosting: Scene Viewer / Quick Look are separate apps and cannot read blob: URLs,
so the web uploads the built GLB/USDZ and hands model-viewer an https URL."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

import server.api as api_module
from server.api import app

client = TestClient(app)

GLB = b"glTF" + b"\x02\x00\x00\x00" + b"x" * 64
USDZ = b"PK\x03\x04" + b"y" * 64


@pytest.fixture(autouse=True)
def _tmp_store(tmp_path, monkeypatch):
    monkeypatch.setattr(api_module, "_AR_DIR", tmp_path / "ar")


def _upload(data: bytes, content_type: str, name: str = "m.bin"):
    return client.post("/ar/model", files={"file": (name, data, content_type)})


def test_glb_round_trip_with_right_mime() -> None:
    res = _upload(GLB, "model/gltf-binary", "m.glb")
    assert res.status_code == 200
    body = res.json()
    assert body["kind"] == "glb"
    got = client.get(f"/ar/model/{body['id']}.glb")
    assert got.status_code == 200
    assert got.headers["content-type"] == "model/gltf-binary"
    assert got.content == GLB


def test_usdz_round_trip_with_right_mime() -> None:
    res = _upload(USDZ, "model/vnd.usdz+zip", "m.usdz")
    assert res.status_code == 200
    body = res.json()
    assert body["kind"] == "usdz"
    got = client.get(f"/ar/model/{body['id']}.usdz")
    assert got.status_code == 200
    assert got.headers["content-type"] == "model/vnd.usdz+zip"
    assert got.content == USDZ


def test_ids_are_random_per_upload() -> None:
    a = _upload(GLB, "model/gltf-binary").json()["id"]
    b = _upload(GLB, "model/gltf-binary").json()["id"]
    assert a != b and len(a) >= 16


def test_rejects_oversize() -> None:
    big = b"glTF" + b"0" * (15 * 1024 * 1024)
    assert _upload(big, "model/gltf-binary").status_code == 413


def test_rejects_wrong_content_type() -> None:
    assert _upload(GLB, "text/html").status_code == 415


def test_rejects_content_that_is_not_the_declared_type() -> None:
    assert _upload(b"<html>nope</html>", "model/gltf-binary").status_code == 415
    assert _upload(GLB, "model/vnd.usdz+zip").status_code == 415


def test_rejects_missing_file() -> None:
    assert client.post("/ar/model").status_code == 422


def test_unknown_or_malformed_id_is_404() -> None:
    assert client.get("/ar/model/" + "a" * 32 + ".glb").status_code == 404
    assert client.get("/ar/model/..%2F..%2Fetc.glb").status_code == 404
    kept = _upload(GLB, "model/gltf-binary").json()["id"]
    assert client.get(f"/ar/model/{kept}.usdz").status_code == 404
