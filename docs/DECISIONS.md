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
> Superseded in part by ADR-025: scale is no longer one global factor from a single dimension; each wall carries its own measurement and provenance.
- **Decision:** Spark vision returns walls/openings/labels/dimension texts as JSON (schema-validated). The UI shows
  draggable corners. Scale comes from one known dimension (two taps + value) or from a printed dimension Spark read.
- **Consequences:** works on messy real plans. Measurements are trusted because the professional confirmed them.

## ADR-008 Assets: curated CC0 catalog + generative on demand
> Superseded in part by ADR-022: construction materials with recipes are now the P0 catalog; design furniture shrinks to a small basic set.
- **Decision:** ~30 PBR materials (ambientCG, Poly Haven, CC0) and ~25 furniture GLBs (Kenney, Poly Pizza, CC0, scaled to
  real dimensions), declared in `assets/catalog.json` with license and source. Imagined materials: Muse Image generates a
  seamless texture ($0.01). Imagined furniture: a concept piece (image + real-size footprint), labelled as such.
- **Consequences:** low risk, good visuals. No generative 3D (no Meta API for it; self-hosting SAM 3D is out of scope).

## ADR-009 Projects with share links, no accounts
- **Decision:** projects live in the backend. An unguessable share token gives a read-only client view (3D, AR, render).
  No login in the hackathon.
- **Consequences:** fast to build, demo-friendly. Accounts and teams are roadmap. Tokens can be revoked.

## ADR-010 English UI, bilingual agent
> Superseded in part by ADR-022: UI is Spanish (es-AR) first, with English strings in the same dictionary.
- **Decision:** UI copy in English (global judges). The agent understands and answers in Spanish or English (it follows the
  user's language). Voice transcription in both.

## ADR-011 Deployment
- **Decision:** front on Vercel or Cloudflare Pages (HTTPS needed for camera/mic). Back on Fly.io or Render (Docker),
  with the SQLite volume. `MME_MODE=replay` demo fallback with recorded outputs in `samples/replay`.

## ADR-012 Devices
> Extended by ADR-025: WebXR measuring (Android only) moves from P2 to a capture mode with a fallback; iPhone is covered by the photo and sketch modes.
- **Decision:** develop and demo on both. iPhone for AR Quick Look (best AR polish). Android for WebXR experiments (P2).
  Every P0 feature must work on both.

## ADR-013 Variants are branches of the Scene
- **Decision:** a project holds several Scene branches (A, B, C) that share history up to their fork point
  (copy-on-write op logs). `create_variant(from, label)` forks. Exports always name the variant.
- **Consequences:** comparing, voting and choosing come almost for free from the op history. Storage stays small.

## ADR-014 Stage-scoped toolsets for the agent
> Re-scoped by ADR-022: the five stages stay; Reform becomes the main agent stage, Design is light, Deliver is the staged takeoff.
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
> Superseded in part by ADR-022: tiers change to free for families and per-seat licences for programs; still badges only, no billing code.
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
> Superseded in part by ADR-022: inputs are regenerated during the event and must include hand-drawn sketches with ground truth; the generator script is not in the repo.
- **Decision:** `samples/tools/make_plans.py` generates 3 original plans (CC0): a clean 48 m² flat, a 70 m² 2-bedroom flat
  and a hand-sketch-style loft. Each comes with a phone-photo-like version (perspective, paper, blur, noise) and a
  `*.truth.json` with walls/openings/rooms in meters.
- **Why:** no license risk, and intake accuracy can be measured (wall/room IoU, scale error) instead of eyeballed.
  CubiCasa5K is CC BY-NC-SA (non-commercial), so it's avoided for the demo. One real plan (your own flat, or a public-domain
  Library of Congress HABS drawing) is added for realism; licenses go in `samples/plans/SOURCES.md`.

## ADR-020 Positioning: the measured meeting-to-CAD workflow, not consumer decorating
> Superseded in part by ADR-022: the "measured, not decorative" filter stays; the audience and the handoff change (assisted self-build, staged takeoff).
- **Context:** consumer apps (ArchAI, RoomGPT, Planner 5D) already cover plan → 3D → AR → AI photo restyling. Feature parity
  there is a losing race (LiDAR, catalog size, polish).
- **Decision:** every scope decision is judged by the three proofs in PRODUCT.md (fidelity, handoff, collaboration). Features
  that only add consumer polish go to CUTLIST.
- **Consequences:** we skip cost estimates, huge catalogs and photo restyling as a primary feature. We invest in Scene
  fidelity, the DXF, the takeoff and variants.

## ADR-021 Quantity takeoff is derived from the Scene, deterministically
> Extended by ADR-024 (construction materials, split by stage).
- **Decision:** `server/export/takeoff.py` computes, for a chosen variant: floor/ceiling m² per material and room; wall paint
  m² per material (net of openings, using ceiling height); metres of wall demolished and built (op history vs. the
  captured base); new/removed openings; furniture list with dimensions and `concept` flags. Output as JSON for the app
  and CSV (Pro: XLSX later). No AI involved, so the numbers are exact and testable.
- **Consequences:** a contractor-ready handoff that consumer apps don't have; costs stay with the professional.

## ADR-022 Pivot: assisted self-build for families building progressively
- **Context:** the v1 audience (architects, interior designers, real-estate agents) is well served by consumer and
  professional tools and has a weak "Build for Your World" story. About 4 million people in Argentina self-build their
  homes in stages as they save (RENABAP, cited by Habitat for Humanity, 2022). Self-managed construction often yields
  structural deficiencies and functional errors that end in demolition and lost savings. Technical assistance helps, but
  there are too few professionals. Sources are listed in `docs/PRODUCT.md`.
- **Decision:** Maqet becomes measured technical assistance for self-builders. A technical assistant (architect, master
  builder or social-housing technician working for an NGO, municipality or cooperative) visits a family with a phone,
  surveys the existing home, designs the expansion with the family and leaves with a staged material list and drawings.
  The family sees the proposal in AR on its own table and through a read-only link, and can speak to it in Spanish.
  - The five stages of ADR-014 stay, re-scoped: Capture accepts plan photos and hand-drawn sketches (croquis) with a few
    written measurements; Reform is the main agent stage (expansion/improvement); Design is light (usability checks);
    Present is AR + Muse Image render; Deliver is the staged takeoff + DXF.
  - Catalog: construction materials with recipes are P0; design furniture is a small basic set.
  - UI: Spanish (es-AR) first, English strings in the same dictionary. Demo video in Spanish with English subtitles.
  - Business hypothesis: free for families; per-seat licence for programs; later hardware-store partnerships.
- **Why:** real, documented need; fits "Build for Your World" and Impact (30%); the staged takeoff is a differentiator no
  competitor found offers; sketch reading and voice show Meta tooling beyond a basic integration.
- **Consequences:** the three proofs of ADR-020 become fidelity, a staged material list the family can buy against, and
  family collaboration. ADR-001, 002, 003, 004, 005, 006, 009, 011, 012, 013, 015, 017 and 018 are unchanged.
- **Supersedes in part:** ADR-008 (catalog scope), ADR-010 (UI language), ADR-016 (tiers), ADR-019 (inputs), ADR-020
  (positioning and audience). Style presets, real-estate flow and consumer decorating move to CUTLIST.
- **Not claimed:** Maqet is not medical advice, not a plan generator, not a structural certification tool.

## ADR-023 Construction rules and professional-required flags
- **Decision:** `server/scene/rules.py` holds a small, documented rule set of Argentine building rules of thumb: minimum
  habitable room area and minimum side, ventilation and natural light (window area as a fraction of floor area), minimum
  ceiling height, door widths, masonry wall thicknesses, and the maximum unsupported span before a beam or bond beam is
  needed. Each value cites its source in the code. Rules are deterministic and never live in prompts.
  Every agent tool validates against these rules; violations return as tool errors or warnings.
- **Professional-required flags:** the agent and the UI must surface **"needs a licensed professional"** for any second
  floor, removal of a load-bearing wall, a span over the limit, and foundations on unknown soil. The flag is part of the
  Scene validation output, so it appears in the app, the share link, the takeoff and the DXF notes.
- **Consequences:** Maqet never certifies structural safety; all outputs are labelled preliminary. Wrong or outdated
  rules are a content risk: the rule table is small, reviewable and unit-tested, and the source of each value is recorded.
  Extends ADR-002 (the agent's bounds now include construction rules, not only geometry).

## ADR-024 Staged construction takeoff
- **Decision:** extends ADR-021. `server/export/takeoff.py` also derives construction material quantities from Scene
  geometry using per-material recipes in `assets/catalog.json` (for example bricks per m² of wall by brick type and wall
  thickness, mortar, cement bags, sand and gravel in m³, steel bars for bond beams, roofing sheets, openings). Quantities
  are split by construction stage: foundations, walls, bond beams and roof, openings, finishes. Output: JSON for the
  app and CSV. P1: the user types unit prices to get a per-stage total; Maqet never ships prices.
- **Why:** families buy materials as they save, stage by stage. A per-stage list turns a drawing into a purchase plan.
- **Consequences:** still deterministic and AI-free, so numbers are testable. Recipe values are labelled estimates with a
  source and a waste factor; they do not replace a professional's bill of quantities.

## ADR-025 Three capture modes with per-wall measurements
- **Context:** the first intake pass (ADR-007) scales the whole plan from one known dimension. Real hand sketches are not
  drawn to proportion, so one global factor makes every other wall wrong; our synthetic demo sketches are proportional, so
  the tests missed it. Measured baseline (2026-10-26): openings exact on clean/photo plans (8/8, 12/12) but 2 of 5 on a
  hand sketch; written dimensions are read correctly everywhere. The product promise is a *measured* Scene (ADR-001), so
  measuring in the field is worth more than guessing from a drawing. The human has an Android phone, so WebXR is testable.
- **Decision:** Capture offers three modes. All of them end in the same Scene, with a measurement and a provenance per wall.
  - **Mode A, AR measure (primary demo path; WebXR, Android Chrome with ARCore):** the technician points the phone at the
    floor and taps each room corner in an AR view (`immersive-ar` + `hit-test`). Each tap is a 3D point in meters, so walls
    come out measured with no scale guessing. Ceiling height: one tap at the ceiling, or the 2.60 m default. Precision
    target: a few centimeters, enough for the takeoff. The UI feature-detects support (`navigator.xr.isSessionSupported`)
    and offers B/C where it is missing (iPhone Safari has no WebXR).
  - **Mode B, room photo + tap measurements (any phone, iPhone included; fallback for A):** take a photo of a room or wall,
    tap two points and type a length (e.g. "3,50"), tap a window or door and type its width. Each annotated length is
    attached to its wall.
  - **Mode C, sketch with written measurements (fallback, no site visit):** Spark reads walls and written dimensions;
    **each wall takes its own written length** (per-wall constraints), never one global factor. A deterministic solver
    adjusts the geometry so walls match their lengths while keeping topology. Walls without a measurement are flagged
    `estimated`; contradictions (e.g. opposite sides of a room that do not close) are flagged to the technician.
  - **Provenance per wall**, stored in the Scene: `measured_ar | measured_tape | written_on_sketch | estimated`. It is shown
    in the UI and in the takeoff, where estimated quantities are labelled.
  - **Meta usage:** SAM 3.1 (P1) segments doors and windows in wall photos; with the wall already measured (mode A or B),
    opening widths are computed from the segmentation. This targets the measured weakness (sketch openings 2 of 5) and
    deepens the Meta tooling story. Spark vision stays for sketches and labels.
  - **Real-estate agents are not a P0 user.** One business-model line says Maqet also lets agents show a property's
    potential with the Muse Image render; the flow itself stays in CUTLIST. Room restyling is crowded, sits close to the
    "simple image analyzer" anti-project and dilutes the impact story.
- **Technical constraint (WebXR):** `immersive-ar` only runs in a **secure context (HTTPS)**. Testing from a phone over the
  LAN (`http://192.168.x.x:5173`) will not work: the dev web must be served over HTTPS (e.g. `@vitejs/plugin-basic-ssl`
  with `vite --host`, accepting the self-signed certificate on the phone) or through a tunnel. First step of the Mode A
  day: verify the phone supports WebXR AR (Chrome + Google Play Services for AR) with the official immersive-web hit-test
  sample, before writing any of our code. The same secure-context rule applies to camera and mic.
- **Fallback:** if WebXR fails on the demo device, the demo uses Mode B (then C). Modes B and C must therefore be
  demo-quality on their own, and the hit-test code stays behind feature detection.
- **Consequences:** the single-scale approach of ADR-007 is superseded in part (a global factor survives only as the
  solver's initial guess). ADR-012's "every P0 feature works on iPhone and Android" holds for the capability (measuring
  the home) through B/C; Mode A itself is Android-only. ADR-004's note that Safari has no WebXR still stands. The Scene
  gains a per-wall provenance field; the takeoff and UI must label estimated values. Tests need a deliberately
  **non-proportional** sketch fixture with ground truth (regenerated during the event, extending ADR-019) so a global-scale
  regression fails a test. AR precision depends on lighting and floor texture (see HARDENING).
- **Supersedes in part:** ADR-007 (scale from one dimension), ADR-012 (WebXR was P2), ADR-022's capture description (one
  known dimension). **Extends:** ADR-022, ADR-019.

## ADR-026 Demo default locale is English; es-AR is the product locale, switchable
- **Context:** the jury reads English; the product serves Spanish-speaking families in Argentina (ADR-022). The UI already
  ships one es-AR/en dictionary with the same keys and a locale switch, but the default was es-AR.
- **Decision:** the demo default locale is English (`DEFAULT_LOCALE = "en"`); es-AR remains the product locale and stays
  one tap away via the existing switch. Server warnings stay in English (jury-readable); voice input stays Spanish-first.
- **Why:** the jury cannot be expected to read Spanish warnings; the family product cannot lose es-AR.
- **Consequences:** `web/src/i18n/index.ts` defaults to `en`; both dictionaries keep identical keys. Demo video and screenshots
  read English; the es-AR path must still render (switch test, no missing keys).
- **Supersedes in part:** ADR-022 (UI language default: es-AR first -> en default for demo).
