# Maqet — project instructions

Snap a floor plan, redesign the space live with an AI agent, show the client the result in AR on the table, and hand
AutoCAD the exact same design as a measured DXF. Mobile-first PWA. Meta Global AI Developer Hackathon (Indie track).
Deadline Wed 2026-11-04 21:00 GMT-5 (23:00 Buenos Aires); internal deadline 18:00 Buenos Aires. Status: `mme today`.
Product: `docs/PRODUCT.md`. Decisions: `docs/DECISIONS.md`. Ops: `docs/RUNBOOK.md` (follow them; propose a new ADR to change one).

## Core principles
1. **One measured Scene is the source of truth** (ADR-001). Walls, openings, rooms, surfaces+materials, furniture, all in
   meters. 3D view, AR (GLB/USDZ), photoreal render and DXF are all *derived* from it. Never store geometry anywhere else.
2. **The AI proposes, deterministic code disposes** (ADR-002). The reform agent changes the Scene only through validated
   tools. Plan reading returns JSON that the human corrects and scales. Models never write coordinates into outputs.
3. **Every P0 feature works on iPhone and Android** (ADR-012). Phone-first UI per the `mobile-ui` skill; desktop is a bonus.
4. **Differentiate, don't decorate** (ADR-020): every feature must strengthen fidelity, professional handoff (DXF + takeoff)
   or client collaboration. Consumer polish goes to CUTLIST.
5. **Five stages, scoped tools** (ADR-014): Capture → Reform* → Design* → Present → Deliver (*skippable). The agent only
   gets the current stage's tools.
6. **Demo-able `main`.** `mme gate` defines done. Off the critical path -> `docs/CUTLIST.md`.

## Stack
- `web/`: React + Vite + TypeScript PWA, react-three-fiber + drei, Zustand (scene store + op history), Tailwind +
  shadcn/ui, `<model-viewer>` for AR, vitest. Types generated from the API schema (`npm run gen:types`).
- `server/`: FastAPI + pydantic v2, ezdxf, shapely, SQLModel/SQLite, pytest.
- AI (Meta only, via `mme.client`):
  - plan reading: Muse Spark 1.3 vision;
  - reform agent: Spark 1.3 tool calling over the Responses API;
  - push-to-talk: Muse Voice Transcribe;
  - renders, imagined textures and concept pieces: Muse Image;
  - reference photos: SAM 3.1 (P1/P2).
- Assets: CC0 only, each declared in `assets/catalog.json` with source + license.

## Repo map (keep it current; read this instead of scanning the tree)
- `server/scene/` Scene models (pydantic), ops (pure functions Scene -> Scene), validation (`rules.py`), `variants.py` (branches A/B/C)
- `server/intake/` plan photo -> proposed walls (Spark vision), scale from a known dimension
- `server/agent/` tools, executor, `stages.py` (stage-scoped toolsets, ADR-014), Responses loop, prompts (`prompts/` versioned)
- `server/export/` DXF from Scene (ezdxf), `takeoff.py` quantity takeoff (ADR-021) · `server/render/` snapshot + Muse Image · `server/api.py` routes · `server/db.py`
- `server/tests/` pytest, offline (replay fixtures in `samples/replay`)
- `web/src/scene/` store, op history, types · `web/src/view3d/` r3f scene from Scene · `web/src/intake/` plan photo +
  corner editor + scale tool · `web/src/agent/` chat + push-to-talk · `web/src/ar/` GLB/USDZ export + model-viewer ·
  `web/src/share/` client read-only view
- `assets/` catalog.json, materials/, furniture/, styles/ (CC0) · `samples/` demo plans + replay · `docs/` product, decisions, plan
- `mme/` harness config (budget, policy, milestones, night missions)

## Domain rules
- Units: meters in the Scene; DXF `$INSUNITS` explicit (meters default, mm optional). Never mix.
- DXF layers (AIA): `A-WALL`, `A-DOOR`, `A-GLAZ`, `A-FLOR-FURN`, `A-ANNO-TEXT`, `A-ANNO-DIMS`, `A-AREA`. Color by layer.
- Defaults: exterior wall 0.20 m, interior 0.10 m, door 0.90 m (min 0.80), corridor ≥ 1.00 m, ceiling 2.60 m.
  Furniture keeps real dimensions from the catalog; the agent may only scale within ±20% of them.
  These live in `server/scene/rules.py`, never in prompts.
- Imagined items are labelled `concept` in the Scene and in every output. Never present them as real products.

## Workflow (ECC)
`/ecc:plan` for anything over ~1 hour · `tdd-workflow` for `server/scene`, `server/export`, `server/agent` tools ·
`/code-review` before merging to `main` · the day is done when `mme gate` is green.

## Agents
`reform-agent-designer` (agent tools, prompts, evals) · `cad-validator` (audits Scene/DXF, read-only) ·
`demo-director` (demo, samples, README, submission) · `meta-integrator` (every Meta call, costs, caching).

## Style
Python: type hints, pydantic at boundaries, pure functions for ops. TS: strict, no `any`. Conventional commits, small.

<!-- mme:start (managed by `mme init`; edit outside these markers) -->
## MME harness rules (all agents: Claude Code, Muse Code, OpenCode, Codex)

**First:** if `HANDOFF.md` exists at the repo root, another harness was working before you: read it, confirm the next
step with the human, delete it once you've taken over. If `NIGHT_REPORT.md` exists and the human asks about last
night, start there.

**Credits are finite.** Rule: `.claude/rules/mme/meta-credits.md`. Product code calls the provider ONLY through
`mme.client`. Run product commands with `MME_MODE=replay` unless the human says otherwise (spends $0).

**Never touch MME controls:** harness/policy (`mme use|fallback|policy`), budgets (`mme budget sync`, `mme gateway`,
gateway `/key/*`), the watchdog. Those are the human's decisions.

**Context protocol (every token costs):**
- Never read `.venv/`, `site-packages/`, `node_modules/`, lockfiles, `dist/`, `.cache/`, `.mme/`, `samples/replay/`,
  binaries or generated/minified files.
- Find before you read: repo map -> `rg -n --max-count 5 "<symbol>"` -> `rg -l "<term>" | head -20` ->
  `rg --files -g '*<part>*'`. Then read only the 2-3 files that matter; files > 300 lines by range (±60 lines).
- Third-party libraries: never open their source. Use `python -c "import inspect, pkg; print(inspect.signature(...))"`,
  `help(...) | head -40`, or fetch the specific docs page.
- Bound every output: `pytest -q 2>&1 | tail -40`, `npm run build 2>&1 | tail -30`. No `cat` of whole files, no `ls -R`.
- Don't re-read a file that's already in context.

**Retry discipline:** after 2 failures of the same command, stop tweaking: re-read the full error, state one root-cause
hypothesis, verify it with a targeted read. The loop-breaker hook stops the session at 3.

**Status:** `mme today` shows the deadline, today's goal and what's behind. Suggest `mme gate` when you believe the
day's goal is done; it is the definition of done, not your judgment.
<!-- mme:end -->
