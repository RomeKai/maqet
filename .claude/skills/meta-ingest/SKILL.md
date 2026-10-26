---
name: meta-ingest
description: Input side of Maqet - the three capture modes (A AR measure with WebXR, B room photo with tap measurements, C hand-drawn sketch with written measurements read by Muse Spark vision and solved per wall), per-wall measurement provenance, corner correction, Spanish-first push-to-talk with Muse Voice Transcribe, and (P1) SAM 3.1 opening widths from wall photos. Use when building server/intake or web/src/intake (and the measure UI).
---

# Capture: three modes, one Scene with a measurement per wall (ADR-025, ADR-022)
Every mode ends in the same place: walls in meters, each with a **provenance**. The AI proposes, the human corrects, and
deterministic code does the geometry (ADR-002). A single global scale factor is **not** used: real hand sketches are not
drawn to proportion (ADR-025 supersedes the single-scale approach of ADR-007).

| Mode | Where | Wall length comes from | Provenance |
|---|---|---|---|
| **A. AR measure** (primary demo path) | Android Chrome + ARCore, HTTPS | 3D tap points in meters (WebXR `immersive-ar` + `hit-test`) | `measured_ar` |
| **B. Room photo + taps** | any phone, iPhone included | two taps on a photo + a typed length | `measured_tape` |
| **C. Sketch + written measurements** | any phone, no site visit | each wall's own written length, read by Spark, solved per wall | `written_on_sketch` |
| none | n/a | geometry as drawn | `estimated` |

Provenance is a per-wall field in the Scene (`server/scene`): `measured_ar | measured_tape | written_on_sketch | estimated`.
Show it in the UI (corner editor, 3D) and label estimated quantities in the takeoff. Contradictions and `estimated` walls
are surfaced to the technician; they never block, they warn.
Integration rule: capture is only done when it runs through `POST /intake` (multipart image + `kind`, replay by default) and
the web calls it via `VITE_API_URL` from a mounted `IntakeScreen`. Test the route, not only the pieces.

## Mode C: sketch or plan photo (fallback; also reads clean plans)
Two input kinds, same pipeline: a drawn **plan**, or a **hand-drawn sketch (croquis)** of the family's home with a few tape
measurements written on it (the common case: families have no plans). Sketches are noisier: wobbly lines, corners not
square, varied handwriting, **not to proportion**. The model proposes; the technician always corrects.
1. Phone camera / file upload (JPEG/PNG/PDF page). Client-side: downscale to ≤ 2048 px and fix EXIF rotation. Optional
   perspective correction: the user taps the 4 corners of the paper.
2. `server/intake/read_plan.py`: Spark 1.3 vision with a strict JSON schema, in **normalized image coordinates** (0..1):
   `{input_kind: "plan"|"sketch", walls: [{a, b, kind?}], openings: [{wall_index, t0, t1, kind}], labels: [{text, at}], dimensions: [{text, a, b}]}`.
   `dimensions` carries the **written measurements** ("3,50", "2.80 m": comma or point decimals) with the wall or span they
   refer to; the model transcribes them and never invents one. Pydantic validation; 1 retry with the validation error;
   then fail loudly.
3. Clean-up (deterministic, shapely): snap endpoints within 2% of image width (sketches may need a looser, tested tolerance),
   merge collinear segments, close loops, polygonize rooms, attach labels to rooms, and **attach each written dimension to
   its wall** (by `wall_index` when the model gives one, else the wall nearest to the dimension's `a`/`b`).
4. **Per-wall solver** (deterministic, `server/intake/` or `server/scene/`): treat each measured wall as a length
   constraint and adjust vertex positions (least squares, topology and connectivity preserved, sketch angles as soft
   targets; a global scale is only the initial guess) so walls match their lengths. Walls without a measurement stay as
   drawn and are flagged `estimated`. **Contradictions** (e.g. opposite sides of a room that do not close; residual above
   ~3%) are flagged to the technician as warnings. Test it on a deliberately **non-proportional** sketch fixture with ground
   truth, so a regression to one global factor fails a test.
5. Until the technician confirms the measurements, `scene.scale_confirmed = false` and DXF export is blocked with a clear
   message. Estimated walls stay labelled after confirmation.
6. Corner editor (web/src/intake): draggable endpoints, add/remove wall, mark door/window, type or fix a wall's length.
   Every edit is a Scene op.

Cost: one vision call per plan or sketch, ~3-5k input + ~1-2k output on draft tier. Fixtures: the demo inputs (a plan, a
hand-drawn sketch with written measurements, a **non-proportional** sketch, a site photo), each with a `*.truth.json`,
regenerated during the event (`docs/PLAN.md` Day 1 names the locations); their model responses go in `samples/replay/`.
Measure intake with wall/room IoU, per-wall length error and opening count against the truth, per input kind.
Baseline (2026-10-26): openings exact on clean/photo plans (8/8, 12/12), 2 of 5 on the hand sketch; written dimensions read
correctly everywhere.

## Mode B: room or wall photo + tap measurements (any phone)
- The technician photographs a room or wall, taps two points and types a length (accept "3,50" and "3.50"); taps a window or
  door and types its width. Each annotated length is attached to a wall the technician selects or creates in the plan
  view, and gets provenance `measured_tape`.
- A photo plane also yields a px-per-meter for that wall, which the P1 SAM step uses for opening widths.
- Works on iPhone and Android; it is the fallback if WebXR fails on the demo device, so it must be demo-quality on its own.
- Component logic (point math, length parsing, attach-to-wall) in pure functions with unit tests; touch behavior needs a
  real-phone pass (HARDENING I13).

## Mode A: AR measure with WebXR (Android Chrome + ARCore): primary demo path
- Flow: the technician points the phone at the floor and taps each room corner in an AR view (`immersive-ar` + `hit-test`);
  each tap is a 3D point in meters, so walls come out measured with no scale guessing (provenance `measured_ar`).
  Ceiling height: one tap at the ceiling, or the 2.60 m default. Precision target: a few centimeters.
- **Feature-detect** with `navigator.xr.isSessionSupported('immersive-ar')`; where unsupported (iPhone Safari, desktop) hide
  the button and offer modes B/C. Request the session from a user gesture with `requiredFeatures: ['hit-test']`
  (`dom-overlay` optional for the HUD); use a `local-floor` reference space.
- **HTTPS is mandatory (secure context).** `http://192.168.x.x:5173` over the LAN will not run WebXR. Serve the dev web with
  `@vitejs/plugin-basic-ssl` + `vite --host` (accept the self-signed certificate on the phone) or use a tunnel. Camera and
  mic need the same.
- **First step on the Mode A day, before any of our code:** verify the phone supports WebXR AR (Chrome + Google Play
  Services for AR) with the official immersive-web hit-test sample. If it fails on the demo device, the demo uses Mode B.
- Pure functions for the geometry (taps -> ordered corners -> walls in the Scene), tested without a device; the XR session
  code stays thin and behind feature detection. Tap on floor corners; the Scene stores wall centerlines, so wall thickness
  is applied by a deterministic offset (decide and test it in implementation). Precision depends on light and floor
  texture: show tracking state and let the technician re-tap.
- iPhone AR measuring / LiDAR needs a native shell (Capacitor + ARKit/RoomPlan): roadmap, not hackathon.

# Push-to-talk (P0, Spanish first)
- Hold-to-record in the PWA (MediaRecorder; webm/opus on Android, mp4/aac on iOS). Send the file to
  `POST /v1/asr/transcribe` (`muse-voice-transcribe-1.0`, $0.18/h) with Spanish (es-AR) as the expected language; English also works. The text goes to
  the reform agent as a normal user turn.
- Show the transcript before sending, so the user can edit it. Realtime WebSocket is P2.

# SAM 3.1 (P1): opening widths from wall photos
Upload via `/v1/files`, then `/v1/responses` with `sam-3.1` (read the API reference for the exact body). Use case: segment
**doors and windows in wall photos**. With the wall already measured (mode A or B), the opening's width is its mask extent
along the wall times the photo's meters-per-pixel for that wall plane. This targets the measured weakness (sketch openings
2 of 5) and is shown to the technician to confirm; oblique photos distort widths, so label the result approximate until
confirmed. Spark vision stays for sketches and labels. Not for finishes or furniture (decorating is out of scope, ADR-022).
Cut path: manual openings (mark door/window in the editor).
Record cost via `client().record(model="sam-3.1", cost_usd=providers.unit_cost("sam-3.1", n), tag="sam")`.
Never put photos with people's faces in samples. Photos of a family's home are personal data: demo inputs only, with permission.
Reference-object scale from a room photo (A4 sheet, standard door) with SAM 3.1 masks is cut (CUTLIST): about 5-10% error.
