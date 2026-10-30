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
