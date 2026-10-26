# Maqet: measured technical assistance for families who build their own homes

From a hand-drawn sketch to a staged shopping list of bricks, in one visit.

**About 4 million people in Argentina build their homes themselves, room by room, as they save.** Maqet lets one
technical assistant help many more of them: measure the home, design the next room with the family, show it in AR on
their own table, and leave a construction takeoff they can buy stage by stage.

> **Demo video (3 min):** _link coming on submission day_ · **Built for** the Meta Global AI Developer Hackathon, Indie track

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

## How it works

```
Capture ──► Reform ──► Design ──► Present ──► Deliver
sketch,     "add a     usability   AR on the   staged takeoff
photo or    bedroom"   check       table +     + measured DXF
AR measure  (agent)                render
```

| Stage | What happens | Meta model |
|---|---|---|
| **Capture** | Photo of a plan or a hand-drawn *croquis* with written measurements → proposed walls, openings and labels → the technician corrects them on the phone → scale from a written or known measurement. AR measuring and per-wall measurements in progress ([ADR-025](docs/DECISIONS.md)) | Muse Spark 1.3 (vision, structured output) |
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

## What you can run today

| You want to | Today |
|---|---|
| Run the API and the full server test suite offline | **Works.** See [Run it](#run-it). |
| Read a plan or a hand sketch into a proposed Scene (`POST /intake`) | **Works** in replay with the six recorded inputs; live with your own Meta key. |
| Upload a plan or sketch on the phone, correct walls, mark doors and windows, set the scale | **Works** (Capture screen → `POST /intake`). |
| Export a measured DXF of the walls | **Works.** Blocked until the scale is confirmed. |
| Measure a room in AR (Android) | In progress ([ADR-025](docs/DECISIONS.md)). |
| Ask the agent for an expansion by voice | Planned this week. |
| Get the staged construction takeoff | Planned this week ([ADR-024](docs/DECISIONS.md)). |
| See the room in AR and as a render | Planned this week. |

Known limits and the hardening backlog are in [`docs/HARDENING.md`](docs/HARDENING.md).

## Run it

Requirements: Python 3.12+, Node 20+. Tests and the default mode never call the network.

```bash
python -m venv .venv && source .venv/bin/activate   # Windows Git Bash: source .venv/Scripts/activate
pip install -r server/requirements.txt
cd server && MME_MODE=replay python -m pytest -q && cd ..
uvicorn server.api:app --host 0.0.0.0 --port 8000
```

In another terminal:

```bash
cd web && npm install && VITE_API_URL=http://localhost:8000 npm run dev
```

Open the printed URL on your phone (same Wi-Fi). Live Meta calls need `MODEL_API_KEY` and `MME_MODE=live`; use only
synthetic or consented, non-personal images.

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

- **This week:** AR measuring, the reform agent by voice, the staged takeoff, AR presentation and render.
- **Next:** rule sets per jurisdiction, reviewed by professionals; recipes validated with builders.
- **Later:** a version for NGO and municipal programs, free for families, with privacy-first models for real homes.

## Licence

MIT. See [`LICENSE`](LICENSE).
