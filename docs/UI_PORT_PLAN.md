# UI port plan: v0 design -> Maqet web

Branch `day/ui`, worktree `kit/maqet-ui`. Deadline 2026-11-04; Mode C (sketch) is the demo path, AR comes later.

## Goal
Make the phone app look and read like the v0 design, while keeping the logic we already have, tested, under it.
Done when the Mode C demo path (Home > Method > Photo > Walls > Openings > Check > Deliver) on a 375 px phone
matches the design closely, and the whole web suite and tsc are green.

## Sources
- **Design (read-only):** `C:\Users\lenovo\Desktop\kit\captur-ref`
  - Stack: Next 16, Tailwind v4, lucide, shadcn and base-ui. Live at https://captur-iota.vercel.app (mobile).
  - Tokens and fonts: `app/globals.css`, with Archivo (sans), JetBrains Mono (numbers) and Caveat (handwritten)
    from `app/layout.tsx`.
  - Shared pieces: `components/maqet/shell.tsx` (header, stepper), `ui.tsx` (buttons, chips, cards, banners) and
    `capture-parts.tsx` (sub-step header, tool bar, length pill, bottom sheet).
  - Screens: `components/maqet/screens/{home,method,photo,walls,openings,check,agent,present,deliver}.tsx`.
  - Illustrations only, NOT to port as logic: `plan-view.tsx`, `iso-view.tsx`, `sketch-photo.tsx`.
  - Prototype state only, never product logic: `lib/app-context.tsx`.
- **Target:** `web/`, with Vite 6, React 18.3, TS strict, vitest and plain CSS in `web/src/styles.css`.

## Rules
1. **Re-skin, don't rewrite.** Our components keep their behavior and their tests:
   - `App.tsx`: stage flow.
   - `intake/IntakeScreen`, `UploadStep`, `CornerEditor`, `opening.ts`: upload, walls and openings.
   - `view3d/SceneView`, `MaquetteSheet`: 3D.
   - `agent/*`, `deliver/*`, `fidelity/*`.
   - `scene/store.ts`: the single source of truth (ADR-001).

   The design's plan and iso views are drawings. Our CornerEditor canvas and our r3f view stay, styled to match.
2. **No Next or React 19 dependencies.**
   - No `next/*` imports.
   - Re-create the few shadcn/base-ui pieces the design uses as small local components in `web/src/ui/`.
   - Fonts via `@fontsource/*` packages or a Google Fonts `<link>` in `index.html`.
3. **Tailwind v4** via `@tailwindcss/vite`. Copy the `:root` tokens and the `@theme inline` block from
   `globals.css`, without the shadcn import. Delete CSS from `styles.css` only when the component it styled is
   ported. No dead CSS.
4. **Strings:** every user-visible string goes in `web/src/i18n` (en, plus es-AR). No literals in components.
5. **Phone first:**
   - Touch targets of 48 px or more.
   - WCAG AA contrast, including text over the sketch photo.
   - Wall length pills of 14 px or more, in screen pixels, regardless of photo zoom.
   - Instructions and errors at the top, under the sub-step header.
6. **Tests:** before EVERY commit, `cd web && npx vitest run 2>&1 | tail -5 && npx tsc --noEmit`, both green.
   - Update a selector only when the behavior is identical. Never delete a behavior test.
   - New behavior gets a test first (RED, then GREEN).
7. **Commits:** small conventional commits, one or more per phase, no attribution trailers, never push. Do not
   touch `server/`, `mme/` or `.env`.

## Phases

### 1. Foundation (tokens, fonts, shell)
- Tailwind v4, tokens, the three fonts and `lucide-react`.
- `web/src/ui/` primitives taken from the design's `ui.tsx`:
  - Button: primary, secondary, ghost, danger, all 48 px high.
  - Chip/Tag.
  - Card.
  - Banner: info, warning, danger, success.
  - BottomSheet.
- App shell from `shell.tsx`:
  - Header: back button, project name and place, settings button, EN/ES segmented control wired to our i18n.
  - Stepper: Capture, Reform *optional*, Design *optional*, Present, Deliver, with numbered circles and the
    current one filled.
  - The shell wires to our existing stage state in `App.tsx`. Skippable stages behave as today.
- The "Preliminary: not a structural certification" footer stays visible on every stage.
- **Check:** the existing App and stage tests pass, and the screen looks like the design's header and stepper.

### 2. Home and capture method
- Home, from `home.tsx`:
  - The project card, with a sketch thumbnail (our uploaded photo, or a placeholder), a Draft/stage chip, name,
    place and a "Start capture" or "Continue" button.
  - The "Works on site" offline info banner.
  - A "New project" button fixed at the bottom.
  - One local project is enough. Do not build a project backend.
- Method chooser, from `method.tsx`:
  - "Photograph a sketch" opens Mode C. It is the primary option.
  - **AR slot:** an "AR measure" card shown ONLY when `navigator.xr?.isSessionSupported('immersive-ar')`
    resolves true. It routes to the existing `measure/ArMeasure`. Test it with a mocked `navigator.xr`, both
    true and false.
  - "Draw on the screen" and "Type the measurements" are disabled with a "Soon" tag.
  - Keep the "Most people start with a photo" hint.

### 3. Capture C: the four sub-steps (THE demo path, highest priority)
- Sub-step header from `capture-parts.tsx`: Photo > Walls > Openings > Check, then one large instruction line
  (16 px or more), then an error/warning banner right under it.
- **Photo**, from `photo.tsx`:
  - Camera and gallery buttons around our `UploadStep`.
  - A "Reading your sketch" loading state that names what is happening.
  - Errors: server unreachable, photo unreadable, or a replay 409, each with a retry button.
- **Walls**, from `walls.tsx`:
  - Our CornerEditor canvas fills the free height.
  - Length pills of 14 px or more, and a provenance badge per wall (written / measured / estimated, estimated
    in the warning color).
  - Tapping a wall opens a BottomSheet with a large numeric length input. It dispatches the existing op.
  - The tool bar (Select, Wall, Undo) is a large segmented control just above the stage bar.
- **Openings**, from `openings.tsx`:
  - Door and Window tools. A door is drawn as a gap plus a swing arc; a window as a double thin line (this is
    already in CornerEditor; restyle it).
  - The form takes width, height and sill.
  - A tap within 24 screen px of a wall projects onto that wall instead of being rejected. Test it.
- **Check**, from `check.tsx`:
  - An "N things to check" list built from our intake warnings.
  - Tapping an item highlights its wall in the editor.
  - The 3D view (our SceneView/MaquetteSheet) is shown here. During Photo, Walls and Openings the 3D stays
    collapsed behind a "View 3D" button.
  - A "Looks right" button goes on to the next stage.
- **Check:** `flows/modeC.flow.test.tsx` and the `intake/*` tests are green. With
  `samples/plans/croquis_3x8_door_window`, the flow reaches Check with 4 walls, a door and a window.

### 4. Deliver
From `deliver.tsx`:
- Collapsible stage cards (Foundations, Walls, Bond beams & roof, Openings, Finishes) wired to our `deliver/*`
  takeoff types. Quantities use mono numbers with units. Items from estimated walls carry the warning tag.
- "Download DXF" goes through the existing `/export/dxf`. "Download CSV" is shown only if `/export/takeoff.csv`
  exists on `main` when you get here; otherwise it is hidden.
- The preliminary label stays visible.

### 5. Reform and Present
- Reform, from `agent.tsx`:
  - Chat bubbles and a large push-to-talk button wired to `agent/PushToTalk` and `ChatSheet`.
  - Rule warnings and red "Needs a licensed professional" flags, from `ProBanner`.
  - Variant tabs A, B and C, from `VariantTabs`.
  - The 3D view above the chat.
- Present: `present.tsx` is a stub in the design. Build it from the same primitives:
  - The full 3D view.
  - A "View in AR on the table" button wired to `ar/MaquetteViewer`.
  - Variants side by side.
  - A "Share with the family" button. If there is no share route yet, it copies the URL.

### 6. Polish and cleanup
- Delete leftover CSS from `styles.css` and any unused old components.
- Run a 375 px visual pass against the live design for each screen. Fix spacing and contrast.
- `npm run build` is green.

## Out of scope
- New capture modes ("Draw on the screen", "Type the measurements").
- A project backend or a list of multiple projects.
- Dark mode.
- Desktop layouts.
- Any change to `server/`.

## Report after each phase
Paste:
- the commit SHA(s) (`git log --oneline -3`);
- the vitest summary line;
- the tsc result;
- what could not be ported and why.

Never claim a run you did not do. If blocked, commit what is green, say where and why, and stop.
