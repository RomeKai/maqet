# Maqet: measured technical assistance for families who build their own homes

From a hand-drawn sketch to a staged shopping list of bricks, in one visit.

**About 4 million people in Argentina build their homes themselves, room by room, as they save.** Maqet lets one
technical assistant help many more of them: measure the home, design the next room with the family, show it in AR on
their own table, and leave a construction takeoff they can buy stage by stage.

> **Demo video (3 min):** _link coming on submission day_ · **Built for** the Meta Global AI Developer Hackathon, Indie track
> · Demo script: [`docs/DEMO.md`](docs/DEMO.md) · Submission checklist: [`docs/SUBMISSION.md`](docs/SUBMISSION.md)

**Reads a hand sketch for a tenth of a cent.** In our test set, Muse Spark transcribed the written measurements on all
six inputs (clean plans, phone photos and a hand sketch) and found every door and window on the drawn plans, at about
**$0.001 per image**. Baseline:
[`samples/replay/intake_report.json`](samples/replay/intake_report.json).

- **Measured, not guessed.** One measured Scene is the single source of truth: 3D, AR, render, takeoff and DXF all derive from it.
- **The AI proposes, deterministic code disposes.** The agent changes the home only through validated tools; construction rules live in code, never in prompts.
- **Honest by design.** Every output is labelled *preliminary* and flags what **needs a licensed professional** (a second floor, a load-bearing wall, a long span).
- **Built for the field.** Phone-first PWA, push-to-talk in Spanish, English or es-AR one tap away.

## Motivation

Self-built housing is how most families in Latin America get a home. It happens in stages, as savings allow, and usually
without a professional. The result is predictable: walls that have to come down, rooms with no ventilation, money spent
twice. Technical assistance programs exist and work, but there are far fewer technicians than families.

The tools a technician has today are a tape measure, a notebook and, at best, desktop CAD that never reaches the site.
Consumer AI room apps make pretty pictures that cannot be measured or built from.

Maqet sits in between: an AI that works **with** the technician on site, on a phone, and produces numbers a family can
buy against and drawings a professional can sign.

Sources: Habitat for Humanity, *Vivienda autoconstruida en Argentina* (2022), citing RENABAP; more in
[`docs/PRODUCT.md`](docs/PRODUCT.md).

## Who it's for

| Who | Role in Maqet |
|---|---|
| **Technical assistants** (primary): architects, master builders and social-housing technicians at NGOs, municipalities and cooperatives | Drive the session on site with a phone: measure, design with the family, leave with a staged material list and a DXF |
| **Families** | Watch the proposal in AR on their own table, ask for changes by voice in Spanish, keep a read-only link |
| **Licensed professionals and hardware stores** (downstream) | Receive a measured DXF to review and sign; quote the staged material list |

Families are free; the licensing hypothesis is a per-seat licence for programs ([`docs/PRODUCT.md`](docs/PRODUCT.md)).
Maqet is not a plan generator and never certifies structural safety.

## How it works

```
Capture ──► Reform ──► Design ──► Present ──► Deliver
sketch,     "add a     usability   AR on the   staged takeoff
photo or    bedroom"   check       table +     + measured DXF
AR measure  (agent)                render
```

| Stage | What happens | Meta model |
|---|---|---|
| **Capture** | Three modes ([ADR-025](docs/DECISIONS.md)), one Scene with a measurement and a provenance per wall. **A, AR measure** (Android Chrome, primary path): tap each floor corner, walls come out in meters. **B, room photo + taps** (any phone). **C, hand sketch with written measurements** (fallback): proposed walls and openings, each wall takes its own written length | Muse Spark 1.3 (vision, structured output) for mode C |
| **Reform** | The family asks by voice; the agent proposes the expansion through validated tools, checked against construction rules | Muse Voice Transcribe · Muse Spark 1.3 (tool calling) |
| **Design** | Basic furniture, only to check the room is usable | — |
| **Present** | AR maquette on the family's table + a render of the finished room | Muse Image |
| **Deliver** | Material quantities split by construction stage (foundations, walls, bond beams and roof, openings, finishes) + DXF with AIA layers | — (deterministic) |

**Under the hood**

- **One Scene, in meters.** Pydantic models and pure ops with undo. ([`server/scene/`](server/scene))
- **Rules in code, not in prompts.** Minimum room sizes, ventilation, door widths, spans, and the four professional-required flags. Every value is marked as a rule of thumb until a professional reviews it. ([`server/scene/rules.py`](server/scene/rules.py))
- **Vision with a strict contract.** Muse Spark returns JSON validated against a strict schema, coordinates normalized 0..1, one retry, then a loud failure. Images are downscaled to 2048 px. ([`server/intake/`](server/intake))
- **Deterministic cleanup.** Snapping, merging collinear walls, closing rooms with shapely, scale. ([`server/intake/cleanup.py`](server/intake/cleanup.py))
- **CAD that opens in AutoCAD.** ezdxf, meters, AIA layers, audited and re-opened in tests, compared to shapely geometry. ([`server/export/`](server/export))
- **Offline tests.** Every Meta call is recorded once and replayed, so the test suite costs $0.
- **Budget-safe development.** All AI traffic goes through a local gateway with daily caps and a spend watchdog. ([`docs/AI_USAGE.md`](docs/AI_USAGE.md))

## How Meta models are used

Every call goes through one client (`mme.client`), is tagged for cost attribution, and is recorded once and replayed in
tests and demos. The model proposes; deterministic code validates ([ADR-002](docs/DECISIONS.md)).

| Model | Where | What it does | Bounded by |
|---|---|---|---|
| **Muse Spark 1.3, vision** | Capture, mode C (`server/intake/`) | Reads a messy hand sketch or plan photo into proposed walls, openings, labels and the written measurement of each wall, as JSON | Strict schema, one retry then a loud failure; deterministic cleanup and a per-wall length solver; the technician corrects before anything is confirmed |
| **Muse Spark 1.3, tool calling** (Responses API) | Reform (`server/agent/`) | The reform agent proposes an expansion by calling stage-scoped tools (`add_room`, `add_opening`, `undo`, ...) | Each tool is a validated Scene op checked against construction rules; the server enforces the toolset per stage; failures return to the model as tool errors |
| **Muse Voice Transcribe** | Reform, push-to-talk (`POST /transcribe`) | Spanish-first speech to text so a family can talk to the model on site | Text only; the transcript goes through the same validated tools |
| **Muse Image** | Present | Renders the finished room for the family | Generated only from the explicit Render action, from the exact Scene geometry; labelled as a render |
| **SAM 3.1** (P1) | Capture, wall photos | Segments doors and windows in a photo of a measured wall; opening widths are computed from the mask | Only on a wall already measured in mode A or B; targets the measured weak point of sketches (2 of 5 openings found) |

Status of each integration is in the table below. Depth over breadth: the agent is the product, and Spark vision reads
the input a family really has, a hand sketch, not only clean plans.

## What you can run today

Status as of 2026-10-28 (Day 3). This table is updated as features land; the demo script
([`docs/DEMO.md`](docs/DEMO.md)) lists what the video will show.

| You want to | Status |
|---|---|
| Run the API and the full server test suite offline | **Works.** See [Run it](#run-it). |
| Read a plan or a hand sketch into a proposed Scene (`POST /intake`) | **Works** in replay with the recorded inputs; live with your own Meta key. |
| Upload a plan or sketch on the phone, correct walls, mark doors and windows, set the scale | **Works** (Capture screen → `POST /intake`). |
| Measure a room in AR on Android (mode A): corners, ceiling height, door and window taps | **Works**, verified on Android Chrome on 2026-10-28; needs HTTPS ([`docs/HARDENING.md`](docs/HARDENING.md) I14, I18). |
| Transcribe Spanish or English speech (`POST /transcribe`) | **Works** (Muse Voice Transcribe, replay or live). |
| Export a measured DXF of the walls | **Works.** Blocked until the scale is confirmed. |
| Ask the agent for an expansion by voice | **In progress.** Stage-scoped tools and executor exist; the chat route and UI are next. |
| Get the staged construction takeoff | **Planned** ([ADR-024](docs/DECISIONS.md)). |
| See the room as an AR maquette and as a render | **Planned.** |
| Read-only family link | **Planned.** |

Known limits and the hardening backlog are in [`docs/HARDENING.md`](docs/HARDENING.md).

## Run it

Requirements: Python 3.12+, Node 20+. **No Meta key is needed to run or judge the project.**

### Replay mode (default, $0, no network)

In replay mode every Meta call (`mme.client`) returns a recorded response from [`samples/replay/`](samples/replay)
instead of calling the API, so the demo and the tests are deterministic. An input with no recording fails loudly (HTTP 409
with the list of known samples) instead of silently calling out.

```bash
python -m venv .venv && source .venv/bin/activate   # Windows Git Bash: source .venv/Scripts/activate
pip install -r server/requirements.txt
cd server && MME_MODE=replay python -m pytest -q && cd ..     # offline test suite
MME_MODE=replay uvicorn server.api:app --host 0.0.0.0 --port 8000
```

In another terminal:

```bash
cd web && npm install && npm run dev
```

`npm run dev` serves the PWA over **HTTPS** (self-signed certificate) and proxies `/api` to the server on port 8000, so
the phone talks to one origin. Open `https://<your-computer-ip>:5173` on the phone (same Wi-Fi) and accept the
certificate warning. HTTPS is required for AR measuring (WebXR `immersive-ar`), camera and microphone.

### Try it

- **Any phone or desktop:** Capture → *Try a sample* loads a recorded plan or hand sketch from [`samples/plans/`](samples/plans)
  through the real intake path (`POST /intake`), then correct walls, mark doors and windows, confirm the scale, export
  the DXF.
- **Android Chrome with Google Play Services for AR:** Capture → AR measure (mode A). iPhone Safari has no WebXR; the UI
  detects it and offers modes B and C.
- Language: English by default; es-AR is one tap away.

### Live mode (optional)

Needs `MODEL_API_KEY` and `MME_MODE=live`. Use only synthetic or consented, non-personal images: contributor-tier models
may train on inputs ([`docs/HARDENING.md`](docs/HARDENING.md) P1).

## What was built during the hackathon

This repository was created after the kickoff (Oct 26, 2026) and contains no pre-existing product code. All code,
including the synthetic test-data generator, was written during the event.

The **first commit** also carries material prepared before kickoff, none of it product code (confirmed acceptable by the
organizers when disclosed):

- **Planning docs:** `docs/PLAN.md`, `docs/PRODUCT.md`, `docs/DECISIONS.md`, `docs/CUTLIST.md`, `docs/RUNBOOK.md`.
- **Dev tooling config:** `AGENTS.md`, `mme/` and `.claude/` (agent instructions, budgets, MME hooks) plus third-party
  ECC rule packs in `.claude/rules/ecc/` (MIT, see their `LICENSE`). MME itself is a separate dev tool, not part of
  this submission.

The demo video opens by stating this split and only shows features built during the event. AI usage is disclosed in
[`docs/AI_USAGE.md`](docs/AI_USAGE.md).

## Roadmap

- **Before the Nov 4 deadline:** the reform agent by voice, the staged takeoff, AR presentation and render (see the status table above).
- **Next:** rule sets per jurisdiction, reviewed by professionals; recipes validated with builders.
- **Later:** a version for NGO and municipal programs, free for families, with privacy-first models for real homes.

## Licence

MIT. See [`LICENSE`](LICENSE).
