# Architecture decisions (ADR log)

Short records: context → decision → consequences. Change a decision by adding a new entry that supersedes it.

## ADR-001 One measured Scene as the single source of truth
- **Context:** we need a 3D view, AR, a render and a DXF that all agree; the AI must not invent geometry.
- **Decision:** a versioned `Scene` document (pydantic, meters) holds walls, openings, rooms, surfaces with materials,
  and furniture with real dimensions. Every output is derived from it. Every change is an operation on it.
- **Consequences:** DXF, GLB/USDZ, 3D and render can't diverge. Undo is just the operation history. Tests target the Scene.

## ADR-002 The agent edits through validated tools, never raw geometry
- **Decision:** Muse Spark 1.3 with function calling. The tools are `set_material`, `place_furniture`, `move_item`,
  `remove_item`, `undo`, `render_view`, and later `remove_wall`/`add_wall`/`apply_brand_kit`. Every tool validates against
  `rules.py` and the Scene before applying. Failures go back to the model as tool errors.
- **Consequences:** the model's creativity is bounded by deterministic code; results are reproducible and testable in replay.

## ADR-003 Responses API for the agent loop; Chat Completions for single-shot calls
- **Context:** Meta recommends Responses for multi-turn work. Chat Completions loses reasoning across turns.
- **Decision:** the live agent uses `/v1/responses` with `previous_response_id`. One-shot structured calls (plan reading)
  may use Chat Completions with JSON schema. Both go through `mme.client` (Responses support gets added there).

## ADR-004 Mobile-first PWA
- **Decision:** React + Vite + TypeScript, installable PWA. react-three-fiber + drei for 3D, Zustand for scene state,
  Tailwind + shadcn/ui for UI.
- **Why:** judges open a link (no stores, no APK). One codebase for phone, tablet and desktop. Camera, mic and WebGL work.
- **Consequences:** no AR measuring on iPhone (Safari has no WebXR). Native features are roadmap (Capacitor).

## ADR-005 AR maquette with `<model-viewer>`
- **Decision:** export the Scene to GLB client-side (three.js GLTFExporter); model-viewer serves Quick Look (iOS, USDZ
  generated client-side) and Scene Viewer (Android). The maquette is scalable; 1:1 placement is P2.
- **Consequences:** works on both phones with zero install. Visual quality depends on our PBR materials and lighting.

## ADR-006 FastAPI backend in Python
- **Decision:** FastAPI + pydantic v2. ezdxf (DXF), shapely (geometry/validation). SQLite via SQLModel for projects and
  share links; files (plan photos, renders, textures) on disk behind an interface, so they can move to S3/R2 later.
- **Consequences:** DXF stays first-class. Pydantic → JSON Schema → TS types (`openapi-typescript`) keeps front/back in sync.

## ADR-007 Plan intake: AI proposes, the human corrects and scales
- **Decision:** Spark vision returns walls/openings/labels/dimension texts as JSON (schema-validated). The UI shows
  draggable corners. Scale comes from one known dimension (two taps + value) or from a printed dimension Spark read.
- **Consequences:** works on messy real plans. Measurements are trusted because the professional confirmed them.

## ADR-008 Assets: curated CC0 catalog + generative on demand
- **Decision:** ~30 PBR materials (ambientCG, Poly Haven, CC0) and ~25 furniture GLBs (Kenney, Poly Pizza, CC0, scaled to
  real dimensions), declared in `assets/catalog.json` with license and source. Imagined materials: Muse Image generates a
  seamless texture ($0.01). Imagined furniture: a concept piece (image + real-size footprint), labelled as such.
- **Consequences:** low risk, good visuals. No generative 3D (no Meta API for it; self-hosting SAM 3D is out of scope).

## ADR-009 Projects with share links, no accounts
- **Decision:** projects live in the backend. An unguessable share token gives a read-only client view (3D, AR, render).
  No login in the hackathon.
- **Consequences:** fast to build, demo-friendly. Accounts and teams are roadmap. Tokens can be revoked.

## ADR-010 English UI, bilingual agent
- **Decision:** UI copy in English (global judges). The agent understands and answers in Spanish or English (it follows the
  user's language). Voice transcription in both.

## ADR-011 Deployment
- **Decision:** front on Vercel or Cloudflare Pages (HTTPS needed for camera/mic). Back on Fly.io or Render (Docker),
  with the SQLite volume. `MME_MODE=replay` demo fallback with recorded outputs in `samples/replay`.

## ADR-012 Devices
- **Decision:** develop and demo on both. iPhone for AR Quick Look (best AR polish). Android for WebXR experiments (P2).
  Every P0 feature must work on both.

## ADR-013 Variants are branches of the Scene
- **Decision:** a project holds several Scene branches (A, B, C) that share history up to their fork point
  (copy-on-write op logs). `create_variant(from, label)` forks. Exports always name the variant.
- **Consequences:** comparing, voting and choosing come almost for free from the op history. Storage stays small.

## ADR-014 Stage-scoped toolsets for the agent
- **Decision:** the five stages (Capture, Reform, Design, Present, Deliver) each expose only their own tools to the model.
  Reform and Design can be skipped. The stage is part of the request, and the server enforces the toolset (the model
  can't call a tool outside it even if it hallucinates one).
- **Consequences:** fewer wrong edits, smaller prompts (cheaper, better cache hits), a clear UX. Cross-stage requests
  ("open the kitchen" in Design) get a suggestion to switch stage instead of an action.

## ADR-015 Main screen: full-screen 3D + bottom sheet
- **Decision:** 3D view full screen; bottom sheet with chat, push-to-talk and stage chips; top bar with variant switcher
  and AR. Tapping an object/surface selects it, and the selection is sent as context with the next request.
- **Consequences:** selection plus voice is the main interaction. One-hand use. The 2D plan view lives in Capture/Reform
  as a toggle.

## ADR-016 Plans are badges, not code, in the hackathon
- **Decision:** a single `entitlements` map (free/pro_designer/pro_architect/agency) drives "Pro" badges in the UI.
  Everything stays enabled; no billing, no auth.
- **Consequences:** the business model is visible in the demo at zero engineering cost. Real gating comes later.

## ADR-017 Agent answers in text only
- **Decision:** voice is input only (push-to-talk). The agent replies with short text receipts. No text-to-speech.
- **Consequences:** discreet in client meetings, nothing extra to build or pay for. Can be revisited post-hackathon.

## ADR-018 Visual direction "warm technical"
- **Decision:** a hybrid style for professionals and their clients: warm paper background, terracotta accent, deep teal for
  measurements and technical states, violet for anything `concept`. Inter for UI, JetBrains Mono for measurements.
  Tokens are in the `mobile-ui` skill.
- **Consequences:** one palette serves both audiences; technical precision is visible exactly where it matters.

## ADR-019 Demo and test plans are generated with known ground truth
- **Decision:** `samples/tools/make_plans.py` generates 3 original plans (CC0): a clean 48 m² flat, a 70 m² 2-bedroom flat
  and a hand-sketch-style loft. Each comes with a phone-photo-like version (perspective, paper, blur, noise) and a
  `*.truth.json` with walls/openings/rooms in meters.
- **Why:** no license risk, and intake accuracy can be measured (wall/room IoU, scale error) instead of eyeballed.
  CubiCasa5K is CC BY-NC-SA (non-commercial), so it's avoided for the demo. One real plan (your own flat, or a public-domain
  Library of Congress HABS drawing) is added for realism; licenses go in `samples/plans/SOURCES.md`.

## ADR-020 Positioning: the measured meeting-to-CAD workflow, not consumer decorating
- **Context:** consumer apps (ArchAI, RoomGPT, Planner 5D) already cover plan → 3D → AR → AI photo restyling. Feature parity
  there is a losing race (LiDAR, catalog size, polish).
- **Decision:** every scope decision is judged by the three proofs in PRODUCT.md (fidelity, handoff, collaboration). Features
  that only add consumer polish go to CUTLIST.
- **Consequences:** we skip cost estimates, huge catalogs and photo restyling as a primary feature. We invest in Scene
  fidelity, the DXF, the takeoff and variants.

## ADR-021 Quantity takeoff is derived from the Scene, deterministically
- **Decision:** `server/export/takeoff.py` computes, for a chosen variant: floor/ceiling m² per material and room; wall paint
  m² per material (net of openings, using ceiling height); metres of wall demolished and built (op history vs. the
  captured base); new/removed openings; furniture list with dimensions and `concept` flags. Output as JSON for the app
  and CSV (Pro: XLSX later). No AI involved, so the numbers are exact and testable.
- **Consequences:** a contractor-ready handoff that consumer apps don't have; costs stay with the professional.
