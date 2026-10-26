"""Minimal FastAPI surface — Fase 4 Día 1.

Deterministic only: request bodies validate through the pydantic Scene
(ADR-002); no Meta calls here. CORS is wide open for local dev only.

Run from the repo root:
    py -m uvicorn server.api:app --port 8000
"""

from __future__ import annotations

import io
import logging
from typing import cast

from fastapi import FastAPI, File, Form, HTTPException, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from server.export.dxf import ScaleNotConfirmedError, export_dxf
from server.intake.cleanup import ScaleError, build_scaled_plan, to_scene
from server.intake.read_plan import ReadPlanError, read_plan
from server.intake.schemas import InputKind, IntakeProposal
from server.scene.models import Scene
from server.scene.validation import ValidationReport, validate_scene

logger = logging.getLogger(__name__)

app = FastAPI(title="Maqet API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Day-2: 15 MB upload cap (client downscales to <=2048 px; advisory accept only).
_MAX_IMAGE_BYTES = 15 * 1024 * 1024

# Day-1 in-memory store: a single current Scene. Deliver (Day 5) replaces
# this with real persistence behind server.db.
_current: Scene | None = None


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


class IntakeOut(BaseModel):
    proposal: IntakeProposal
    scene: Scene
    warnings: list[str] = []
    scale_m_per_px: float
    anchor_index: int
    anchor_meters: float


@app.post("/intake", response_model=IntakeOut)
def post_intake(
    file: UploadFile = File(...),
    kind: str = Form(...),
    anchor_index: int | None = Form(default=None),
) -> IntakeOut:
    if kind not in ("plan", "sketch"):
        raise HTTPException(
            status_code=400,
            detail="kind must be 'plan' or 'sketch': ask the human to fix the type",
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
