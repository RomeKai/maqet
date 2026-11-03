# Demo script: the story of Rosa (3:00)

Source of truth for the recorded video. Product: [`PRODUCT.md`](PRODUCT.md). Decisions: [`DECISIONS.md`](DECISIONS.md)
(ADR-014 stages, ADR-025 capture modes, ADR-026 locale). If the product changes, change this file in the same commit.

**Format.** English voice-over with burned-in captions. The requests to the app are spoken in Spanish with an English caption. The app UI is in English by default (ADR-026). Record with the server in live mode: voice takes never hash the same, so a replay take would miss on every new recording. Identical requests are served from the MME cache for $0 (see RUNBOOK, "Record the Reform demo").

**Rules for the take**
- The video **opens** with one line stating what was pre-existing and what was built this week (organizers' reply, saved in
  `docs/evidence/`). Nothing comes before it. Keep the wording in sync with the README "Built during the hackathon".
- Show only features built during the event. Anything not working on the day is cut, never faked (see "If a beat is not ready").
- Reach the agent, the construction rules and a deliverable early. Capture is the door, not the product (HARDENING D1: the
  official rules ban "simple image analyzers"; a video that is only "photo in, plan out" reads as one).
- Every output on screen carries its **Preliminary** label. Never say "certified", "approved" or "safe".

## Timeline

Target 2:50, hard cap 3:00. Voice-over in English; "Say" is also the burned-in caption. The requests to the app stay in
Spanish with an English caption, because the family speaks Spanish. Rosa is an illustrative family, and the video says so
("Picture Rosa"): no real family, house or address appears. Clip IDs and how to shoot each one: [`video/GUIA_DE_GRABACION.md`](video/GUIA_DE_GRABACION.md).

### 0:00 to 0:10: opening line (mandatory, nothing before it)
- **Screen:** `card-opening.png`.
- **Say:** "Before the event: planning docs, agent skills and my open-source MME harness. Everything you'll see in Maqet was built this week."

### 0:10 to 0:31: who it is for
- **Screen:** M1, a hand finishes the paper sketch.
- **Say:** "Four million people in Argentina build their own homes, in stages, as they save. An architect or a designer from day one is rarely within reach, and a mistake gets paid for with their savings. Picture Rosa. She wants to add a bedroom, and all she has is this drawing."

### 0:31 to 0:40: the promise
- **Screen:** three hard cuts from P1 and C1: the home in 3D, the material list, the DXF.
- **Say:** "Maqet turns that drawing into a measured project: how it looks, what to buy at each stage, and a drawing for the professional."

### 0:40 to 0:56: 1. Capture (Muse Spark 1.3)
- **Screen:** M2, the phone photographs the sketch. P1 in `frame-capture.png`: proposed walls, correct a length, one *estimated* flag, *Looks right*.
- **Say:** "A technician visits with a phone. First Meta model: Muse Spark reads the drawing and the written measurements, for less than a cent. What's estimated says so. The AI proposes, a person decides."

### 0:56 to 1:04: the other way in, AR measure (no model)
- **Screen:** A1 over the shoulder, A2 in `frame-measure.png`: two corners, a wall with its length, a window tap, the review sheet.
- **Say:** "No drawing? The technician measures the room in augmented reality: corners, doors and windows, with real measurements."

### 1:04 to 1:36: 2. Reform (Muse Voice Transcribe, Muse Wonder; hero beat)
- **Screen:** P1 in `frame-reform.png`: hold the mic, the transcript appears, the validated operations show in the chat, the 3D view grows the room.
- **Request 1 (Spanish, live audio):** "Agregá un dormitorio de tres por cuatro para mi hija, del lado norte."
- **Caption:** "Add a three-by-four bedroom for my daughter, on the north side."
- **Say:** "Back to Rosa. She asks in Spanish, with her own voice. Muse Voice Transcribe hears her, and Muse Wonder edits the home. But it doesn't draw: it only uses validated tools, and every change goes through construction rules written in code."
- **Expect a flag already here:** the existing 8 m wall exceeds the 4 m span rule of thumb, so the banner shows one professional flag after this request. That is the rule working, not a bug. It goes up to two on request 2.
- **Request 2 (Spanish, live audio):** "Y agregá un segundo piso." The red **needs a licensed professional** flag appears. Then "Deshacé eso", and the home goes back.
- **Caption:** "And add a second floor. Undo that."
- **Say:** "And when something needs a professional, it says so. Maqet never certifies a structure."

### 1:36 to 1:51: 3. Present (Muse Image)
- **Screen:** P1 in `frame-present.png`: the *In real life* views, labelled as renders. Then M3: the AR maquette on a real table.
- **Say:** "Muse Image shows how the room could look, starting from the measured geometry, not from the model's imagination. And in augmented reality, she sees her extension on her own table."

### 1:51 to 2:15: 4. Deliver (no model on purpose)
- **Screen:** P1 in `frame-deliver.png`: scroll the staged takeoff, hold on bricks and cement, show *Preliminary*. Then C1: the DXF, layers on and off.
- **Say:** "And now, what no image app gives you. A material list by stage, to buy as she saves: bricks, cement, sand, steel. And a DXF with real measurements, for the professional who will review and sign it. No model writes these numbers: they come from deterministic code."

### 2:15 to 2:36: 5. How Meta's models fit (the judges' beat)
- **Screen:** `card-architecture.png`. Then C2, the repo for two seconds.
- **Say:** "Four Meta models, each in its place: Spark reads, Voice listens, Wonder edits, Image shows. And none of them is in charge: one measured scene is the source of truth, and 3D, AR, materials and DXF all derive from it. More than 1,500 automated tests, all open source."

### 2:36 to 2:50: close
- **Screen:** M4, the sketch next to the phone with the finished home. Then `card-close.png`.
- **Say:** "Everything is preliminary, and says so. Maqet doesn't replace the architect. It gives people who could never afford one a first measured project, from day one."

Beats add up to 170 s (10 + 21 + 9 + 16 + 8 + 32 + 15 + 24 + 21 + 14).

**Time check.** Timings come from a word count at about 2.5 words per second, not from a read-through. Time them aloud and trim the words, not the screen shots.

## How to record

**Output:** 1920x1080, 30 fps, H.264. The phone is vertical, so it sits inside a stage frame (`docs/video/frame-*.png`) that names the stage and its model. Hands and PC shots run full screen.

**Sources**

| Tag | Device | How |
|---|---|---|
| [PHONE] | The Android demo phone | Built-in screen recorder with mic, Do Not Disturb on. Keep only the Reform requests in the edit. |
| [HANDS] | A second phone, or the laptop webcam | Landscape, on a stack of books or a tripod, by a window. Top-down for the sketch, over the shoulder for the AR table. |
| [PC] | The laptop | Win+G (Game Bar) at 1080p. DXF opened in a local viewer such as LibreCAD; never upload it. |
| Voice | Phone or earbuds mic, 15 cm from the mouth | A quiet room with soft surfaces. Three takes per beat, recorded apart from the screen. |

**Order of work**

1. Rehearse: read the script aloud with a stopwatch and fix the words.
2. Record the voice first. It sets the timing of the cut.
3. Record [PHONE] end to end in one continuous session, live, so the same home runs from sketch to DXF. Repeat until a take is clean.
4. Record [HANDS] and [PC] using the same sketch and the DXF from that session.
5. Cut the picture to the voice: put the frame on the bottom track and scale the phone video to 960 px high over the dark slot.
6. Import `subtitles.en.srt`, re-time it to the cut, and place it in the free area of the frame, lower right. On full-screen shots it goes at the bottom.

**Editing rules**

- Jump cuts only: no animated zooms, wipes or pop effects. A static crop is fine when something is hard to read.
- Cut the waits for the model, and say so: the frames carry "Waits trimmed". Never speed up or alter a result.
- Music optional: instrumental, low, under the voice. Voice around -14 LUFS.
- Check every frame before export: no `.env`, keys, notifications or browser certificate warnings on screen.

## Pre-flight (the day of recording)

1. `git status` clean on `main`, `mme gate` green (the human runs it).
2. Server in live, from the OPS terminal with `.env` loaded: `uvicorn server.api:app --host 0.0.0.0 --port 8000`.
3. Web over HTTPS: `cd web && npm run dev`; open `https://<laptop-ip>:5173` on the Android phone and accept the
   certificate. WebXR `immersive-ar` needs a secure context (ADR-025, HARDENING I14).
4. Update Google Play Services for AR and Chrome on the demo phone, then confirm the AR maquette on a table. WebXR works; Scene Viewer failed on our test phone.
5. Confirm the upload works from the phone browser (HARDENING I17: one HTTPS origin, `/api` proxy).
6. Do one full live rehearsal of every Meta call in the script (intake, transcribe, reform, render) before the takes.
7. UI locale is `en`; the es-AR switch works; no missing keys. Do not press Cancel during a take: the server may still store a cancelled turn.
8. Inputs ready: the paper sketch of the 3x8 m home; in [`samples/`](../samples), the *Try a sample* path as fallback,
   `audio/reform_es.wav` (voice fallback if the live mic is noisy), `plans/plano_48m_1ambiente.png` (backup).
9. Opening-line card rendered; subtitle file (SRT) matches the table above.
10. Do one full dry run with a stopwatch. Target 2:50, never above 3:00.

## Fallback matrix

| What breaks | Do this | Cost in the story |
|---|---|---|
| Sketch reading is off on the take | Use a recorded sample (Capture → *Try a sample*) | None visible |
| iPhone is the only device | Mode C still works; AR maquette through Quick Look | Not tested on an iPhone in this cycle: test before relying on it |
| Live mic or noisy room | Play `samples/audio/reform_es.wav` through the same transcribe path | None visible |
| Agent is erratic live | Record from replay (the committed fixtures); never improvise a prompt on camera | None |
| Muse Image render fails or is slow | Show the 3D view and the AR maquette; drop the render from the take | Present loses its first shot |
| AR maquette fails on the phone | Update ARCore and check the official model-viewer sample, or use another phone; worst case, the 3D view | Less wow, same message |
| Over time | Cut in this order: Design beat, second reform request | The story still reaches a deliverable |

## If a beat is not ready

As of 2026-11-02 all beats exist in `main`. Still to confirm on the demo phone: *In real life* with the guide image, and the
agent turns in this script, live. Rule: **anything that fails on the phone is rewritten, not faked.** In order of preference: shorten the beat, replace it with the closest working output (3D view
instead of AR maquette), or state it as roadmap in the 2:40 beat. The product's non-negotiables are, in order: per-wall
measured capture, the agent with rules and professional flags, the AR maquette, the staged takeoff and the DXF.

## Honesty checklist (read before export)

- [ ] The opening line (what was pre-existing, what was built this week) is spoken and on screen at 0:00, as the organizers require ([`evidence/organizer-reply-2026-10-28.png`](evidence/organizer-reply-2026-10-28.png)).
- [ ] Nothing shown is mocked or pre-rendered by hand; replay fixtures are real recorded outputs.
- [ ] "Preliminary" is visible on the takeoff and the DXF notes.
- [ ] The licensed-professional flag appears at least once, and the video says Maqet does not certify structure.
- [ ] Imagined or concept items, if any, are labelled `concept`.
- [ ] No prices on screen. No real family's data: only synthetic or consented inputs.
- [ ] The word "Meta" is on screen with the model names in the Reform or Capture beat (see README, "How Meta models are used").
