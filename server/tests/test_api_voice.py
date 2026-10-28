"""POST /transcribe API tests (push-to-talk -> text + duration).

Offline: MME_MODE=replay with the cached responses for
samples/audio/reform_{en,es}.wav (language_bias + keywords required for a
cache hit). The 422 cases never touch the harness.
"""

from __future__ import annotations

import io
import wave
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

from server.api import app

client = TestClient(app)

AUDIO_DIR = Path(__file__).resolve().parents[2] / "samples" / "audio"
KEYWORDS = "Maqet, bond beam, encadenado"


def _make_wav(
    *,
    channels: int = 1,
    sampwidth: int = 2,
    rate: int = 24000,
    seconds: float = 0.5,
) -> bytes:
    frames = int(rate * seconds)
    if sampwidth == 1:
        raw = bytes([128]) * frames * channels
    else:
        raw = b"\x00\x00" * frames * channels
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(sampwidth)
        w.setframerate(rate)
        w.writeframes(raw)
    return buf.getvalue()


def _post(
    audio: bytes,
    filename: str = "clip.wav",
    language: str | None = None,
    keywords: str | None = None,
) -> Any:
    data: dict[str, str] = {}
    if language is not None:
        data["language"] = language
    if keywords is not None:
        data["keywords"] = keywords
    return client.post(
        "/transcribe",
        files={"audio": (filename, audio, "audio/wav")},
        data=data,
    )


def test_transcribe_en_replay() -> None:
    wav = (AUDIO_DIR / "reform_en.wav").read_bytes()
    res = _post(wav, "reform_en.wav", language="en", keywords=KEYWORDS)
    assert res.status_code == 200, res.text
    body = res.json()
    assert set(body) == {"text", "duration_ms"}
    assert "bedroom" in body["text"].lower()
    assert body["duration_ms"] == 6240


def test_transcribe_es_replay() -> None:
    wav = (AUDIO_DIR / "reform_es.wav").read_bytes()
    res = _post(wav, "reform_es.wav", language="es", keywords=KEYWORDS)
    assert res.status_code == 200, res.text
    body = res.json()
    assert "dormitorio" in body["text"].lower()
    assert body["duration_ms"] == 6640


def test_transcribe_empty_is_422() -> None:
    res = _post(b"", "clip.wav", language="en")
    assert res.status_code == 422, res.text
    assert "empty" in res.json()["detail"].lower()


def test_transcribe_non_wav_is_422() -> None:
    res = _post(b"not-a-wav-at-all", "clip.wav", language="en")
    assert res.status_code == 422, res.text
    assert "wav" in res.json()["detail"].lower()


def test_transcribe_stereo_is_422() -> None:
    res = _post(_make_wav(channels=2), language="en")
    assert res.status_code == 422, res.text
    assert "mono" in res.json()["detail"].lower()


def test_transcribe_8bit_is_422() -> None:
    res = _post(_make_wav(sampwidth=1), language="en")
    assert res.status_code == 422, res.text
    assert "16-bit" in res.json()["detail"].lower()


def test_transcribe_wrong_rate_is_422() -> None:
    res = _post(_make_wav(rate=44100), language="en")
    assert res.status_code == 422, res.text
    assert "16 or 24 khz" in res.json()["detail"].lower()


def test_transcribe_bad_language_is_422() -> None:
    wav = (AUDIO_DIR / "reform_en.wav").read_bytes()
    res = _post(wav, "reform_en.wav", language="fr", keywords=KEYWORDS)
    assert res.status_code == 422, res.text
    assert "language" in res.json()["detail"].lower()
