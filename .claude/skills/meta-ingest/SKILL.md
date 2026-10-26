---
name: meta-ingest
description: Input side of Maqet - photo of a plan or hand-drawn sketch (croquis) with written measurements to proposed walls with Muse Spark vision, corner correction and scale, Spanish-first push-to-talk with Muse Voice Transcribe, and (P1) SAM 3.1 on site photos to cross-check existing walls and openings. Use when building server/intake or web/src/intake.
---

# Plan and sketch intake (P0): AI proposes, the human corrects and scales (ADR-007, ADR-022)
Two input kinds, same pipeline: a drawn **plan**, or a **hand-drawn sketch (croquis)** of the family's home with a few tape
measurements written on it (the common case: families have no plans). Sketches are noisier: wobbly lines, corners not
square, varied handwriting. The model proposes; the technician always corrects and scales.
1. Phone camera / file upload (JPEG/PNG/PDF page). Client-side: downscale to ≤ 2048 px and fix EXIF rotation. Optional
   perspective correction: the user taps the 4 corners of the paper.
2. `server/intake/read_plan.py`: Spark 1.3 vision with a strict JSON schema, in **normalized image coordinates** (0..1):
   `{input_kind: "plan"|"sketch", walls: [{a, b, kind?}], openings: [{wall_index, t0, t1, kind}], labels: [{text, at}], dimensions: [{text, a, b}]}`.
   `dimensions` carries the **written measurements** ("3,50", "2.80 m": comma or point decimals) with the wall or span they
   refer to; the model transcribes them and never invents one. Pydantic validation; 1 retry with the validation error;
   then fail loudly.
3. Clean-up (deterministic, shapely): snap endpoints within 2% of image width (sketches may need a looser, tested tolerance),
   merge collinear segments, close loops, polygonize rooms, attach labels to rooms.
4. **Scale:** two taps + a typed length ("3.50 m"), or pick one of the written `dimensions` Spark read (for a sketch, a written measurement is the natural scale source). px→m = typed / pixel
   length. Until scale is confirmed, `scene.scale_confirmed = false`, and DXF export is blocked with a clear message.
5. Corner editor (web/src/intake): draggable endpoints, add/remove wall, mark door/window. Every edit is a Scene op.

Cost: one vision call per plan or sketch, ~3-5k input + ~1-2k output on draft tier. Fixtures: the demo inputs (a plan, a
hand-drawn sketch with written measurements, a site photo), each with a `*.truth.json`, regenerated during the event
(`docs/PLAN.md` Day 1 names the locations); their model responses go in `samples/replay/`. Measure intake with wall/room
IoU and scale error against the truth, per input kind.

# Push-to-talk (P0, Spanish first)
- Hold-to-record in the PWA (MediaRecorder; webm/opus on Android, mp4/aac on iOS). Send the file to
  `POST /v1/asr/transcribe` (`muse-voice-transcribe-1.0`, $0.18/h) with Spanish (es-AR) as the expected language; English also works. The text goes to
  the reform agent as a normal user turn.
- Show the transcript before sending, so the user can edit it. Realtime WebSocket is P2.

# Measuring in the field (P2 / roadmap)
- WebXR hit-test measuring works on **Android Chrome only** (Safari iOS has no WebXR). Feature-detect it and hide the
  button elsewhere.
- iPhone AR measuring / LiDAR needs a native shell (Capacitor + ARKit/RoomPlan): roadmap, not hackathon.
- Reference-object scale from a room photo (A4 sheet, standard door) with SAM 3.1 masks: P2, ~5-10% error, label as approximate.

# SAM 3.1 (P1)
Upload via `/v1/files`, then `/v1/responses` with `sam-3.1` (read the API reference for the exact body). Use case:
segment **site photos** (existing walls, doors, windows) to cross-check the walls and openings proposed from the sketch,
and flag mismatches for the technician to review. Not for finishes or furniture (decorating is out of scope, ADR-022).
Record cost via `client().record(model="sam-3.1", cost_usd=providers.unit_cost("sam-3.1", n), tag="sam")`.
Never put photos with people's faces in samples. Photos of a family's home are personal data: demo inputs only, with permission.
