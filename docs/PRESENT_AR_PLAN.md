# Present stage: AR on the table, improvement plan

Branch `day/present`, worktree `kit/maqet-present`, based on main at bdab613. Deadline 2026-11-04.

## Goal
On the Present stage, the family sees the measured project as a 1:50 table-top model and can place it in AR from
their own phone. Android uses Scene Viewer or WebXR; iPhone uses Quick Look with a USDZ file. Everything comes from
the Scene in `web/src/scene/store.ts` (ADR-001).

Done means:
1. On Android Chrome, the "View in AR on the table" button opens the AR viewer with the current Scene.
2. iPhone gets a USDZ.
3. Unsupported devices see a clear 3D-only fallback.
4. The web suite, tsc and the build are all green.

## Current state, verified on main
- `web/src/ar/` already contains:
  - `sceneToMaquette.ts`: Scene to three.js Group at 1:50.
  - `exportMaquette.ts`: `exportGlb` and `exportUsdz`.
  - `useMaquetteUrl.ts` and `disposeMaquette.ts`.
  - `MaquetteViewer.tsx`, `ar.i18n.ts` and `ar.css`.
  - Tests for all of the above.
- `web/src/present/PresentView.tsx` builds the GLB on demand and opens `MaquetteViewer`.
- `@google/model-viewer` is NOT a dependency, so the viewer always shows its "unavailable" fallback.
- A previous console looped forever on this task. Keep each step small, and commit after each one.

## Rules
- RED test first for every behavior change. Before EVERY commit, run
  `cd web && npx vitest run 2>&1 | tail -5`, then `npx tsc --noEmit`, then `npm run build 2>&1 | tail -5`.
  Commit only when all three are green, checking each result.
  Do not chain them with `;`.
- Conventional commits, no attribution trailers, never push.
- Do not touch `server/`, `mme/`, `.env`, `web/src/intake/**` or `web/src/measure/**`.
- Strings go in `web/src/ar/ar.i18n.ts` (en and es-AR).
- Phone first: buttons at least 48 px tall, WCAG AA contrast, and the preliminary label always visible.
- **Anti-loop rule:** if the same command fails twice, stop. Write the error and one hypothesis in your report, and
  move on to the next step, or stop. Never retry an install more than twice.

## Steps

### 1. Dependency
`npm install @google/model-viewer` in `web/`. If the install fails twice, stop and report.

Register the custom element only when needed: `await import("@google/model-viewer")` inside the viewer, so it never
loads into the main bundle or into vitest.

Add a `web/src/ar/model-viewer.d.ts` JSX typing for `<model-viewer>`, covering only the attributes used. No `any`.

### 2. MaquetteViewer renders model-viewer
- `<model-viewer>` takes:
  - `src`: the GLB object URL;
  - `ios-src`: the USDZ object URL;
  - `ar` and `ar-modes="webxr scene-viewer quick-look"`;
  - `ar-placement="floor"`;
  - `camera-controls`, `shadow-intensity="1"` and `alt` (from i18n).
- A visible "View in AR" slot button (`slot="ar-button"`), 48 px or taller.
- Build the GLB and USDZ in parallel when Present opens. Show a loading state while they build.
- Revoke the object URLs on unmount and whenever the Scene changes, reusing `useMaquetteUrl` and `disposeMaquette`.
- **Fallback:** when model-viewer fails to load, or `canActivateAR` is false after load, keep the 3D view and show:
  "AR is not available on this device. Open this page in Chrome on Android or Safari on iPhone."
- Tests, with `vi.mock` for the dynamic import:
  - the element gets `src` and `ios-src`;
  - the URLs are revoked on unmount and on Scene change;
  - the fallback text shows when the import throws;
  - the loading state shows while the exports are pending.

### 3. Scale and placement
- Default 1:50, with a small scale selector: 1:100, 1:50 or 1:20 (real-size walk-in is P1, skip it). Changing the
  scale rebuilds the models.
- Put the model's origin at the floor centre so it sits on the table, not floating.
  `sceneToMaquette` may need a translate. Test the bounding box: min y is 0 and it is centred in x and z.
- Write the scale on the viewer, for example "Scale 1:50 · preliminary".

### 4. Present screen polish
Keep the existing layout from the design (`kit/captur-ref/components/maqet/screens/present.tsx` is a stub, so follow
the patterns of the other screens):
- The AR card at the top, with the scale selector.
- Variants A, B and C, if they exist.
- "Share with the family" copies the URL, already done.

Test that the AR button exists on Present and that the preliminary label is visible.

### 5. Device notes in the report
List what only a real phone can confirm: Scene Viewer launch, Quick Look launch, placement on the table and the
apparent scale. The human tests on the phone.

## Report (final message)
- Per step: commit SHA (`git log --oneline -1`), the vitest summary line, the tsc result and the build result.
- What you could not do, and why.

Never claim a run you did not do.
