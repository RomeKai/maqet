# Maqet — Product definition (v1, 2026-10-22)

## Name
**Maqet** (from *maqueta*: the AR model on the table). Tagline: *from plan to AR to CAD*. A quick app-store and web check
found no design/architecture app with this exact name; "Maquete AI" (a different product) exists, so always write the
name with the tagline. Run a trademark search (INPI / USPTO) before any public launch.

## One line
**Snap a floor plan, redesign the space live with an AI agent, show the client the result in AR on the table, and
hand AutoCAD the exact same design as a measured DXF.**

## Positioning
> **AI apps redesign photos. Maqet redesigns the measured space, and hands it to AutoCAD.**

Maqet is **not** a consumer decorating app. It's the professional's tool for the client meeting: what the client
approves in AR is, to the centimeter, what the architect gets in CAD and what the contractor can quote.
Three proofs we show in every demo:
1. **Fidelity:** the agent edits a measured model through validated tools; it never repaints a photo. `DIST` in AutoCAD
   measures what the plan said.
2. **Handoff:** the chosen variant becomes a DXF with layers **plus a quantity takeoff** (m² per finish, metres of wall
   demolished/built, furniture list): something a contractor can price.
3. **Collaboration:** variants A/B/C and a client link with votes, on any phone, no install.

## The problem
Showing a client a reform takes days today. Someone measures, someone drafts, someone renders, and then each
change round trip takes days too. Real-estate agents can't show a buyer "what this flat could become" at
all. AI room-redesign apps make pretty pictures, but those pictures aren't measurable and never reach production drawings.

## Users
| User | Moment | Job |
|---|---|---|
| **Architect / interior designer** (primary) | On site or in the client meeting, phone in hand | Capture the existing space, explore changes with the client live, leave with an approved concept and a DXF to finish at the desk |
| **Real-estate agent** (secondary) | Showing an empty or dated property | Let the buyer see it furnished or reformed, on the spot, to sell faster |
| **Client** (viewer) | During or after the meeting | Sees options in 3D/AR from a share link, gives feedback |

It's a professional tool: the agent works *with the professional*, who drives the conversation. The client watches,
asks for things, and later opens a read-only link.

## Core flow: 5 stages (Reform and Design can be skipped)
| Stage | What happens | Agent tools in this stage |
|---|---|---|
| **1. Capture** | Photo of the plan → Spark vision proposes walls/openings/labels/dimensions → drag corners → set the scale with one known dimension | none (deterministic editor) |
| **2. Reform** *(skippable)* | Change the architecture: remove a partition, add one, open the kitchen. Rooms are recomputed automatically | `remove_wall`, `add_wall`, `undo` (P1: `move_opening`, `resize_opening`, `split_room`) |
| **3. Design** *(skippable)* | Finishes, furniture and styles: *"light oak floor, white walls, a 3-seat sofa facing the window, make it japandi"* | `set_material`, `place/move/rotate/remove_item`, `apply_style`, `list_catalog`, `undo` (P1: `generate_material`, `concept_piece`, `apply_brand_kit`) |
| **4. Present** | Variants A/B/C side by side, AR maquette on the table, photoreal render of a view, share link where the client votes | `create_variant`, `render_view` |
| **5. Deliver** | **Quantity takeoff** of the chosen variant (in-app table + CSV), DXF with real measurements and AIA layers, share link | none |

Stage-scoped tools keep the model accurate and cheap: in Design it can't knock down a wall by accident.
Any stage can be reopened. Every change is a Scene op, with undo.

## Variants
A variant is a **branch of the Scene** (copy-on-write of its op history): *"make a warmer version"* creates B from A.
Present shows A/B/C with a swipe in 3D and in AR. The client's share link shows the variants and lets them vote and
comment (one line of text, no account). The chosen variant is the one exported to DXF.

## Main screen (phone)
3D full screen (orbit; tap an object or surface to select it and target the next request), with a bottom sheet:
chat + push-to-talk mic + stage chips. Top bar: back, room name, variant switcher A|B|C, AR button.
Selection plus voice is the core interaction: tap the sofa, then say *"in green velvet"*.

## Priority of capabilities
1. **Finishes and materials** (P0, Design). CC0 PBR catalog + style presets. *Imagined* materials (Muse Image seamless
   textures) are P1.
2. **Furnishing / staging** (P0, Design). CC0 furniture scaled to real dimensions. *Imagined* pieces are "concept pieces"
   (P1), honestly labelled.
3. **Redistribution** (P0-lite, Reform: remove/add partition, rooms recomputed; the rest is P1).
4. **Brand fit-out** (P1): BrandProfile applied to finishes and details.

## Scope tiers
- **P0 (the demo):**
  - Capture: plan photo → correct + scale → Scene.
  - Reform-lite: remove/add partition.
  - Design: materials, furniture, styles, text + push-to-talk.
  - Present: variants A/B/C, AR maquette, photoreal render, share link with votes.
  - Deliver: quantity takeoff (table + CSV) and DXF.
  - Fidelity visible: a "Measured" badge once the scale is confirmed; every `concept` item in violet.
- **P1 (if gates are green):** imagined materials, concept pieces, move/resize openings, brand kit.
- **P2 (post-freeze only if trivial, otherwise roadmap):**
  - WebXR measuring (Android Chrome);
  - 1:1 AR in place;
  - SAM 3.1 finish detection on room photos;
  - realtime voice.
- **Out (roadmap):**
  - iPhone AR measuring / LiDAR scanning (native app: Capacitor + ARKit/RoomPlan);
  - generative 3D furniture;
  - multi-floor; accounts and teams; DWG export.

## Business model (pitch hypothesis, prices to validate)
| Plan | For | Includes |
|---|---|---|
| **Free** | anyone | Capture, Design mode, AR maquette, in-app takeoff summary, 3 projects, share link with watermark, 5 renders/month |
| **Pro Designer** (~US$15/mo) | interior designers, stagers | Extended catalog + style packs, imagined materials and concept pieces, brand kits, HD renders, unlimited variants and client voting |
| **Pro Architect** (~US$29/mo) | architects, studios | DXF export with layer templates (AIA/ISO/custom), quantity takeoff export (CSV/XLSX, later PDF), Reform mode advanced, field measurement (native app with LiDAR/ARKit), revision history; DWG on the roadmap |
| **Agency** (per property, ~US$5) | real-estate agencies | Branded share pages, staging packs, bulk properties |

Growth loop: every client share link (free tier, watermarked) is an ad for Maqet.
In the hackathon build everything is unlocked, and "Pro" badges show where the paywall would go (no billing code).

## Competition (checked 2026-10-23)
| Product | What it does | Where Maqet differs |
|---|---|---|
| **ArchAI** (iOS, consumer) | LiDAR scan, AR measure, plan photo → plan, 3D, AR furniture, AI *photo* restyle, chat, cost estimate, PDF | Edits the measured model (no hallucinated geometry); DXF + takeoff; variants + client votes; Android/web; pro users |
| **Maket.ai** | Chat edits of floor plans in real time, plan generation, DXF export | Existing-plan intake (their announced *next* feature), 3D + AR, mobile, finishes and furniture, client collaboration |
| **Homestyler Agent Mode** | Chat + live 3D (desktop, not released yet) | Phone-first for the meeting, DXF + takeoff, measured intake from a plan photo |
| **RoomGPT / Interior AI / ReimagineHome / Collov** | Photo restyling and virtual staging | Not measurable or editable; no CAD; we keep the geometry true |
| **Planner 5D / Foyr Neo** | Plan editors with AI helpers, VR, rendering | Conversational agent with stage-scoped tools, AR on any phone, DXF + takeoff |

**What we don't compete on (in the hackathon):** LiDAR scanning and AR measuring (native, on the roadmap), catalog size,
multi-floor, cost estimates in currency (we give *quantities*, which are exact; prices come from the contractor).
**Watch:** Maket adding existing-plan import, and Homestyler's Agent Mode release. Our window is the
*meeting-to-CAD* workflow on a phone.

## Why Meta models (relevance for judges)
| Model | Role |
|---|---|
| Muse Spark 1.3 (vision) | Reads the plan photo into walls/openings/labels/dimensions |
| Muse Spark 1.3 (tool calling, Responses API) | The live reform agent: plans and applies scene edits |
| Muse Voice Transcribe | Push-to-talk requests in the meeting, in Spanish or English |
| Muse Image | Photoreal client render; seamless textures for imagined materials; concept pieces |
| SAM 3.1 (P1/P2) | Segmenting reference photos (materials, objects) |

## Differentiator
**What the client sees in AR is exactly what goes into AutoCAD.** One measured Scene, four outputs (3D, AR, render, DXF).
The AI never invents coordinates: it calls validated tools.

## Demo (3 minutes): one empty flat, the whole journey
1. **0:00** Problem in one sentence. An empty, dated flat and a photo of its plan.
2. **0:20 Capture**: snap the plan → walls appear → fix one corner → "this wall is 3.50" → measured.
3. **0:45 Reform**: *"open the kitchen to the living room"* → the partition goes, rooms recompute.
4. **1:05 Design**: *"light oak floor, white walls, japandi style"*, then tap the sofa → *"in green velvet"*. Live 3D.
   *"Make a warmer version"* → variant B.
5. **1:45 Present**: swipe A/B, phone on the table → AR maquette; photoreal render of the living room; share link →
   the client votes B on a second phone.
6. **2:20 Deliver**: the takeoff of variant B appears (*"32.4 m² light oak, 3.4 m of wall demolished, 41 m² of paint"*),
   then export → the DXF opens in AutoCAD and `DIST` measures 3.50. Line: *"what the client approved is what gets built."*
7. **2:45** Honest limitation + roadmap (native LiDAR measuring, DWG).

## Open questions (decide by Day 3)
- Validate the price hypotheses (2-3 conversations with architects or agents, if possible before Day 9).
- Which 3 sample plans to use in the demo (own flat? public plans with a permissive license?).
- One BrandProfile for P1 (an invented brand, not a real one).
