---
name: mobile-ui
description: The app's phone-first UI spec - full-screen 3D with a bottom sheet, stage chips, variant switcher, selection plus voice, touch and performance rules for iPhone/Android PWAs. Use when building any screen in web/src.
---

# Layout (ADR-015)
```
┌──────────────────────────────┐
│ ←  Living        A | B | C  AR│  top bar: back, room/project, variant switcher, AR button
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
- Pro badges (ADR-016) are small chips on the gated actions, never modal paywalls.
- **Fidelity is visible** (ADR-020):
  - a teal "Measured · 1:1" badge in the top bar once `scale_confirmed`; before that, an amber "Not to scale" badge that blocks
    export;
  - every `concept` item has a violet dashed outline and a "Concept" chip in 3D, AR, renders and lists;
  - renders carry a small "Conceptual visualization" caption.
- Deliver screen: takeoff table first (big numbers in JetBrains Mono), then "Export DXF" and "Share". Variant name always visible.

# Visual direction: "warm technical" (hybrid for professionals AND their clients)
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
- Icons: lucide. Pro badges: small terracotta outline chip "PRO".

# Interaction rules
- Selection + voice is the primary path: tap the sofa → hold the mic → "in green velvet".
- The agent answers in **text only** (no text-to-speech). Voice is input only (push-to-talk).
- Every agent change shows a 1-line receipt with Undo ("Changed living floor → Light oak · Undo").
- Optimistic UI: apply the returned Scene patch immediately; spinner only on the sheet, never blocking the 3D.
- Errors from rules are human: "That sofa doesn't fit there (needs 0.6 m in front of the door). Try the other wall?"

# Platform rules (iPhone Safari + Android Chrome)
- PWA manifest + icons, `display: standalone`, safe areas (`env(safe-area-inset-*)`), `100dvh`, no hover-only UI.
- Camera: `<input type=file accept=image/* capture=environment>` (works everywhere). Mic: MediaRecorder, with a
  permission prompt on first hold. Remember: iOS needs a user gesture to start audio.
- 3D: `dpr={[1, 2]}`, `frameloop="demand"`, merged static meshes, textures ≤ 1024 px, KTX2 if time allows. Target 60 fps on a 3-year-old phone.
- Text in English (ADR-010); the agent answers in the user's language.
- Accessibility: tap targets ≥ 44 px, contrast AA, captions for the agent receipts.
