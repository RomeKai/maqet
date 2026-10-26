---
name: meta-ingest
description: Input side of Maqet - plan photo to proposed walls with Muse Spark vision, corner correction and scale, push-to-talk with Muse Voice Transcribe, and (P1/P2) SAM 3.1 on reference photos. Use when building server/intake or web/src/intake.
---

# Plan intake (P0): AI proposes, the human corrects and scales (ADR-007)
1. Phone camera / file upload (JPEG/PNG/PDF page). Client-side: downscale to ≤ 2048 px and fix EXIF rotation. Optional
   perspective correction: the user taps the 4 corners of the paper.
2. `server/intake/read_plan.py`: Spark 1.3 vision with a strict JSON schema, in **normalized image coordinates** (0..1):
   `{walls: [{a, b, kind?}], openings: [{wall_index, t0, t1, kind}], labels: [{text, at}], dimensions: [{text, a, b}]}`.
   Pydantic validation; 1 retry with the validation error; then fail loudly.
3. Clean-up (deterministic, shapely): snap endpoints within 2% of image width, merge collinear segments, close loops,
   polygonize rooms, attach labels to rooms.
4. **Scale:** two taps + a typed length ("3.50 m"), or pick one of the `dimensions` Spark read. px→m = typed / pixel
   length. Until scale is confirmed, `scene.scale_confirmed = false`, and DXF export is blocked with a clear message.
5. Corner editor (web/src/intake): draggable endpoints, add/remove wall, mark door/window. Every edit is a Scene op.

Cost: one vision call per plan, ~3-5k input + ~1-2k output on draft tier. Fixtures: 3 sample plans in `samples/plans/`,
their responses in `samples/replay/`.

# Push-to-talk (P0)
- Hold-to-record in the PWA (MediaRecorder; webm/opus on Android, mp4/aac on iOS). Send the file to
  `POST /v1/asr/transcribe` (`muse-voice-transcribe-1.0`, $0.18/h). The text goes to the reform agent as a normal user turn.
- Show the transcript before sending, so the user can edit it. Realtime WebSocket is P2.

# Measuring in the field (P2 / roadmap)
- WebXR hit-test measuring works on **Android Chrome only** (Safari iOS has no WebXR). Feature-detect it and hide the
  button elsewhere.
- iPhone AR measuring / LiDAR needs a native shell (Capacitor + ARKit/RoomPlan): roadmap, not hackathon.
- Reference-object scale from a room photo (A4 sheet, standard door) with SAM 3.1 masks: P2, ~5-10% error, label as approximate.

# SAM 3.1 (P1/P2)
Upload via `/v1/files`, then `/v1/responses` with `sam-3.1` (read the API reference for the exact body). Use cases:
detect existing finishes in room photos ("wood floor", "tiles") to pre-fill materials; segment furniture to keep/remove.
Record cost via `client().record(model="sam-3.1", cost_usd=providers.unit_cost("sam-3.1", n), tag="sam")`.
Never put photos with people's faces in samples.
