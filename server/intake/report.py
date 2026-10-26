"""Offline intake report (F3): fixture proposals vs ground truth.

Runs with MME_MODE=replay ($0 spend): no network, replays the 6 F1 fixtures in
samples/replay/intake-*.json against samples/plans/*.truth.json, scaling each
fixture with its OWN image dimensions (PIL, never hardcoded).
Writes samples/replay/intake_report.json. Stdout is counts-only, no geometry.

Usage: python -m server.intake.report
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image

from server.intake.cleanup import ScaleError, build_scaled_plan
from server.intake.metrics import (
    bbox_iou,
    rooms_area_iou,
    segment_overlap_iou,
    wall_length_ratio,
)
from server.intake.schemas import IntakeProposal

REPO = Path(__file__).resolve().parents[2]
REPLAY_DIR = REPO / "samples" / "replay"
PLANS_DIR = REPO / "samples" / "plans"
REPORT_PATH = REPLAY_DIR / "intake_report.json"


def _seg_bbox(
    segs: list[tuple[tuple[float, float], tuple[float, float]]],
) -> tuple[float, float, float, float]:
    xs = [p[0] for s in segs for p in s]
    ys = [p[1] for s in segs for p in s]
    return (min(xs), min(ys), max(xs), max(ys))


def _truth_key(base: str) -> str:
    return base[:-6] if base.endswith("_photo") else base


def _eval_fixture(name: str) -> dict:
    """Evaluate one replay fixture. Pure pipeline; raises ScaleError loudly."""
    base = name[len("intake-"):]
    proposal = IntakeProposal.model_validate(
        json.loads((REPLAY_DIR / f"{name}.json").read_text(encoding="utf-8"))
    )
    with Image.open(PLANS_DIR / f"{base}.png") as img:
        img_w, img_h = img.size
    truth = json.loads(
        (PLANS_DIR / f"{_truth_key(base)}.truth.json").read_text(encoding="utf-8")
    )
    scaled = build_scaled_plan(proposal, img_w, img_h)

    fixture_segs = [(w.a, w.b) for w in scaled.walls]
    truth_segs = [(tuple(w["a"]), tuple(w["b"])) for w in truth["walls"]]
    seg = segment_overlap_iou(fixture_segs, truth_segs)
    bbox = bbox_iou(_seg_bbox(fixture_segs), _seg_bbox(truth_segs))
    length_ratio = wall_length_ratio(fixture_segs, truth_segs)
    rooms = rooms_area_iou(
        [r.polygon for r in scaled.rooms],
        [r["polygon"] for r in truth.get("rooms", [])],
    )
    return {
        "kind": proposal.input_kind,
        "image_wh": [img_w, img_h],
        "walls": len(scaled.walls),
        "truth_walls": len(truth_segs),
        "openings": len(scaled.openings),
        "truth_openings": len(truth.get("openings", [])),
        "rooms_closed": len(scaled.rooms),
        "truth_rooms": len(truth.get("rooms", [])),
        "segment_iou": round(seg["iou"], 4),
        "segment_matched_m": round(seg["matched"], 2),
        "segment_total_fixture_m": round(seg["total_a"], 2),
        "segment_total_truth_m": round(seg["total_b"], 2),
        "bbox_iou": round(bbox, 4),
        "wall_length_ratio": round(length_ratio, 4),
        "rooms_area_iou": {k: round(v, 4) for k, v in rooms.items()},
        "anchor_meters": scaled.anchor_meters,
        "scale_m_per_px": scaled.scale_m_per_px,
        "warnings": list(scaled.warnings),
    }


def _summary(files: dict[str, dict]) -> dict:
    n = len(files)
    seg = [m["segment_iou"] for m in files.values()]
    bbox = [m["bbox_iou"] for m in files.values()]
    walls = sum(m["walls"] for m in files.values())
    truth_walls = sum(m["truth_walls"] for m in files.values())
    closed = sum(m["rooms_closed"] for m in files.values())
    truth_rooms = sum(m["truth_rooms"] for m in files.values())
    return {
        "files": n,
        "walls_total": f"{walls}/{truth_walls}",
        "rooms_closed_total": f"{closed}/{truth_rooms}",
        "mean_segment_iou": round(sum(seg) / n, 4) if n else 0.0,
        "mean_bbox_iou": round(sum(bbox) / n, 4) if n else 0.0,
    }


def main() -> int:
    names = sorted(p.stem for p in REPLAY_DIR.glob("intake-*.json"))
    groups: dict[str, dict[str, dict]] = {"plan": {}, "sketch": {}}
    notes: list[str] = []
    for name in names:
        try:
            entry = _eval_fixture(name)
        except ScaleError as exc:
            notes.append(f"{name}: ScaleError, human must confirm a dimension ({exc})")
            print(f"{name}: ScaleError (see report)")
            continue
        groups[entry.pop("kind")][name[len("intake-"):]] = entry
        print(
            f"{name}: walls {entry['walls']}/{entry['truth_walls']} "
            f"rooms_closed {entry['rooms_closed']}/{entry['truth_rooms']} "
            f"seg_iou {entry['segment_iou']} bbox_iou {entry['bbox_iou']} "
            f"len_ratio {entry['wall_length_ratio']} "
            f"rooms_iou {entry['rooms_area_iou']['iou']}"
        )
    for key, files in groups.items():
        for fname, m in sorted(files.items()):
            if m["rooms_closed"] < m["truth_rooms"]:
                notes.append(
                    f"rooms_closed {m['rooms_closed']}/{m['truth_rooms']} on {fname} "
                    "(digest) — F2 pending: loop closure snap too tight"
                )
    report = {
        "plan": {"files": groups["plan"], "summary": _summary(groups["plan"])},
        "sketch": {"files": groups["sketch"], "summary": _summary(groups["sketch"])},
        "notes": notes,
    }
    REPORT_PATH.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {REPORT_PATH.relative_to(REPO)} ({len(names)} fixtures)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
