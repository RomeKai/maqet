# AR fix report (branch day/ar-fix)

Unattended run. Status per item, with SHAs, gate tails and what only a phone can confirm.
Gates were run with `MME_MODE=replay`; the venv is the main repo one (`../maqet/.venv`).

## Item 0 - ceiling height blocked walls 2..N (human phone test): DONE (unit level), SHA 2df4507

Root causes found in code:
1. **Stale closure (most likely why the ceiling "could not be selected").** `ArMeasure.handleStart`
   built the XR callbacks once, closing over `capture` from the render in which Start was tapped
   (always the empty initial state). Every later tap therefore saw `floorY === null`, no pending
   wall and step "floor", so the ceiling tap could never fire. Fixed: state now lives in a ref
   (`captureRef`) that every callback reads (`send()` runs the reducer on the ref, then mirrors to React state).
2. **Height asked once per wall.** The reducer required a ceiling tap after every wall and kept
   implausible heights as flags. Now the room has ONE height (`roomHeightM`), captured on wall 1
   (camera ray, typed value or the 2.60 m default button). Walls 2..N complete with a single base tap
   and inherit it. The closing tap now completes and closes the room in one gesture.
3. Range 2.0-4.0 m is enforced at entry: an out-of-range value is rejected with the pill
   "Height must be between 2.0 and 4.0 m. Type it or use 2.60 m" (nothing changes, retype or use 2.60 m).
4. Per-wall override: `setWallHeight` event + HUD "Wall N height: X (change)" disclosure with a numeric
   input. `setRoomHeight` re-applies the room height to every wall that was not overridden by hand.
   The manual input and the 2.60 m button are always visible on the height step; the camera ray is only a helper.

Scene model: `Wall.height_m` is already optional with fallback to `Scene.ceiling_height_m`; no model change needed.
Outputs: 3D (`wallHeightM`) and the GLB (same meshes) and the takeoff (`_wall_height`) already use the per-wall value.
The DXF is a plan view and carries no wall heights (nothing to reflect). Tests: reducer
(`captureSession.roomHeight.test.ts`), scene+3D (`wallHeightHud.test.tsx`), takeoff
(`test_per_wall_height_override_lowers_wall_quantities`).

Merge of day/ar-capture: clean merge (e137cf5), 651 web tests green before item 0.
Branches night/...ar-capture-openings and ...ar-capture-walls have no commits beyond main (already in);
night/20261028-ar-capture-v2 only adds an unused i18n file, not ported.

Phone only: that taps actually reach the corrected flow on the device, ray accuracy on the ceiling.

## Item 2 - Mode A audit and hand-off: DONE (unit level)

Found and fixed:
- **Review sheet was unreachable.** `Done` called `onDone`, which unmounts ArMeasure, and the XR end callback reset the
  screen to the start card. Now Done applies the ops, ends the XR session, shows the review (labelled inputs, 48 px,
  heights validated 2.0-4.0 m, "Looks right" skip) and only then calls `onDone`.
- **Hand-off parity with Mode C:** `toHandoffOps` adds a `room-1` on the closed polygon (new `addRoom` web op) and
  `confirmScale` (all walls are `measured_ar`), so the 3D floor, wall labels, openings (windows keep the tapped sill,
  doors none) and server `add_room` placement on walls work like Mode C. After Done, IntakeScreen shows a "Room captured
  with AR" card with "Looks right" (goes to Reform) and "Measure again" (it used to fall back to the upload step).
- **Errors:** start failures are classified (permission denied, unsupported, not HTTPS, stuck, other) with a friendly
  en/es-AR line plus the raw detail; failed and unsupported screens offer plan photo / sketch fallbacks (Mode B / C).
- **Tracking lost:** new `onTrackingChange` adapter callback (no viewer pose) turns the pill into
  "Tracking lost. Move the phone slowly and point at the floor."
- Tap targets in the AR HUD, start card, confirm and review are at least 48 px (CSS).
- Not ported: night/20261028-ar-capture-v2 (an unused i18n file only).
- Known simplification: AR walls are created as `interior`, 0.10 m (cornerMath default); the review/editor can change it.

## Item 3 - Present AR on the table: DONE (unit level)

Diagnosis of Scene Viewer "not-presenting" (from the code; only a phone confirms):
1. **Race with the upload.** The AR button was enabled as soon as the blob GLB existed, but the hosted https copy
   arrives later. Until then `src` was a `blob:` URL, which Scene Viewer (a separate app) cannot read. Fixed: the button
   is disabled until the upload settles ("Preparing the model for AR apps..."), and `ar-modes` is `webxr` only when no
   hosted copy exists (`arModesFor`). A visible note explains when hosting failed.
2. **Untrusted certificate.** The hosted URL is absolute (`absoluteModelUrl`: page origin + `/api/ar/model/<id>.glb`), but
   on the dev server the origin is a self-signed HTTPS cert (HARDENING I14). The page works because the human accepted
   it; Scene Viewer does its own fetch and rejects it. Code cannot fix that. Mitigation: the failure notice names this cause when
   the origin looks untrusted (`likelyUntrustedHost`: IP, localhost, .local, http), and offers WebXR. Real fix for Scene
   Viewer: serve from a trusted https host (tunnel such as cloudflared/ngrok, or a real cert).
3. **No signal on failure.** `ar-status` is now logged (`[ar-status]`) and tracked (`nextAttempt`): a `not-presenting`
   with no preceding `session-started` or `failed` shows a clear message and a "Try again with WebXR" button
   (re-activates with `ar-modes="webxr"`).
- Openings: tests prove doors/windows use OPENING_THEME colors (window translucent) in the maquette and in the exported GLB,
  and that the window sill is honored (bottom at sill_m, top at sill_m + height_m, door from the floor).
- Phone only: whether Scene Viewer opens over a trusted tunnel; WebXR retry actually presenting.

## Item 4 - Reliability guards: DONE

- File inputs: `UploadStep.onPicked` already clears the input only after the upload settles (covered by `uploadInputs.test.tsx`); unchanged.
- Layout: the AR button lives in the sticky bottom bar of PresentView, outside the top banner flow; a Playwright spec at 412x640
  checks it is inside the viewport and not covered (`elementFromPoint`). The existing reform-chat layout spec still passes.
- Disposal: ArMeasure ends the XR session on unmount and on Done/Cancel; `useMaquetteUrl` revokes GLB/USDZ blob URLs;
  new: IntakeScreen revokes the photo object URL when replaced and on unmount.

## Item 5 - Playwright (no device, no live calls): DONE

`web/e2e/ar-flow.spec.ts` (9 tests, all pass): unsupported device has no AR card; supported device start screen with 48 px
targets; permission denied message + fallbacks; a full fake-WebXR 4-wall session (real adapter code path) with ONE height, closing tap,
review, "Room captured with AR" card and arrival in Reform; out-of-range typed height refused then per-wall override; tracking lost
guidance; Present AR button disabled until the model is hosted, WebXR-only when the upload fails, and the not-presenting ->
WebXR retry. `playwright.config.ts` now reads `E2E_WEB_PORT` / `E2E_API_PORT` (defaults 5320/8020) and finds the main repo venv from a
worktree. Run: `E2E_WEB_PORT=5330 E2E_API_PORT=8030 npx playwright test` from `web/`.
The reform-chat 412x915 test failed once on a cold first run in a full-suite run and passed alone and on re-run (timing; not changed by this work).

## Gates (final run)
- `MME_MODE=replay python -m pytest -q server`: 521 passed
- `npx vitest run`: 89 files, 697 tests passed
- `npx tsc --noEmit`: clean; `npm run build`: built
- Playwright `ar-flow.spec.ts`: 9 passed; full e2e: 13 of 14 first run, the failing one passed alone.

## Phone test checklist (human)

Prereq: `vite --host` with the self-signed cert accepted on the phone (HARDENING I14), replay or live server as you prefer.
Use Android Chrome with ARCore updated. Check the language toggle once (en and es-AR) in each screen below.

### Mode A (AR measure)
1. Home -> Start capture. The "AR measure" card must be there (if not, WebXR is not available: Mode C remains).
2. Tap it, then "Measure (AR)". Allow the camera. Expected pill: "Move the phone slowly to find the floor".
3. Deny the permission once (or revoke it): expect "Camera or AR permission was denied..." with Plan / Sketch buttons and a retry.
4. Aim at the floor at the first corner and tap. Pill: "Tap the other end". Tap the second corner.
5. Pill: "Tap where the wall meets the ceiling" and a live height next to it. Aim at the wall/ceiling line and tap.
   If the number is off, type a height instead (2.0 to 4.0 m, comma or dot) and "Confirm height", or "Use 2.60 m".
   A value outside 2.0-4.0 m is refused with a message; retype. THIS IS THE FIX FOR THE EARLIER BLOCKED TAP: it must work.
6. Walls 2..N need only ONE tap each ("Wall N: tap the next corner"); no height prompt again.
7. Tap near the first corner to close the room. Pill: "Room captured".
8. Optional: open "Wall N height ... (change)" and type 2.40 for one wall.
9. Door / Window modes unlock after closing; capture one of each (two taps each).
10. Cover the camera for a second: pill must say "Tracking lost..." and recover.
11. Tap Done. Review sheet: values are editable, "Looks right" continues. Then "Room captured with AR" -> "Looks right".
12. Reform stage: 3D shows the room with floor, wall labels, door/window colors; ask the agent to add a room on a wall.
13. Check that every AR button is easy to hit (48 px) and that nothing is hidden behind the bottom bar.

### Present AR on the table
1. With a scene, open Present. The AR button reads "Building the maquette..." then "Preparing the model for AR apps..." then "View in AR on the table".
2. Tap it. WebXR should place the maquette on the table (worked before).
3. Scene Viewer: this needs a TRUSTED https host. With the self-signed dev URL it will likely fail: expect the message
   "AR could not show the maquette..." with the certificate hint and a "Try again with WebXR" button. Tap the button: WebXR must open.
   For Scene Viewer to succeed, open the app through a trusted https tunnel (cloudflared/ngrok) and repeat.
4. Look at the doors (orange) and windows (light blue, translucent); the window must float at its sill height, the door touches the floor.
5. With a professional-flag banner visible (e.g. add a second floor), confirm the AR button is still fully visible.
6. In Chrome remote debugging, look for `[ar-status]` and `[ar-host]` console lines to report what happened.

## Open issues
- Everything above is verified by unit tests, a real-browser run with a fake WebXR session and mocked hosting; none of it ran on a phone.
- Scene Viewer cannot be fixed from code on a self-signed origin (see item 3); needs a trusted https host.
- DXF is a plan view and has no wall heights; per-wall heights are carried by 3D, GLB and takeoff only.
- AR walls are saved as `interior` 0.10 m; the user may need to mark exterior walls in the editor.
- The wall height override form is on the HUD for the LAST wall only; earlier walls are editable in the review sheet.
