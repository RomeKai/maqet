"""Minimal FastAPI surface — Fase 4 Día 1.

Deterministic only: request bodies validate through the pydantic Scene
(ADR-002); no Meta calls here. CORS is wide open for local dev only.

Run from the repo root:
    py -m uvicorn server.api:app --port 8000
"""

from __future__ import annotations

import io
import logging
import re
import secrets
import tempfile
from dataclasses import asdict
from pathlib import Path
from typing import Any, Literal, cast

from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from server.agent import edit_tools
from server.agent.executor import execute
from server.agent.loop import ReformClient, run_turn
from server.agent.tools import SelectedRef
from server.db import load_project, save_project
from server.export.dxf import ScaleNotConfirmedError, export_dxf
from server.export.takeoff import Takeoff, compute_takeoff, to_csv
from server.intake.cleanup import ScaleError, build_scaled_plan, to_scene
from server.intake.read_plan import ReadPlanError, read_plan
from server.intake.replay import ReplayMiss, load_sample
from server.intake.schemas import InputKind, IntakeProposal
from server.intake.voice import VoiceError, transcribe_audio
from server.render.snapshot import render_snapshot
from server.scene.models import Scene
from server.scene.ops import OpRecord
from server.scene.validation import ValidationReport, validate_scene
from server.scene.variants import (
    Branch,
    Project,
    choose,
    create_variant,
    materialize,
    undo_in_branch,
)

logger = logging.getLogger(__name__)

app = FastAPI(title="Maqet API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
    """Last-resort 500: preliminary label, CORS preserved explicitly.

    CORSMiddleware skips `allow_origins=["*"]` when the handler raises before
    `send` completes, so the header is set here too: an unhandled error must
    still reach the phone webview as JSON, not as an opaque CORS failure.
    """
    logger.exception("unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={
            "detail": (
                "Preliminary: something unexpected failed on the server; "
                "no scene was stored. Try again or pick a recorded sample."
            )
        },
        headers={"Access-Control-Allow-Origin": "*"},
    )


# Day-2: 15 MB upload cap (client downscales to <=2048 px; advisory accept only).
_MAX_IMAGE_BYTES = 15 * 1024 * 1024

# Day-1 in-memory store: a single current Scene. Deliver (Day 5) replaces
# this with real persistence behind server.db.
_current: Scene | None = None

# Variant projects (ADR-013) persist through server.db; None = its default file.
_DB_PATH: Path | None = None


class HealthOut(BaseModel):
    status: str
    version: str


class ValidationReportOut(BaseModel):
    ok: bool
    errors: list[str] = []
    warnings: list[str] = []
    flags: list[str] = []


def _report_out(report: ValidationReport) -> ValidationReportOut:
    return ValidationReportOut(
        ok=report.ok,
        errors=list(report.errors),
        warnings=list(report.warnings),
        flags=list(report.flags),
    )


@app.get("/health", response_model=HealthOut)
def health() -> HealthOut:
    return HealthOut(status="ok", version=app.version)


@app.get("/scene", response_model=Scene)
def get_scene() -> Scene:
    if _current is None:
        raise HTTPException(status_code=404, detail="no scene stored yet")
    return _current


@app.post("/scene", response_model=Scene)
def put_scene(scene: Scene) -> Scene:
    global _current
    _current = scene
    return scene


@app.post("/scene/validate", response_model=ValidationReportOut)
def validate(scene: Scene) -> ValidationReportOut:
    return _report_out(validate_scene(scene))


SnapshotLocale = Literal["en", "es-AR"]
_SVG = "image/svg+xml"


def _svg(scene: Scene, locale: str) -> Response:
    return Response(content=render_snapshot(scene, locale=locale), media_type=_SVG)


@app.get("/scene/snapshot.svg", response_class=Response, responses={200: {"content": {_SVG: {}}}})
def get_snapshot(locale: SnapshotLocale = "en") -> Response:
    return _svg(get_scene(), locale)


@app.post("/scene/snapshot.svg", response_class=Response, responses={200: {"content": {_SVG: {}}}})
def post_snapshot(scene: Scene, locale: SnapshotLocale = "en") -> Response:
    return _svg(scene, locale)


class IntakeOut(BaseModel):
    proposal: IntakeProposal
    scene: Scene
    warnings: list[str] = []
    scale_m_per_px: float
    anchor_index: int
    anchor_meters: float


@app.post("/intake", response_model=IntakeOut)
def post_intake(
    file: UploadFile | None = File(default=None),
    kind: str = Form(...),
    anchor_index: int | None = Form(default=None),
    sample: str | None = Form(default=None),
) -> IntakeOut:
    if kind not in ("plan", "sketch"):
        raise HTTPException(
            status_code=400,
            detail="kind must be 'plan' or 'sketch': ask the human to fix the type",
        )
    if sample:
        # Replay path: no vision call, no upload bytes needed. Same downstream
        # path (build_scaled_plan -> to_scene) as the upload path.
        try:
            proposal, image_w, image_h = load_sample(sample)
        except ReplayMiss as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return _finish_intake(proposal, image_w, image_h, kind, anchor_index)
    if file is None:
        raise HTTPException(
            status_code=400,
            detail="upload a photo of the plan or sketch, or pick a recorded sample",
        )
    image_bytes = file.file.read()
    if not image_bytes:
        raise HTTPException(
            status_code=400,
            detail="empty image bytes: upload a photo of the plan or sketch",
        )
    if len(image_bytes) > _MAX_IMAGE_BYTES:
        raise HTTPException(
            status_code=400,
            detail="image too large (max 15 MB): retake the photo",
        )
    # EXIF orientation: landscape photos on Android are often stored as portrait
    # sensor pixels + EXIF orientation 6 (rotate 90 CW). The client canvas
    # already orients the image (createImageBitmap imageOrientation:"from-image"
    # + fallback readExifOrientation), so the server must agree on which side
    # is the long side — otherwise image_w/image_h are swapped and
    # build_scaled_plan stretches the plan.
    from server.intake.read_plan import oriented_size

    image_w: int | None = None
    image_h: int | None = None
    oriented = oriented_size(image_bytes)
    if oriented is not None:
        ow, oh = oriented
        image_w, image_h = ow, oh
    if image_w is None or image_h is None:
        from PIL import Image as PILImage

        try:
            with PILImage.open(io.BytesIO(image_bytes)) as img:
                image_w, image_h = img.size
        except Exception as exc:
            logger.warning("intake unreadable upload: %s", exc)
            raise HTTPException(
                status_code=400,
                detail="unreadable image: upload a valid JPEG or PNG",
            ) from exc
    try:
        proposal = read_plan(image_bytes, cast(InputKind, kind))
    except ReadPlanError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        # mme.client ReplayMiss in MME_MODE=replay: no cached vision
        # response for this upload. Duck-typed on the class name (the
        # harness is never imported at module top); genuine crashes
        # re-raise onto the 500 path.
        if type(exc).__name__ == "ReplayMiss":
            raise HTTPException(
                status_code=409,
                detail=(
                    "no recorded vision response for this upload "
                    f"({exc}): pick a recorded sample or record it in live mode"
                ),
            ) from exc
        raise
    assert image_w is not None and image_h is not None
    return _finish_intake(proposal, image_w, image_h, kind, anchor_index)


def _finish_intake(
    proposal: IntakeProposal,
    image_w: int,
    image_h: int,
    kind: str,
    anchor_index: int | None = None,
) -> IntakeOut:
    try:
        plan = build_scaled_plan(
            proposal, image_w, image_h, anchor_index=anchor_index
        )
    except ScaleError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    scene = to_scene(plan, scene_id="intake")
    global _current
    _current = scene
    logger.info(
        "intake kind=%s walls=%d anchor=%.2fm",
        kind,
        len(scene.walls),
        plan.anchor_meters,
    )
    return IntakeOut(
        proposal=proposal,
        scene=scene,
        warnings=list(plan.warnings),
        scale_m_per_px=plan.scale_m_per_px,
        anchor_index=plan.anchor_index,
        anchor_meters=plan.anchor_meters,
    )


class TranscribeOut(BaseModel):
    text: str
    duration_ms: int


@app.post("/transcribe", response_model=TranscribeOut)
def post_transcribe(
    audio: UploadFile | None = File(default=None),
    language: str | None = Form(default=None),
    keywords: str | None = Form(default=None),
) -> TranscribeOut:
    if audio is None:
        raise HTTPException(
            status_code=422,
            detail="missing audio part: upload mono 16-bit WAV at 16 or 24 kHz",
        )
    try:
        text, duration_ms = transcribe_audio(
            audio.file.read(), language=language, keywords=keywords
        )
    except VoiceError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        # mme.client ReplayMiss in MME_MODE=replay: no cached transcribe
        # response for this clip. Duck-typed on the class name (the
        # harness is never imported at module top); genuine crashes
        # re-raise onto the 500 path.
        if type(exc).__name__ == "ReplayMiss":
            raise HTTPException(
                status_code=409,
                detail=(
                    "no recorded transcribe response for this clip "
                    f"({exc}): use a recorded sample or record it in live mode"
                ),
            ) from exc
        raise
    logger.info("transcribe chars=%d duration_ms=%d", len(text), duration_ms)
    return TranscribeOut(text=text, duration_ms=duration_ms)


# --- AR model hosting -------------------------------------------------------
# Scene Viewer and Quick Look are separate apps: they cannot read the page's blob: URLs, so the web
# uploads the built GLB/USDZ here and gives <model-viewer> an https URL. Files live in a temp dir
# under an unguessable random id; this is a demo-grade store (no auth, no expiry sweep).

_AR_DIR = Path(tempfile.gettempdir()) / "maqet-ar-models"
_AR_MAX_BYTES = 15 * 1024 * 1024
# kind -> (declared content-type, magic prefix)
_AR_KINDS: dict[str, tuple[str, bytes]] = {
    "glb": ("model/gltf-binary", b"glTF"),
    "usdz": ("model/vnd.usdz+zip", b"PK"),
}
_AR_ID = re.compile(r"^[0-9a-f]{32}$")


class ArModelOut(BaseModel):
    id: str
    kind: Literal["glb", "usdz"]
    path: str


@app.post("/ar/model", response_model=ArModelOut)
async def post_ar_model(file: UploadFile | None = File(default=None)) -> ArModelOut:
    if file is None:
        raise HTTPException(status_code=422, detail="missing file part: upload a GLB or USDZ")
    declared = (file.content_type or "").split(";")[0].strip().lower()
    kind = next((k for k, (mime, _) in _AR_KINDS.items() if mime == declared), None)
    if kind is None:
        raise HTTPException(
            status_code=415, detail="content-type must be model/gltf-binary or model/vnd.usdz+zip"
        )
    data = await file.read(_AR_MAX_BYTES + 1)
    if len(data) > _AR_MAX_BYTES:
        raise HTTPException(status_code=413, detail="model larger than 15 MB")
    if not data.startswith(_AR_KINDS[kind][1]):
        raise HTTPException(status_code=415, detail=f"file content is not a valid {kind.upper()}")
    model_id = secrets.token_hex(16)
    _AR_DIR.mkdir(parents=True, exist_ok=True)
    (_AR_DIR / f"{model_id}.{kind}").write_bytes(data)
    return ArModelOut(id=model_id, kind=kind, path=f"/ar/model/{model_id}.{kind}")


@app.get("/ar/model/{name}")
def get_ar_model(name: str) -> Response:
    model_id, _, kind = name.rpartition(".")
    if kind not in _AR_KINDS or _AR_ID.match(model_id) is None:
        raise HTTPException(status_code=404, detail="model not found")
    path = _AR_DIR / f"{model_id}.{kind}"
    if not path.is_file():
        raise HTTPException(status_code=404, detail="model not found")
    return Response(content=path.read_bytes(), media_type=_AR_KINDS[kind][0])


class OpRecordIn(BaseModel):
    """One op-history entry; the client echoes it back so `undo` spans turns."""

    op: str
    args: dict[str, Any]
    before_version: int
    after_version: int
    actor: str


class AgentTurnIn(BaseModel):
    scene: Scene
    message: str = Field(min_length=1)
    stage: Literal["reform", "design", "present"]
    history: list[OpRecordIn] = []
    selected: SelectedRef | None = None
    # Persist the result into this variant (Now/A/B/C), see _persist_variant.
    variant: str | None = None
    base_scene: Scene | None = None


class AppliedOpOut(BaseModel):
    name: str
    arguments: dict[str, Any]
    flags: list[str] = []


class AgentTurnOut(BaseModel):
    scene: Scene
    reply: str
    ops_applied: list[AppliedOpOut]
    professional_flags: list[str]
    history: list[OpRecordIn]
    # Failed tool calls and rule warnings: shown to the user, never swallowed.
    tool_errors: list[str] = []
    tool_warnings: list[str] = []


def get_reform_client() -> ReformClient:
    """Production Meta client; tests override this dependency."""
    from mme.client import client

    return cast(ReformClient, client())


@app.post("/agent/turn", response_model=AgentTurnOut)
def post_agent_turn(
    body: AgentTurnIn, reform_client: ReformClient = Depends(get_reform_client)
) -> AgentTurnOut:
    history = [OpRecord(**record.model_dump()) for record in body.history]
    try:
        result = run_turn(
            body.scene, history, body.stage, body.message, reform_client, selected=body.selected
        )
    except Exception as exc:
        # Same contract as /transcribe: a turn with no recorded model
        # response in MME_MODE=replay is a 409, never a 500.
        if type(exc).__name__ == "ReplayMiss":
            raise HTTPException(
                status_code=409,
                detail=(
                    "no recorded agent response for this turn "
                    f"({exc}): use a recorded demo turn or record it in live mode"
                ),
            ) from exc
        raise
    applied = [
        AppliedOpOut(name=ev["name"], arguments=ev["arguments"], flags=ev["flags"])
        for ev in result.tool_events
        if ev["ok"]
    ]
    flags = list(result.scene.professional_flags)
    for op in applied:
        for raw in op.flags:
            code = ":".join(raw.split(":")[:2])  # drop the ':wall_id' detail
            if code not in flags:
                flags.append(code)
    _persist_variant(body.variant, body.base_scene, history)
    logger.info("agent turn stage=%s ops=%d", body.stage, len(applied))
    return AgentTurnOut(
        scene=result.scene,
        reply=result.reply,
        ops_applied=applied,
        professional_flags=flags,
        history=[OpRecordIn(**asdict(record)) for record in history],
        tool_errors=[m for ev in result.tool_events for m in ev.get("error_messages", [])],
        tool_warnings=list(
            dict.fromkeys(
                w for ev in result.tool_events if ev["ok"] for w in ev.get("warnings", [])
            )
        ),
    )


def _persist_variant(
    variant: str | None, base_scene: Scene | None, history: list[OpRecord]
) -> None:
    """Store an applied turn/edit in the active variant's op history.

    Now is the read-only baseline (``base_scene``, the Scene when Reform
    started); A/B/C each own their ops, so edits stay on their variant and
    survive switching (bug A). A different baseline means a new session: stale
    branches that carry ops are dropped, empty forks are kept.
    """
    if variant is None or base_scene is None:
        return
    try:
        project = load_project(db_path=_DB_PATH)
    except KeyError:
        project = Project(base=base_scene)
    if project.base.model_dump() != base_scene.model_dump():
        if any(branch.ops for branch in project.branches.values()):
            project = Project(base=base_scene)
        else:
            project = Project(
                base=base_scene, branches=project.branches, chosen=project.chosen
            )
    if variant not in project.branches:
        project.branches[variant] = Branch()
    project.branches[variant].ops = list(history)
    project._cache.clear()
    project.chosen = variant
    save_project(project, db_path=_DB_PATH)


_UI_EDIT_TOOLS = frozenset({*edit_tools.COMPUTE, "undo"})


class AgentEditIn(BaseModel):
    scene: Scene
    tool: str
    args: dict[str, Any] = {}
    history: list[OpRecordIn] = []
    variant: str | None = None
    base_scene: Scene | None = None


@app.post("/agent/edit", response_model=AgentTurnOut)
def post_agent_edit(body: AgentEditIn) -> AgentTurnOut:
    """One deterministic edit from the UI (tap a wall or room, type meters).

    Same executor, rules and history as an agent turn, minus the model:
    $0 and undoable like any agent change.
    """
    if body.tool not in _UI_EDIT_TOOLS:
        raise HTTPException(status_code=422, detail=f"tool {body.tool!r} is not an edit tool")
    history = [OpRecord(**record.model_dump()) for record in body.history]
    new_scene, res = execute(body.scene, history, "reform", body.tool, body.args)
    if not res.ok:
        raise HTTPException(
            status_code=422, detail="; ".join(e.message for e in res.errors)
        )
    _persist_variant(body.variant, body.base_scene, history)
    flags = list(new_scene.professional_flags)
    for raw in res.flags:
        code = ":".join(raw.split(":")[:2])
        if code not in flags:
            flags.append(code)
    return AgentTurnOut(
        scene=new_scene,
        reply="",
        ops_applied=[AppliedOpOut(name=body.tool, arguments=body.args, flags=res.flags)],
        professional_flags=flags,
        history=[OpRecordIn(**asdict(record)) for record in history],
    )


class VariantOut(BaseModel):
    label: str
    parent: str | None
    fork_at_version: int
    op_count: int
    ops: list[OpRecordIn] = []
    scene: Scene


class VariantsOut(BaseModel):
    chosen: str
    variants: list[VariantOut]


class ForkIn(BaseModel):
    label: str
    from_branch: str = "A"


class UndoIn(BaseModel):
    label: str | None = None  # defaults to the chosen branch


def _load_or_seed_project() -> Project:
    """Persisted project, or a fresh one whose branch 'A' is the current Scene."""
    try:
        return load_project(db_path=_DB_PATH)
    except KeyError:
        return Project(base=get_scene())


def _variant_out(project: Project, label: str) -> VariantOut:
    branch = project.branches[label]
    return VariantOut(
        label=label,
        parent=branch.parent,
        fork_at_version=branch.fork_at_version,
        op_count=len(branch.ops),
        ops=[OpRecordIn(**asdict(record)) for record in branch.ops],
        scene=materialize(project, label),
    )


def _variants_out(project: Project) -> VariantsOut:
    return VariantsOut(
        chosen=project.chosen,
        variants=[_variant_out(project, label) for label in sorted(project.branches)],
    )


def _require_branch(project: Project, label: str) -> None:
    if label not in project.branches:
        raise HTTPException(status_code=404, detail=f"unknown variant {label!r}")


@app.get("/variants", response_model=VariantsOut)
def get_variants() -> VariantsOut:
    try:
        return _variants_out(_load_or_seed_project())
    except HTTPException as exc:
        if exc.status_code == 404 and _current is None:  # nothing stored yet: empty list, not an error
            return VariantsOut(chosen="", variants=[])
        raise


@app.post("/variants/fork", response_model=VariantsOut)
def post_variant_fork(body: ForkIn) -> VariantsOut:
    project = _load_or_seed_project()
    _require_branch(project, body.from_branch)
    if body.label in project.branches:
        raise HTTPException(status_code=409, detail=f"variant {body.label!r} already exists")
    try:
        create_variant(project, body.from_branch, body.label)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    save_project(project, db_path=_DB_PATH)
    return _variants_out(project)


@app.post("/variants/{label}/choose", response_model=VariantsOut)
def post_variant_choose(label: str) -> VariantsOut:
    project = _load_or_seed_project()
    _require_branch(project, label)
    choose(project, label)
    save_project(project, db_path=_DB_PATH)
    return _variants_out(project)


@app.post("/variants/undo", response_model=VariantOut)
def post_variant_undo(body: UndoIn) -> VariantOut:
    project = _load_or_seed_project()
    label = body.label or project.chosen
    _require_branch(project, label)
    undo_in_branch(project, label)
    save_project(project, db_path=_DB_PATH)
    return _variant_out(project, label)


class TakeoffRequest(BaseModel):
    scene: Scene
    base_scene: Scene | None = Field(default=None, alias="base_scene")


def _takeoff_or_422(payload: dict[str, Any]) -> Takeoff:
    raw_scene = payload.get("scene")
    # Bare Scene (no wrapper) is accepted for backwards compat with older clients.
    if raw_scene is None and payload:
        # Heuristic: if payload looks like a Scene (has walls/openings/id), treat it as bare.
        if any(k in payload for k in ("id", "walls", "rooms", "furniture")):
            raw_scene = payload
    if raw_scene is None:
        raise HTTPException(status_code=422, detail="missing Scene: expected {scene: Scene} or a Scene document")
    # Validate scenes through pydantic so error detail is readable, never a 500.
    try:
        scene_obj = Scene.model_validate(raw_scene)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=422, detail=f"invalid Scene: {exc}") from exc
    base_obj: Scene | None = None
    raw_base = payload.get("base_scene")
    if raw_base is not None:
        try:
            base_obj = Scene.model_validate(raw_base)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=422, detail=f"invalid base_scene: {exc}") from exc
    return compute_takeoff(scene_obj, base=base_obj)


@app.post("/export/takeoff", response_model=Takeoff)
def post_export_takeoff(payload: dict[str, Any]) -> Takeoff:
    return _takeoff_or_422(payload)


@app.post("/export/takeoff.csv")
def post_export_takeoff_csv(payload: dict[str, Any]) -> Response:
    takeoff = _takeoff_or_422(payload)
    csv_text = to_csv(takeoff)
    return Response(
        content=csv_text,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="takeoff.csv"'},
    )


@app.post("/export/dxf")
def export_scene_dxf(scene: Scene, project_name: str = "Maqet") -> Response:
    try:
        doc = export_dxf(scene, project_name=project_name)
    except ScaleNotConfirmedError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ValueError as exc:
        # e.g. empty scene: no extents to export.
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    auditor = doc.audit()
    if auditor.errors:
        raise HTTPException(
            status_code=500, detail=f"DXF audit failed: {auditor.errors[0]}"
        )
    buf = io.StringIO()
    doc.write(buf)
    return Response(
        content=buf.getvalue().encode("utf-8"),
        media_type="application/dxf",
        headers={"Content-Disposition": 'attachment; filename="scene.dxf"'},
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("server.api:app", host="127.0.0.1", port=8000)
