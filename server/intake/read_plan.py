"""Vision plan/sketch reading: image bytes -> validated IntakeProposal.

One Spark vision call per image on the draft tier, with a strict JSON schema in
NORMALIZED image coordinates (0..1). The model transcribes written measurements
verbatim (comma or point decimals); it never invents one. Scale math (px -> m)
is F2 -- this module only carries `dimensions` through validated.

Prompt layout follows the cache rule: stable system prompt first, variable
image last, plus a stable `prompt_cache_key` per pipeline.
"""

from __future__ import annotations

import base64
import io
from typing import Any

from pydantic import ValidationError
from server.intake.schemas import InputKind, IntakeProposal

TAG = "plan->walls"
PROMPT_CACHE_KEY = "intake-v1"
# Contributor tier reasons 6-8k tokens before answering; anything smaller ends
# with finish_reason=length and an empty response (EmptyResponse). Plan intake
# needs headroom above that.
MAX_TOKENS = 16384
# Same cap as the web client: longest side downscaled to fit before sending.
MAX_SIDE_PX = 2048
MAX_ATTEMPTS = 2  # initial call + 1 retry carrying the validation error text

SYSTEM_PROMPT = (
    "You read a photo of a floor plan or a hand-drawn home sketch (croquis) "
    "and transcribe its geometry as JSON.\n"
    "Coordinates are NORMALIZED image fractions in 0..1: x grows right, "
    "y grows DOWN from the top-left corner of the image.\n"
    "Return a JSON object with exactly these keys:\n"
    '- input_kind: "plan" for a clean drawn plan, "sketch" for a hand-drawn croquis.\n'
    "- walls: [{a:[x,y], b:[x,y], kind}] wall segment endpoints. "
    'kind is "exterior" or "interior" only when evident, else omit it.\n'
    "- openings: [{wall_index, t0, t1, kind}] doors and windows as fractions "
    't0..t1 along the wall from a to b. kind is "door" or "window".\n'
    "- labels: [{text, at:[x,y]}] room names or notes with their position.\n"
    '- dimensions: [{text, a:[x,y], b:[x,y]}] WRITTEN measurements: transcribe '
    'the text VERBATIM, e.g. "3,50" or "2.80 m". Transcribe only measurements '
    "actually written on the image. NEVER invent one.\n"
    "Rules: every coordinate in 0..1. Every wall_index must exist. t0 <= t1. "
    "Sketches have wobbly lines: follow the drawn segments, "
    "do not straighten them into perfect rectangles."
)


class ReadPlanError(RuntimeError):
    """Raised when the vision proposal is unusable. Never silently empty."""


def _sniff_mime(image_bytes: bytes) -> str:
    if image_bytes.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if image_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    # Phone cameras upload JPEG; the client downscales to JPEG before sending.
    return "image/jpeg"


def downscale_image(image_bytes: bytes, max_side: int = MAX_SIDE_PX) -> bytes:
    """Fit the longest side to `max_side` px (same cap as the web client).

    Small images pass through untouched. Large ones are resized with LANCZOS
    and re-encoded as JPEG; normalized 0..1 coordinates are unaffected.
    """
    from PIL import Image

    with Image.open(io.BytesIO(image_bytes)) as img:
        img = img.convert("RGB")
        if max(img.size) <= max_side:
            return image_bytes
        img.thumbnail((max_side, max_side), Image.LANCZOS)
        out = io.BytesIO()
        img.save(out, format="JPEG", quality=88)
        return out.getvalue()


def _build_messages(
    image_b64: str,
    mime: str,
    input_kind: InputKind,
    validation_error: str | None = None,
) -> list[dict[str, Any]]:
    parts: list[dict[str, Any]] = []
    if validation_error is not None:
        parts.append(
            {
                "type": "text",
                "text": (
                    "Your previous answer failed validation with this error:\n"
                    f"{validation_error}\n"
                    "Return the full corrected JSON object."
                ),
            }
        )
    parts.append(
        {
            "type": "text",
            "text": (
                f"This image is a {input_kind}. "
                "Transcribe its walls, openings, labels and written dimensions."
            ),
        }
    )
    parts.append(
        {
            "type": "image_url",
            "image_url": {"url": f"data:{mime};base64,{image_b64}"},
        }
    )
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": parts},
    ]


def read_plan(image_bytes: bytes, input_kind: InputKind) -> IntakeProposal:
    """Run the vision call and return the validated proposal.

    Downscales the image to MAX_SIDE_PX before sending (same cap as the web
    client). The caller owns `input_kind` (it knows what was uploaded), so the
    returned proposal carries the requested kind; the model echo only satisfies
    the strict JSON schema. Raises ReadPlanError on empty input or when both
    attempts fail validation.
    """
    if input_kind not in ("plan", "sketch"):
        raise ReadPlanError(
            f"input_kind must be 'plan' or 'sketch', got {input_kind!r}"
        )
    if not image_bytes:
        raise ReadPlanError("empty image bytes")

    # Lazy import: this module stays importable (and test-collectible) without
    # the harness installed; only the live call needs mme.client.
    from mme.client import client

    resized = downscale_image(image_bytes)
    mime = _sniff_mime(resized)
    image_b64 = base64.b64encode(resized).decode("ascii")
    validation_error: str | None = None
    for _ in range(MAX_ATTEMPTS):
        data = client().chat_json(
            _build_messages(image_b64, mime, input_kind, validation_error),
            json_schema=IntakeProposal.model_json_schema(),
            tier="draft",
            tag=TAG,
            prompt_cache_key=PROMPT_CACHE_KEY,
            max_tokens=MAX_TOKENS,
        )
        try:
            proposal = IntakeProposal.model_validate(data)
        except ValidationError as exc:
            validation_error = str(exc)
            continue
        return proposal.model_copy(update={"input_kind": input_kind})
    raise ReadPlanError(
        "vision proposal failed validation after "
        f"{MAX_ATTEMPTS} attempts: {validation_error}"
    )
