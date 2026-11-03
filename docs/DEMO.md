# Demo script: the story of Rosa (3:00)

Source of truth for the recorded video. Product: [`PRODUCT.md`](PRODUCT.md). Decisions: [`DECISIONS.md`](DECISIONS.md)
(ADR-014 stages, ADR-025 capture modes, ADR-026 locale). If the product changes, change this file in the same commit.

**Format.** Spoken in Spanish, English subtitles (the jury reads English; the family speaks Spanish). The app UI is in
English by default (ADR-026); the es-AR switch is shown once, in the Reform beat. The narration lines below are the
subtitle text. Record with the server in live mode: voice takes never hash the same, so a replay take would miss on every new recording. Identical requests are served from the MME cache for $0 (see RUNBOOK, "Record the Reform demo").

**Rules for the take**
- The video **opens** with one line stating what was pre-existing and what was built this week (organizers' reply, saved in
  `docs/evidence/`). Nothing comes before it. Keep the wording in sync with the README "Built during the hackathon".
- Show only features built during the event. Anything not working on the day is cut, never faked (see "If a beat is not ready").
- Reach the agent, the construction rules and a deliverable early. Capture is the door, not the product (HARDENING D1: the
  official rules ban "simple image analyzers"; a video that is only "photo in, plan out" reads as one).
- Every output on screen carries its **Preliminary** label. Never say "certified", "approved" or "safe".

## Timeline

Target 2:50, hard cap 3:00. "Say" is the spoken Spanish; "Subtitle" is burned in. Rosa is an illustrative family, and the
video says so ("Pensá en Rosa"): no real family, house or address appears.

### 0:00 to 0:11: opening line (mandatory, nothing before it)
- **Screen:** black card with the line, on screen for the whole beat.
- **Say:** "Antes del evento: documentos de planificación, skills de agentes y mi harness open source MME. Todo lo que van a ver de Maqet se construyó esta semana."
- **Subtitle:** "Before the event: planning docs, agent skills and my open-source MME harness. Everything you'll see in Maqet was built this week."

### 0:11 to 0:30: the problem, and where it ends
- **Screen:** a paper sketch on a table. Hard cut to the staged material list, then the DXF in a CAD viewer.
- **Say:** "Cuatro millones de personas en Argentina construyen su casa solas, por etapas, a medida que ahorran. Hay muy pocos técnicos para ayudarlas. Pensá en Rosa: quiere sumar un dormitorio, y todo lo que tiene es este dibujo. Con Maqet, un técnico le deja esto, en una sola visita."
- **Subtitle:** "Four million people in Argentina build their own homes, in stages, as they save. There are too few technicians to help them. Picture Rosa: she wants to add a bedroom, and all she has is this drawing. With Maqet, a technician leaves her this, in one visit."

### 0:30 to 0:53: 1. Capture, Mode C (the door, not the product)
- **Screen:** the phone photographs the paper sketch. Caption: "Muse Spark 1.3". Proposed walls appear with their lengths and provenance. Tap a wall, correct its length. Show one *estimated* flag. Tap *Looks right*.
- **Say:** "El técnico saca una foto. Muse Spark lee el dibujo y las medidas escritas, por una décima de centavo de dólar. Pero los croquis nunca están a escala, así que cada pared toma su propia medida. Y lo que es estimado, dice que es estimado. El técnico corrige y confirma: la IA propone, la persona decide."
- **Subtitle:** "The technician takes a photo. Muse Spark reads the drawing and the written measurements, for a tenth of a cent. But sketches are never to scale, so each wall takes its own length. What is estimated says so. The technician corrects and confirms: the AI proposes, a person decides."

### 0:53 to 1:30: 2. Reform (hero beat, the longest)
- **Screen:** hold the mic and say the first request. Caption: "Muse Voice Transcribe, Muse Wonder". The transcript appears, the validated operations show in the chat, the 3D view grows the room, a rule warning shows.
- **Request 1:** "Agregá un dormitorio de tres por cuatro para mi hija, del lado norte."
- **Say:** "Rosa lo pide en su idioma, con su voz. El agente no dibuja: solo puede cambiar la casa con herramientas validadas, y cada cambio pasa por reglas de construcción escritas en código, no en un prompt."
- **Subtitle:** "Rosa asks in her own language, with her own voice. The agent doesn't draw: it can only change the home through validated tools, and every change goes through construction rules written in code, not in a prompt."
- **Expect a flag already here:** the existing 8 m wall exceeds the 4 m span rule of thumb, so the banner shows one professional flag after this request. That is the rule working, not a bug. It goes up to two on request 2.
- **Request 2:** "Y agregá un segundo piso." The red **needs a licensed professional** flag appears. Then "Deshacé eso", and the home goes back.
- **Say:** "Y esto es lo más importante: cuando algo necesita a un profesional, lo dice. Maqet nunca certifica una estructura."
- **Subtitle:** "And this matters most: when something needs a professional, it says so. Maqet never certifies a structure."

### 1:30 to 1:48: 3. Present
- **Screen:** the *In real life* views, labelled as renders. Caption: "Muse Image". Then the phone on a real table: the AR maquette with the new room.
- **Say:** "Rosa ve cómo podría quedar el cuarto, y ve su ampliación sobre su propia mesa. La imagen sale de la geometría medida, no de la imaginación del modelo."
- **Subtitle:** "Rosa sees how the room could look, and sees her extension on her own table. The image starts from the measured geometry, not from the model's imagination."

### 1:48 to 2:18: 4. Deliver (what no pretty-picture app gives you)
- **Screen:** scroll the staged takeoff: foundations, walls, bond beams and roof, openings, finishes. Hold on bricks and cement. Show the *Preliminary* label. Then the DXF in a CAD viewer, with its layers.
- **Say:** "Y ahora lo que ninguna app de imágenes te da. Una lista de materiales por etapa, para comprar a medida que ahorra: ladrillos, cemento, arena, hierro. Y un DXF con medidas reales, para el profesional que va a revisarlo y firmarlo. Ningún modelo escribe estos números: salen de la geometría medida, con código determinista."
- **Subtitle:** "And now what no image app gives you. A material list by stage, to buy as she saves: bricks, cement, sand, steel. And a DXF with real measurements, for the professional who will review and sign it. No model writes these numbers: they come from the measured geometry, through deterministic code."

### 2:18 to 2:38: 5. How it is built (the judges' beat)
- **Screen:** one card: a single measured Scene in the center, with 3D, AR, render, takeoff and DXF derived from it; four Meta models around it, each with its bound. Then the repo for two seconds.
- **Say:** "Una sola escena medida es la fuente de verdad: el 3D, el AR, el render, los materiales y el DXF salen de ahí. Cuatro modelos de Meta trabajan alrededor, cada uno limitado por código. Casi mil quinientos tests automáticos, y todo open source."
- **Subtitle:** "One measured scene is the source of truth: 3D, AR, render, materials and DXF all derive from it. Four Meta models work around it, each bounded by code. Nearly 1,500 automated tests, all open source."

### 2:38 to 2:50: close
- **Screen:** logo, tagline, repo URL, and "Preliminary. Never a structural certification."
- **Say:** "Todo es preliminar, y lo dice. Sigue validar las reglas y recetas con constructores y programas de vivienda. Maqet: un técnico puede ayudar a muchas más familias."
- **Subtitle:** "Everything is preliminary, and says so. Next: validating rules and recipes with builders and housing programs. Maqet: one technician can help many more families."

Beats add up to 170 s (11 + 19 + 23 + 37 + 18 + 30 + 20 + 12).

**Changes from the earlier script.**
- Added the 2:18 "How it is built" beat, which answers technical depth and use of Meta models directly.
- Design no longer has its own beat. The bed check is the first thing to add back only if a take runs short.
- The second-floor request raises the flag **and applies the edit** (`server/agent/executor.py`, `add_room`), so the script undoes it on camera instead of claiming the agent refuses.
- The demo home is the 3x8 m one-room sketch, so the request names a side instead of "next to the kitchen".
- Rosa is introduced as an illustrative family.

Confirmed in the first live rehearsal (2026-11-03): the flags, undo, renders, AR and downloads work. Still to confirm on the phone after the layout fixes: the second floor in 3D, a second turn on the same variant, and the sketch reading with the new prompt. Rewrite any line the app does not back up.

**Time check.** Timings come from a word count at about 2.5 words per second, not from a read-through. Time them aloud in the dry run and trim the words, not the screen shots.

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
