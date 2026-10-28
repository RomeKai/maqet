# Demo script: the story of Rosa (3:00)

Source of truth for the recorded video. Product: [`PRODUCT.md`](PRODUCT.md). Decisions: [`DECISIONS.md`](DECISIONS.md)
(ADR-014 stages, ADR-025 capture modes, ADR-026 locale). If the product changes, change this file in the same commit.

**Format.** Spoken in Spanish, English subtitles (the jury reads English; the family speaks Spanish). The app UI is in
English by default (ADR-026); the es-AR switch is shown once, in the Reform beat. The narration lines below are the
subtitle text. Record in `MME_MODE=replay` so the take is reproducible and costs $0.

**Rules for the take**
- Show only features built during the event. Anything not working on the day is cut, never faked (see "If a beat is not ready").
- Reach the agent, the construction rules and a deliverable early. Capture is the door, not the product (HARDENING D1: the
  official rules ban "simple image analyzers"; a video that is only "photo in, plan out" reads as one).
- Every output on screen carries its **Preliminary** label. Never say "certified", "approved" or "safe".

## Timeline

| Time | Stage | On screen | Narration (English subtitles) |
|---|---|---|---|
| 0:00 to 0:08 | Disclosure | Black card, then the app logo. The sentence is spoken **and** on screen for the whole beat | "Planning docs and agent tooling were prepared before kickoff; all code you'll see was built this week." |
| 0:08 to 0:20 | Hook | Rosa's house, photographed. Quick cut to the **end product**: the staged material list and the DXF open in a CAD viewer | "Rosa saved for two years to add a room. About four million people in Argentina build their homes like this, one stage at a time. This is what she leaves with today." |
| 0:20 to 0:40 | **1. Capture, Mode A** (primary) | Android phone, screen recorded in AR. Tap four floor corners: teal reticle, dots, rubber-band with live lengths in meters. One ceiling tap. Tap a door and a window on the traced wall. Confirm: "Measured" badge, wall provenance `measured_ar` | "The technician walks the room and taps each corner. Every wall comes out in meters. Nothing is guessed." |
| 0:40 to 0:50 | **1. Capture, Mode C** (fallback, short cutaway) | `croquis_nonproportional.png` on the phone, Spark's proposed walls, per-wall lengths applied, one wall flagged *estimated* | "No site visit? A hand sketch works too. Each wall takes its own written length, because real sketches are never to scale." |
| 0:50 to 1:30 | **2. Reform** (hero beat) | Hold the mic, say it in Spanish: *"agregá un dormitorio para mi hija al lado de la cocina"*. Transcript appears, tool calls scroll (`add_room`, `add_opening`), the 3D view grows the room. A rule warning shows (ventilation or minimum side). Then: *"y agregá un segundo piso"* returns the **needs a licensed professional** flag, no edit applied. One tap flips the UI to es-AR | "She just asks, in her own language. The agent can only change the home through validated tools, checked against construction rules. And when something needs an engineer, it says so and refuses to guess." |
| 1:30 to 1:40 | **3. Design** (light; cut first if over time) | A bed and a door swing placed in the new room: it fits | "A basic usability check: does the bed fit, does the door swing." |
| 1:40 to 2:05 | **4. Present** | Phone on a table: the AR maquette (model-viewer) of the home with the new room. Then the Muse Image render of the finished room, labelled as a render | "Rosa sees her extension on her own table, and a picture of how it could look. The family keeps a read-only link." |
| 2:05 to 2:40 | **5. Deliver** | Staged takeoff table: foundations, walls, bond beams and roof, openings, finishes, with bricks, cement bags, sand, steel, sheets. Estimated quantities labelled. CSV download. DXF opened in a CAD viewer: AIA layers, measured dimensions | "The design becomes a shopping list per construction stage, so the family buys as it saves. And a measured DXF for the professional who will sign." |
| 2:40 to 3:00 | Limits and roadmap | Takeoff screen with the **Preliminary** banner; title card with roadmap | "Maqet is preliminary. It never certifies structure and never ships prices. Next: rules reviewed per jurisdiction, recipes validated with builders, a version for NGO and municipal programs." |

Beats add up to 180 s (8 + 12 + 30 + 40 + 10 + 25 + 35 + 20).

**Deviation from `PRODUCT.md`.** The product doc places Reform at 1:00 and Present at 1:45. This script starts Reform at 0:50
and opens on the end product at 0:08 so the agent and a deliverable appear before the one-minute mark (HARDENING D1).
Tradeoff: Capture gets 30 s instead of 35 s. If the AR beat needs more air, take it from Design, not from Reform.

## Pre-flight (the day of recording)

1. `git status` clean on `main`, `mme gate` green (the human runs it).
2. Server in replay: `MME_MODE=replay uvicorn server.api:app --host 0.0.0.0 --port 8000`.
3. Web over HTTPS: `cd web && npm run dev`; open `https://<laptop-ip>:5173` on the Android phone and accept the
   certificate. WebXR `immersive-ar` needs a secure context (ADR-025, HARDENING I14).
4. Confirm AR with the manual checklist in [`HARDENING.md`](HARDENING.md) ("Manual AR checklist"), on the demo phone.
5. Confirm the upload works from the phone browser (HARDENING I17: one HTTPS origin, `/api` proxy).
6. Confirm replay fixtures exist for every Meta call in the script (intake, transcribe, reform, render). A replay miss
   returns a loud 409; fix it before recording, never during.
7. UI locale is `en`; the es-AR switch works; no missing keys.
8. Inputs ready in [`samples/`](../samples): `plans/croquis_nonproportional.png` (Mode C cutaway),
   `audio/reform_es.wav` (voice fallback if the live mic is noisy), `plans/plano_48m_1ambiente.png` (backup).
9. Disclosure card rendered; subtitle file (SRT) matches the table above.
10. Do one full dry run with a stopwatch. Target 2:50, never above 3:00.

## Fallback matrix

| What breaks | Do this | Cost in the story |
|---|---|---|
| WebXR fails on the demo phone (no ARCore, no HTTPS, bad tracking) | **Mode B**: room photo, tap two points, type the length. Same Scene, provenance `measured_tape` (ADR-025) | The "walk the room" shot becomes a photo and two taps |
| Mode B also unavailable | **Mode C** only: sketch with written measurements, per-wall solver, *estimated* flags visible | Capture is no longer measured on site; say so |
| iPhone is the only device | Modes B and C (Safari has no WebXR); AR maquette still works through Quick Look | No AR measuring shot |
| Live mic or noisy room | Play `samples/audio/reform_es.wav` through the same transcribe path | None visible |
| Agent is erratic live | Record from replay (the committed fixtures); never improvise a prompt on camera | None |
| Muse Image render fails or is slow | Show the 3D view and the AR maquette; drop the render from the take | Present loses its second shot |
| AR maquette fails on one phone | Use the other phone (ADR-012); worst case, the 3D view | Less wow, same message |
| Over time | Cut in this order: Design beat, Mode C cutaway, second reform request | The story still reaches a deliverable |

## If a beat is not ready

Features still open on 2026-10-28 (see README "What you can run today"): the reform agent route, the staged takeoff, the
AR maquette, the Muse Image render and the share link. Rule: **if it is not in `main` and green at freeze (Mon Nov 2), the
beat is rewritten, not faked.** In order of preference: shorten the beat, replace it with the closest working output (3D view
instead of AR maquette), or state it as roadmap in the 2:40 beat. The product's non-negotiables are, in order: per-wall
measured capture, the agent with rules and professional flags, the AR maquette, the staged takeoff and the DXF.

## Honesty checklist (read before export)

- [ ] The disclosure sentence is spoken and on screen at 0:00.
- [ ] Nothing shown is mocked or pre-rendered by hand; replay fixtures are real recorded outputs.
- [ ] "Preliminary" is visible on the takeoff and the DXF notes.
- [ ] The licensed-professional flag appears at least once, and the video says Maqet does not certify structure.
- [ ] Imagined or concept items, if any, are labelled `concept`.
- [ ] No prices on screen. No real family's data: only synthetic or consented inputs.
- [ ] The word "Meta" is on screen with the model names in the Reform or Capture beat (see README, "How Meta models are used").
