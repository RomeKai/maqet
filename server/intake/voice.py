"""Push-to-talk transcription: WAV bytes -> (text, duration_ms).

WAV contract (matches the Muse Voice Transcribe input): mono 16-bit PCM
at 16 or 24 kHz. Anything else is a VoiceError, which the route maps to
422. One transcribe call per clip, tag "asr".
"""

from __future__ import annotations

import io
import wave
from typing import Any

try:
    from mme.client import client as _mme_client  # type: ignore[import-not-found]
except ImportError:  # harness not installed (worktree without .mme)
    _mme_client = None  # type: ignore[assignment]

TAG = "asr"
_SAMPLE_RATES = (16000, 24000)
_LANGUAGE_BIAS = {"en": ["English"], "es": ["Spanish"]}


class VoiceError(ValueError):
    """Raised when the upload is not valid transcribe input. Never silent."""


def split_keywords(raw: str | None) -> list[str]:
    """Comma-separated keywords -> list; empty or blank -> []."""
    return [k.strip() for k in (raw or "").split(",") if k.strip()]


def _wav_params(audio: bytes) -> tuple[int, int, int, int]:
    """Return (channels, sampwidth, rate, frames) or raise VoiceError."""
    try:
        with wave.open(io.BytesIO(audio), "rb") as w:
            return (
                w.getnchannels(),
                w.getsampwidth(),
                w.getframerate(),
                w.getnframes(),
            )
    except (wave.Error, EOFError) as exc:
        raise VoiceError(
            "not a readable WAV file: upload mono 16-bit WAV at 16 or 24 kHz"
        ) from exc


def transcribe_audio(
    audio: bytes,
    language: str | None = None,
    keywords: str | None = None,
) -> tuple[str, int]:
    """Validate the WAV contract, transcribe, return (text, duration_ms).

    `language` is "en" | "es" | None; `keywords` a comma-separated string.
    Raises VoiceError on invalid input.
    """
    if not audio:
        raise VoiceError("empty audio bytes: record a clip first")
    channels, sampwidth, rate, frames = _wav_params(audio)
    if channels != 1:
        raise VoiceError(
            f"stereo not supported: upload mono audio, got {channels} channels"
        )
    if sampwidth != 2:
        raise VoiceError(
            f"only 16-bit PCM supported, got {sampwidth * 8}-bit"
        )
    if rate not in _SAMPLE_RATES:
        raise VoiceError(
            f"sample rate must be 16 or 24 kHz, got {rate / 1000:g} kHz"
        )
    if language is not None and language not in _LANGUAGE_BIAS:
        raise VoiceError(f"language must be 'en' or 'es', got {language!r}")

    if _mme_client is None:
        raise RuntimeError("mme.client not available: install the harness or mock in tests")
    mme = _mme_client()
    response: dict[str, Any] = mme.transcribe(
        audio,
        tag=TAG,
        language_bias=_LANGUAGE_BIAS[language] if language else None,
        keywords=split_keywords(keywords) or None,
    )
    duration_ms = response.get("audioDurationMs")
    if duration_ms is None:
        duration_ms = round(frames / rate * 1000)
    return mme.transcript_text(response), int(duration_ms)
