"""Smoke test for Muse Voice Transcribe through mme.client (live: run from the OPS terminal; replay: free).

Clips in samples/audio/ are synthetic (Windows TTS), no personal voice data.
Usage: python samples/tools/asr_smoke.py
"""
import json
from pathlib import Path

from mme.client import client

CLIPS = {
    "reform_en.wav": ["English"],
    "reform_es.wav": ["Spanish"],
}
KEYWORDS = ["Maqet", "bond beam", "encadenado"]

audio_dir = Path(__file__).resolve().parents[1] / "audio"
mme = client()
for name, bias in CLIPS.items():
    response = mme.transcribe((audio_dir / name).read_bytes(), tag="asr-smoke", language_bias=bias, keywords=KEYWORDS)
    print(f"\n== {name} ({bias[0]})")
    print("text:", mme.transcript_text(response) or "(empty: check the raw shape below)")
    print("raw :", json.dumps(response, ensure_ascii=False)[:800])
