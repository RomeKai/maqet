# Demo script: the story of Rosa (3:00)

Source of truth for the recorded video. Product: [`PRODUCT.md`](PRODUCT.md). Decisions: [`DECISIONS.md`](DECISIONS.md)
(ADR-014 stages, ADR-025 capture modes, ADR-026 locale). If the product changes, change this file in the same commit.

**Format.** Spoken in Spanish, English subtitles (the jury reads English; the family speaks Spanish). The app UI is in
English by default (ADR-026); the es-AR switch is shown once, in the Reform beat. The narration lines below are the
subtitle text. Record in `MME_MODE=replay` so the take is reproducible and costs $0.

**Rules for the take**
- The video **opens** with one line stating what was pre-existing and what was built this week (organizers' reply, saved in
  `docs/evidence/`). Nothing comes before it. Keep the wording in sync with the README "Built during the hackathon".
- Show only features built during the event. Anything not working on the day is cut, never faked (see "If a beat is not ready").
- Reach the agent, the construction rules and a deliverable early. Capture is the door, not the product (HARDENING D1: the
  official rules ban "simple image analyzers"; a video that is only "photo in, plan out" reads as one).
- Every output on screen carries its **Preliminary** label. Never say "certified", "approved" or "safe".

## Timeline

| Time | Stage | On screen | Narration (English subtitles) |
|---|---|---|---|
| 0:00 to 0:10 | Opening line (mandatory) | Black card with the line (nothing before it), then the app logo. The line is spoken **and** on screen for the whole beat | "Before the event: planning docs, agent skills and my open-source MME harness. Everything you'll see in Maqet was built this week." |
| 0:10 to 0:22 | Hook | Rosa's house, photographed. Quick cut to the **end product**: the staged material list and the DXF open in a CAD viewer | "Rosa saved for two years to add a room. About four million people in Argentina build their homes like this, one stage at a time. This is what she leaves with today." |
| 0:22 to 0:52 | **1. Capture, Mode C** (primary) | `croquis_nonproportional.png` on the phone, Spark's proposed walls, per-wall lengths applied, one wall flagged *estimated*. The technician taps *Looks right* on the Check step | "The technician starts from the family's hand sketch. Each wall takes its own written length, because real sketches are never to scale. Nothing is guessed: what is estimated says so." |
| 0:52 to 1:32 | **2. Reform** (hero beat) | Hold the mic, say it in Spanish: *"agregá un dormitorio para mi hija al lado de la cocina"*. Transcript appears, tool calls scroll (`add_room`, `add_opening`), the 3D view grows the room. A rule warning shows (ventilation or minimum side). Then: *"y agregá un segundo piso"* returns the **needs a licensed professional** flag, no edit applied. One tap flips the UI to es-AR | "She just asks, in her own language. The agent can only change the home through validated tools, checked against construction rules. And when something needs an engineer, it says so and refuses to guess." |
| 1:32 to 1:40 | **3. Design** (light; cut first if over time) | Ask the agent to furnish the new room: a bed appears in the 3D view and it fits | "A basic usability check: does the bed fit in the room." |
| 1:40 to 2:05 | **4. Present** | The *In real life* render of the room, labelled as a render. Then the phone on a table: the AR maquette of the home with the new room | "Rosa sees a picture of how the room could look, and her extension on her own table." |
| 2:05 to 2:40 | **5. Deliver** | Staged takeoff table: foundations, walls, bond beams and roof, openings, finishes, with bricks, cement bags, sand, steel, sheets. Estimated quantities labelled. CSV download. DXF opened in a CAD viewer: AIA layers, measured dimensions | "The design becomes a shopping list per construction stage, so the family buys as it saves. And a measured DXF for the professional who will sign." |
| 2:40 to 3:00 | Limits and roadmap | Takeoff screen with the **Preliminary** banner; title card with roadmap | "Maqet is preliminary. It never certifies structure and never ships prices. Next: rules reviewed per jurisdiction, recipes validated with builders, a version for NGO and municipal programs." |

Beats add up to 180 s (10 + 12 + 30 + 40 + 8 + 25 + 35 + 20).

**Deviation from `PRODUCT.md`.** The product doc places Reform at 1:00 and Present at 1:45, with AR measuring as the primary capture. This script starts Reform at 0:52,
opens on the end product at 0:10 so the agent and a deliverable appear before the one-minute mark (HARDENING D1), and uses Mode C because it works on any phone.
Tradeoff: Capture gets 30 s instead of 35 s. If it needs more air, take it from Design, not from Reform.

## Pre-flight (the day of recording)

1. `git status` clean on `main`, `mme gate` green (the human runs it).
2. Server in replay: `MME_MODE=replay uvicorn server.api:app --host 0.0.0.0 --port 8000`.
3. Web over HTTPS: `cd web && npm run dev`; open `https://<laptop-ip>:5173` on the Android phone and accept the
   certificate. WebXR `immersive-ar` needs a secure context (ADR-025, HARDENING I14).
4. Update Google Play Services for AR and Chrome on the demo phone, then confirm the AR maquette on a table. WebXR works; Scene Viewer failed on our test phone.
5. Confirm the upload works from the phone browser (HARDENING I17: one HTTPS origin, `/api` proxy).
6. Confirm replay fixtures exist for every Meta call in the script (intake, transcribe, reform, render). A replay miss
   returns a loud 409; fix it before recording, never during.
7. UI locale is `en`; the es-AR switch works; no missing keys. Do not press Cancel during a take: the server may still store a cancelled turn.
8. Inputs ready in [`samples/`](../samples): `plans/croquis_nonproportional.png` (Mode C cutaway),
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

As of 2026-11-02 all beats exist in `main`. Still to confirm on the demo phone: *In real life* with the guide image, and the replay
fixtures for the agent turns in this script. Rule: **anything that fails on the phone is rewritten, not faked.** In order of preference: shorten the beat, replace it with the closest working output (3D view
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
