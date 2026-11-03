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
video says so ("Pensá en Rosa"): no real family, house or address appears. Two messages carry the video: Maqet is for
families who cannot have an architect or a designer from day one, and each Meta model does one bounded job. Source tags:
**[HANDS]** camera on the table, **[PHONE]** phone screen recording inside a stage frame, **[PC]** laptop screen,
**[CARD]** rendered card. See "How to record".

### 0:00 to 0:11: opening line (mandatory, nothing before it)
- **Screen:** [CARD] `card-opening.png`, for the whole beat.
- **Say:** "Antes del evento: documentos de planificación, skills de agentes y mi harness open source MME. Todo lo que van a ver de Maqet se construyó esta semana."
- **Subtitle:** "Before the event: planning docs, agent skills and my open-source MME harness. Everything you'll see in Maqet was built this week."

### 0:11 to 0:33: who it is for
- **Screen:** [HANDS] a hand finishes the paper sketch on a table: walls, door, window, written measurements. Hold on the finished drawing.
- **Say:** "Cuatro millones de personas en Argentina construyen su casa con sus propias manos, por etapas, a medida que ahorran. Casi nunca hay un arquitecto o un diseñador desde el día uno, y un error se paga con sus ahorros. Pensá en Rosa: quiere sumar un dormitorio, y todo lo que tiene es este dibujo."
- **Subtitle:** "Four million people in Argentina build their homes with their own hands, in stages, as they save. An architect or a designer from day one is rarely within reach, and a mistake is paid for with their savings. Picture Rosa: she wants to add a bedroom, and all she has is this drawing."

### 0:33 to 0:42: the promise
- **Screen:** three hard cuts, three seconds each, from the finished take: [PHONE] the home in 3D, [PHONE] the material list, [PC] the DXF.
- **Say:** "Maqet convierte ese dibujo en un proyecto medido: cómo queda, qué comprar en cada etapa, y un plano para el profesional."
- **Subtitle:** "Maqet turns that drawing into a measured project: how it looks, what to buy at each stage, and a drawing for the professional."

### 0:42 to 1:00: 1. Capture (Muse Spark 1.3)
- **Screen:** [HANDS] the phone photographs the sketch. [PHONE] in `frame-capture.png`: proposed walls with their lengths and provenance, tap a wall, correct a length, one *estimated* flag, *Looks right*.
- **Say:** "Un técnico la visita con el celular. Primer modelo de Meta: Muse Spark lee el dibujo y las medidas escritas, por menos de un centavo de dólar. Cada pared toma su propia medida, y lo estimado dice que es estimado. La IA propone, la persona decide."
- **Subtitle:** "A technician visits with a phone. First Meta model: Muse Spark reads the drawing and the written measurements, for less than a cent. Each wall takes its own length, and what is estimated says so. The AI proposes, a person decides."

### 1:00 to 1:32: 2. Reform (Muse Voice Transcribe, Muse Wonder; hero beat)
- **Screen:** [PHONE] in `frame-reform.png`, with the request audio live: hold the mic, the transcript appears, the validated operations show in the chat, the 3D view grows the room.
- **Request 1 (live audio):** "Agregá un dormitorio de tres por cuatro para mi hija, del lado norte."
- **Subtitle:** "Add a three-by-four bedroom for my daughter, on the north side."
- **Say:** "Rosa lo pide con su voz. Muse Voice Transcribe la escucha, y Muse Wonder edita la casa, pero no dibuja: solo usa herramientas validadas, y cada cambio pasa por reglas de construcción escritas en código."
- **Subtitle:** "Rosa asks with her own voice. Muse Voice Transcribe hears her, and Muse Wonder edits the home, but it doesn't draw: it only uses validated tools, and every change goes through construction rules written in code."
- **Expect a flag already here:** the existing 8 m wall exceeds the 4 m span rule of thumb, so the banner shows one professional flag after this request. That is the rule working, not a bug. It goes up to two on request 2.
- **Request 2 (live audio):** "Y agregá un segundo piso." The red **needs a licensed professional** flag appears. Then "Deshacé eso", and the home goes back.
- **Subtitle:** "And add a second floor. Undo that."
- **Say:** "Y cuando algo necesita un profesional, lo dice. Maqet nunca certifica una estructura."
- **Subtitle:** "And when something needs a professional, it says so. Maqet never certifies a structure."

### 1:32 to 1:47: 3. Present (Muse Image)
- **Screen:** [PHONE] in `frame-present.png`: the *In real life* views, labelled as renders. Then [HANDS] over the shoulder: the phone on a real table with the AR maquette and the new room, walking around it.
- **Say:** "Muse Image le muestra cómo podría quedar el cuarto, partiendo de la geometría medida, no de la imaginación del modelo. Y en realidad aumentada, ve su ampliación sobre su propia mesa."
- **Subtitle:** "Muse Image shows how the room could look, starting from the measured geometry, not from the model's imagination. And in augmented reality, she sees her extension on her own table."

### 1:47 to 2:12: 4. Deliver (no model on purpose)
- **Screen:** [PHONE] in `frame-deliver.png`: scroll the staged takeoff, hold on bricks and cement, show the *Preliminary* label. Then [PC] the DXF in a CAD viewer, turning layers on and off.
- **Say:** "Y ahora lo que ninguna app de imágenes te da. Una lista de materiales por etapa, para comprar a medida que ahorra: ladrillos, cemento, arena, hierro. Y un DXF con medidas reales, para el profesional que lo revise y lo firme. Ningún modelo escribe estos números: salen de código determinista."
- **Subtitle:** "And now what no image app gives you. A material list by stage, to buy as she saves: bricks, cement, sand, steel. And a DXF with real measurements, for the professional who will review and sign it. No model writes these numbers: they come from deterministic code."

### 2:12 to 2:34: 5. How Meta's models fit (the judges' beat)
- **Screen:** [CARD] `card-architecture.png`. Then [PC] the repo for two seconds.
- **Say:** "Cuatro modelos de Meta, cada uno en su lugar: Spark lee, Voice escucha, Wonder edita, Image muestra. Y ninguno manda: una sola escena medida es la fuente de verdad, y el 3D, el AR, los materiales y el DXF salen de ahí. Más de mil quinientos tests automáticos, y todo open source."
- **Subtitle:** "Four Meta models, each in its place: Spark reads, Voice listens, Wonder edits, Image shows. And none of them is in charge: one measured scene is the source of truth, and 3D, AR, materials and DXF all derive from it. More than 1,500 automated tests, all open source."

### 2:34 to 2:50: close
- **Screen:** [HANDS] the sketch next to the phone with the finished home, two seconds. Then [CARD] `card-close.png`.
- **Say:** "Todo es preliminar, y lo dice. Maqet no reemplaza al arquitecto: le da a quien nunca pudo pagarlo un primer proyecto medido, desde el día uno. Sigue validarlo con constructores y programas de vivienda."
- **Subtitle:** "Everything is preliminary, and says so. Maqet doesn't replace the architect: it gives people who could never afford one a first measured project, from day one. Next: validating it with builders and housing programs."

Beats add up to 170 s (11 + 22 + 9 + 18 + 32 + 15 + 25 + 22 + 16).

**Time check.** Timings come from a word count at about 2.5 words per second, not from a read-through. Time them aloud in the dry run and trim the words, not the screen shots.

## How to record

**Output:** 1920x1080, 30 fps, H.264. The phone is vertical, so it sits inside a stage frame (`docs/video/frame-*.png`) that names the stage and its model. Hands and PC shots run full screen.

**Sources**

| Tag | Device | How |
|---|---|---|
| [PHONE] | The Android demo phone | Built-in screen recorder, Do Not Disturb on. Mic on only for the Reform takes. |
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
