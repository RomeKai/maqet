# Maqet — Product definition (v2.1, 2026-10-26; capture modes: ADR-025)

## Name
**Maqet** (from *maqueta*: the AR model on the table). Tagline: *from sketch to AR to staged materials*. A quick app-store
and web check found no design/architecture app with this exact name; "Maquete AI" (a different product) exists, so
always write the name with the tagline. Run a trademark search (INPI / USPTO) before any public launch.

## One line
**Assisted self-build: a technical assistant measures the family's home (in AR on the phone, with taps on photos, or from
their hand-drawn sketch), designs the expansion with them by voice, and leaves with a measured plan, an AR maquette and a
material list split by construction stage.**

## Positioning
> **AI apps redesign photos. Maqet designs the measured expansion, and tells a family what to buy at each stage.**

Maqet is **not** a consumer decorating app and **not** a structural engineering tool. It is measured technical
assistance for families who build and expand their own homes progressively. Three proofs in every demo:
1. **Fidelity:** the agent edits a measured model through validated tools; it never repaints a photo. Construction rules
   are deterministic code, and anything that needs a licensed professional is flagged.
2. **Staged takeoff:** the design becomes a material list per construction stage (foundations, walls, bond beams/roof,
   openings, finishes) plus a DXF, so the family buys stage by stage as they save.
3. **Family collaboration:** the family sees the proposal in AR on its own table, talks to it in Spanish, and keeps a
   read-only link, on any phone, no install.

## The problem
- About **4 million people in Argentina** self-build their homes progressively, in stages as they save (RENABAP, the
  national registry of informal neighborhoods; cited in Habitat for Humanity's 2022 study).
- The same study reports that self-managed construction often produces structural deficiencies that are hard to fix, and
  functional changes that lead to demolition and rebuilding: lost savings.
- Region: a commonly cited estimate is that over 60% of Latin America's population builds its own home without technical
  assistance (secondary source; treat as indicative). Non-engineered self-built housing carries structural risk.
- Technical assistance improves quality and resident satisfaction, but there are too few professionals. Public programs
  already fund improvements and expansions in registered neighborhoods (e.g. Argentina's "Mi Pieza"); the IDB has
  evaluated the impact of self-build improvement programs.
- Most families have no plans: only a sketch and a few tape measurements.

**Sources**
- Habitat for Humanity, *Vivienda autoconstruida en Argentina* (2022): https://www.habitat.org/sites/default/files/documents/Vivienda_autoconstruida_Argentina_resumen.pdf
- MIT Solve (regional estimate, secondary): https://solve.mit.edu/solutions/58706
- Structural risk of non-engineered housing (Frontiers in Built Environment, 2025): https://public-pages-files-2025.frontiersin.org/journals/built-environment/articles/10.3389/fbuil.2025.1711028/pdf
- IDB, impact of self-build improvement programs in Argentina's popular neighborhoods: https://publications.iadb.org/publications/spanish/document/Impacto-de-los-programas-de-mejoramiento-de-vivienda-por-autoconstruccion-evidencia-para-barrios-populares-de-Argentina.pdf

## Users
| User | Moment | Job |
|---|---|---|
| **Technical assistant** (primary): architect, master builder or social-housing technician at an NGO (TECHO, Habitat for Humanity), a municipality or a cooperative | Visiting a family, phone in hand | Survey the existing home, design the expansion with the family, leave with a staged material list and drawings. Value: serve many more families per day |
| **Family** (viewer) | During and after the visit | Sees the proposal in AR on their own table and via a read-only link; talks to it by voice in Spanish |
| **Downstream** | After the visit | The licensed professional who signs and permits; the hardware store or contractor who quotes materials |

The technical assistant drives the session. The family watches, asks for things and keeps the link.

## Core flow: 5 stages (Reform and Design can be skipped)
| Stage | What happens | Agent tools in this stage |
|---|---|---|
| **1. Capture** | Three modes (ADR-025), one Scene with a measurement and provenance per wall. **A, AR measure** (Android Chrome, WebXR): tap each room corner on the floor, walls come out in meters. **B, room photo + taps** (any phone): tap two points, type a length; tap a window/door, type its width. **C, sketch with written measurements** (fallback): Spark vision proposes walls/openings/dimensions → each wall takes its own written length via a deterministic solver; walls without one are flagged *estimated*, contradictions are flagged | none (deterministic editor) |
| **2. Reform** *(skippable)* | The agent proposes the expansion or improvement ("add a bedroom for the daughter", "move the bathroom", "add a kitchen window") only through validated tools. Rooms are recomputed; rule violations and professional-required flags come back as tool results | `add_room`, `add_wall`, `remove_wall`, `add_opening`, `move_opening`, `undo` (exact toolset defined in `server/agent/stages.py`) |
| **3. Design** *(skippable, light)* | Basic furniture only, to check a room is usable (a bed fits, doors swing) | `place/move/rotate/remove_item`, `list_catalog`, `undo` |
| **4. Present** | AR maquette on the family's table; Muse Image render of the finished room; share link | `create_variant`, `render_view` |
| **5. Deliver** | **Staged construction takeoff** (in-app table + JSON + CSV) and DXF with real measurements and AIA layers | none |

Stage-scoped tools keep the model accurate and cheap (ADR-014). Any stage can be reopened. Every change is a Scene op,
with undo. Variants A/B/C (ADR-013) remain available for comparing options with the family.

## Capture modes and measurement provenance (ADR-025)
| Mode | Device | How walls get their length | Provenance |
|---|---|---|---|
| **A. AR measure** (primary demo path) | Android Chrome + ARCore (HTTPS required) | Tap corners on the floor in `immersive-ar` + `hit-test`; 3D points in meters. Ceiling: one tap or 2.60 m | `measured_ar` |
| **B. Room photo + taps** | Any phone, iPhone included | Tap two points on a photo and type the length ("3,50"); tap a window/door and type its width | `measured_tape` |
| **C. Sketch with written measurements** | Any phone, no site visit | Spark reads walls and written dimensions; each wall takes its own length (per-wall solver, topology kept) | `written_on_sketch` |
| No measurement | n/a | Geometry as drawn | `estimated` |

- iPhone Safari has no WebXR: the UI detects support and offers B/C instead. If WebXR fails on the demo device, the demo
  uses B.
- Real hand sketches are not drawn to proportion, so a single global scale is wrong; lengths are per wall.
- Provenance is stored per wall in the Scene and shown in the UI and the takeoff (estimated quantities are labelled).
- SAM 3.1 (P1) segments doors/windows in wall photos; with the wall measured (A or B), opening widths come from the mask.

## Construction rules and honesty
- Rules are deterministic code in `server/scene/rules.py`, with the source cited next to each value (ADR-023): minimum
  habitable area and side, ventilation and natural light, ceiling height, door widths, wall thicknesses, maximum span
  before a beam or bond beam.
- The agent surfaces **"needs a licensed professional"** for: any second floor, removing a load-bearing wall, spans over
  the limit, foundations on unknown soil.
- Maqet never certifies structural safety. Every output is labelled **preliminary**. Imagined items stay labelled `concept`.

## Staged takeoff
Derived from Scene geometry plus per-material recipes in the catalog (ADR-024). No AI, so numbers are testable.
Quantities: bricks per m² of wall by brick type and thickness, mortar, cement bags, sand and gravel (m³), steel bars for
bond beams, roofing sheets, openings. Split by stage so the family buys as they save. Quantities that depend on walls
with `estimated` provenance are labelled as estimated.
P1: the user types unit prices to get a per-stage total. Maqet never ships prices.

## Main screen (phone)
3D full screen (orbit; tap an object or surface to select it and target the next request), with a bottom sheet:
chat + push-to-talk mic + stage chips. Top bar: back, room name, AR button (variant switcher is P1).
Selection plus voice is the core interaction. UI is Spanish (es-AR) first, English strings in the same dictionary (ADR-022).

## Scope tiers
- **P0 (the demo):**
  - Capture: AR measure (Android, primary demo path) with photo + tap measurements and sketch with per-wall written
    measurements as fallback and iPhone path → correct → Scene with per-wall provenance.
  - Reform: add/remove walls and openings, add a room, validated against construction rules, professional-required flags.
  - Design (light): basic furniture to check usability.
  - Present: AR maquette, Muse Image render of the finished room, share link.
  - Deliver: staged takeoff (table + JSON + CSV) and DXF.
  - Catalog: construction materials with recipes.
  - Voice in Spanish (push-to-talk). Fidelity visible: a "Measured" badge and per-wall provenance (estimated walls flagged) once the technician confirms; every `concept` item in violet; "Preliminary" label on outputs.
- **P1 (if gates are green):** SAM 3.1 opening widths from wall photos (measured wall + segmentation); unit prices and
  per-stage totals; variants A/B/C with family votes; move/resize openings.
- **P2 (post-freeze only if trivial, otherwise roadmap):** 1:1 AR in place; realtime voice; reference-object scale from a
  room photo.
- **Out (roadmap):** LiDAR scanning (native app); structural calculation or certification; multi-floor design; accounts and
  teams; DWG export; style presets and decorating (see CUTLIST).

## Business model (pitch hypothesis, to validate)
| Who | Offer |
|---|---|
| **Families** | Free |
| **NGOs, municipalities, cooperatives** running technical-assistance programs | Per-seat licence for technical assistants; program dashboards later |
| **Hardware stores** (later) | Partnerships around staged material lists |
| **Real-estate agents** (later, not a P0 user) | Also lets agents show a property's potential via the Muse Image render |

In the hackathon build everything is unlocked and badges show where licensing would apply (no billing code, ADR-016).

## Competition (checked 2026-10-26)
| Product | What it does | Where Maqet differs |
|---|---|---|
| **Decide y Construye / #PorMiRumbo** (Mexico) | Marketplace of materials and technical assistants for self-production of housing; no measured design (https://elceo.com/politica/pormirumbo-herramienta-que-ayudara-a-la-autoproduccion-de-viviendas/) | Measured design from the family's own sketch; staged material list generated from geometry |
| **Academic prototypes** (e.g. a PUCP thesis on a platform for professional intervention in informal housing) | Research on connecting professionals with informal housing | A working, phone-first tool with agent, AR and takeoff |
| **Maket.ai, Planner 5D, Foyr Neo** and similar professional tools | Plan editors and generators for formal design | Target formal design, not self-builders; no sketch intake, no staged takeoff |
| **RoomGPT / Interior AI / ReimagineHome** | Photo restyling | Not measurable, no construction rules, no quantities |

Honest summary: among the products found, none does sketch → measured design → staged takeoff.
**What we don't compete on:** LiDAR scanning, catalog size, structural calculation, prices (Maqet gives quantities;
prices come from the store).

## Why Meta models (relevance for judges)
| Model | Role |
|---|---|
| Muse Spark 1.3 (vision) | Reads messy hand sketches, not only clean plans, into proposed walls/openings and the written measurement of each wall |
| Muse Spark 1.3 (tool calling, Responses API) | The reform agent: proposes and applies expansions through validated tools |
| Muse Voice Transcribe | Spanish push-to-talk for families and technicians on site |
| Muse Image | Render of the finished room |
| SAM 3.1 (P1) | Segments doors/windows in wall photos; on a measured wall, opening widths come from the mask (targets the sketch-openings weakness) |

Bonus prizes this fits: **Best Agentic Use-Case** (a tool-calling agent bounded by deterministic rules) and **Best
Creative Build** (sketch to staged material list).

## Differentiator
**From a family's hand sketch to a measured design and a material list per stage, with the AI bounded by deterministic
construction rules.** One measured Scene, derived outputs (3D, AR, render, DXF, takeoff). The AI never invents coordinates.

## Demo (3 minutes): the story of Rosa
0. **0:00** Required one-liner, spoken and on screen: *"Planning docs and agent tooling were prepared before kickoff; all code you'll see was built this week."*
1. **0:10** Rosa saved for two years to add a room. A technician visits her home with an Android phone; Rosa's hand sketch, with tape measures written on it, is the fallback.
2. **0:35 Capture (AR, on an Android phone):** the technician walks the room and taps each corner on the floor in AR → measured walls → measured plan. (Fallback if AR is unavailable: photo + taps, or the sketch with per-wall written measurements.)
3. **1:00 Reform:** by voice, in Spanish: *"agregá un dormitorio para mi hija al lado de la cocina"*. The agent proposes it and flags what needs a licensed professional (placeholder: [flag shown]).
4. **1:45 Present:** Rosa sees the room in AR on her own table, plus the Muse Image render of the finished room.
5. **2:15 Deliver:** staged material list (*"stage 1: [N] bricks, [M] cement bags…"*, placeholders until real outputs exist) and the DXF.
6. **2:45** Honest limitation (preliminary, not a structural certification) + roadmap. Video in Spanish with English subtitles.

## Open questions (decide by Day 3)
- Which master-builder or NGO contact can sanity-check the rules table and recipe values (ideally before Day 5).
- Final list of brick types, wall thicknesses and the rule-value sources to cite in `rules.py`.
- Hand-drawn sketches for the demo: who draws them, with what ground truth (see PLAN Day 1), including one deliberately non-proportional sketch.
- Android phone for Mode A: available (the human's). Still to verify on Day 3 (first step): Chrome + Google Play Services for AR passes the official immersive-web hit-test sample.
- Validate the licensing hypothesis with 1-2 conversations with programs (low priority, pitch only).
