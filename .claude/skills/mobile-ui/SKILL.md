---
name: mobile-ui
description: The app's phone-first UI spec for assisted self-build - demo default English with es-AR as the switchable product locale via one i18n dictionary, full-screen 3D with a bottom sheet, stage chips, selection plus voice, staged-takeoff Deliver screen with licensed-professional flags, touch and performance rules for iPhone/Android PWAs. Use when building any screen in web/src.
---

# Audience and language (ADR-022, ADR-026)
- Primary user: a technical assistant (NGO, municipality or cooperative) on site with a family; the family watches, talks
  to the app and keeps a read-only link. Plain, non-technical wording; no CAD jargon on family-facing screens.
- **Demo default English; es-AR is the product locale, switchable (ADR-026).** Every UI string comes from one dictionary in `web/src/i18n/` (`es-AR` and
  `en`, same keys); no string literals in components. Default locale is en (demo); the user can switch to es-AR. Numbers use the locale
  (`3,50 m`). The agent answers in the user's language.

# Layout (ADR-015)
```
┌──────────────────────────────┐
│ ←  Living                 AR │  top bar: back, room/project, AR button (variant switcher only if P1 variants ship)
│                              │
│      3D view (full screen)   │  orbit/pinch; tap = select object/surface (outline + label)
│                              │
├──────────────────────────────┤
│ Capture · Reform · Design ·  │  stage chips (skippable ones show "Skip")
│ Present · Deliver            │
│ ✔ Changed the living floor   │  last agent messages (collapsed: 1 line)
│ [ Ask or describe...  ] (🎙) │  input + hold-to-talk mic (big, thumb zone)
└──────────────────────────────┘
```
- Bottom sheet with 3 snap points (peek 120 px / half / full). Never cover the selected object: re-frame the camera.
- Capture and Reform have a 2D/3D toggle; the plan editor is 2D (SVG over the photo, draggable handles ≥ 44 px).
- Present: the swipe between variants also works in AR (the AR button exports the current variant).
- The variant switcher (A | B | C, ADR-013) is not in the P0 top bar: P0 shows a single proposal, and PRODUCT.md lists
  variants with family votes as P1. Add it only after the P0 gates are green.
- Program-licence badges (ADR-016, ADR-022) are small chips on gated actions, never modal paywalls. No billing code.
- **Fidelity is visible** (ADR-020):
  - a teal "Measured · 1:1" badge in the top bar once `scale_confirmed`; before that, an amber "Not to scale" badge that blocks
    export;
  - every `concept` item has a violet dashed outline and a "Concept" chip in 3D, AR, renders and lists;
  - renders carry a small "Conceptual visualization" caption;
  - every output screen (Present, Deliver, share link) carries a "Preliminary" label: Maqet never certifies structural safety.
- **Licensed-professional flags** (ADR-023): when validation returns one (second floor, load-bearing wall removed, span over
  the limit, unknown soil), show an amber chip "Requires a licensed professional" (es-AR: "Requiere profesional matriculado")
  on the affected wall or room, in the chat receipt, in the Deliver screen and in the share link.
- Deliver screen: the **staged takeoff** first, one block per stage in order (foundations, walls, bond beams/roof,
  openings, finishes) with quantities in JetBrains Mono and the stage as the purchase unit, then active flags, then
  "Export CSV", "Export DXF" and "Share". Never show prices (user-typed prices are P1). The "Preliminary" label stays visible.

# Visual direction: "warm technical" (for technical assistants AND the families they visit)
Not a cold CAD tool, not a lifestyle app: precise where it matters (measurements, plans), warm everywhere else.
| Token | Value | Use |
|---|---|---|
| `--bg` | `#F6F4F0` warm paper | app background, sheets |
| `--surface` | `#FFFFFF` | cards, inputs |
| `--ink` | `#1E2124` | text, icons |
| `--muted` | `#6B6F73` | secondary text, hairlines `#D9D5CE` |
| `--accent` | `#C2643A` terracotta | primary actions, the selected object outline, mic while recording |
| `--accent-2` | `#2F5D62` deep teal | measurements, scale, DXF/technical states |
| `--concept` | `#7A5AC8` violet | anything `concept` (imagined) gets this chip + dashed outline |
| dark mode | `#15171A` bg, same accents | automatic; 3D viewport keeps a soft light-grey gradient in both modes |
- Type: **Inter** for UI (400/500/600); **JetBrains Mono** only for measurements, areas and coordinates (`3.50 m`, `27.6 m²`).
- Shape: 14 px radius on sheets and cards, 1 px hairlines, no heavy shadows (one soft shadow on the bottom sheet).
- Plans and dimension lines are drawn thin and technical (teal); the 3D and renders carry the warmth.
- Motion: 150-200 ms ease-out; the 3D camera eases to the changed object after each agent edit.
- Icons: lucide. Licence badges: small terracotta outline chip.

# Interaction rules
- Selection + voice is the primary path: tap a wall → hold the mic → "poné una ventana acá" ("add a window here").
- The agent answers in **text only** (no text-to-speech). Voice is input only (push-to-talk).
- Every agent change shows a 1-line receipt with Undo ("Agregué una ventana en la cocina · Deshacer" / "Added a window in the kitchen · Undo").
- Optimistic UI: apply the returned Scene patch immediately; spinner only on the sheet, never blocking the 3D.
- Errors from rules are human: "That window would leave the bedroom under the minimum light ratio. Make it wider, or add a second one?" (shown in the user's language)

# Platform rules (iPhone Safari + Android Chrome)
- PWA manifest + icons, `display: standalone`, safe areas (`env(safe-area-inset-*)`), `100dvh`, no hover-only UI.
- Camera: `<input type=file accept=image/* capture=environment>` (works everywhere). Mic: MediaRecorder, with a
  permission prompt on first hold. Remember: iOS needs a user gesture to start audio.
- 3D: `dpr={[1, 2]}`, `frameloop="demand"`, merged static meshes, textures ≤ 1024 px, KTX2 if time allows. Target 60 fps on a 3-year-old phone.
- Text comes from `web/src/i18n/` (demo default English, es-AR switchable; ADR-022 superseded in part by ADR-026); the agent answers in the user's language.
- Accessibility: tap targets ≥ 44 px, contrast AA, captions for the agent receipts.
