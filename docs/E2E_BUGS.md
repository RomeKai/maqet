# E2E bugs: phone hunt (Playwright)

- **Branch / base:** `day/e2e2`, cut from `main` 662a4f5. Product code untouched.
- **Devices:** Pixel 7 emulation (412x915) and a small phone (360x740), Chromium, touch.
- **Run:** `cd web && E2E_WEB_PORT=5350 E2E_API_PORT=8050 MME_MODE=replay npm run e2e:hunt` (replay server, fresh DB, agent turns / renders mocked with `page.route`, $0).
- **Specs:** `web/e2e/hunt/journey.spec.ts` (full demo path x2 profiles + per-screen checklist), `web/e2e/hunt/edge.spec.ts` (edge cases), `web/e2e/hunt/helpers.ts`.
- **Per-screen checklist** (every screen in the journey): no console errors / failed requests, no horizontal overflow, tap targets >= 44 px, no overlapping hit-testable controls, no clipped button text, Preliminary label visible, screenshot.
- **Screenshots:** `web/e2e/screenshots/hunt/` (key ones committed, the rest regenerate on each run).
- Each known bug is kept as `test.fail` (flips red when fixed) with its `E2E-xxx` id.

## Result of the last run

298 passed (of which 17 are expected-fail product bugs), 4 skipped (`test.fixme`, E2E-010), 1 infra timeout on a `page.reload` wait that was fixed (waitUntil domcontentloaded) and re-verified alone: 2 passed. 0 unexplained failures.
Notes: the git worktree reuses `../maqet/web/node_modules` through a junction, which makes Vite answer 403 for the font files; the monitor tolerates `@fontsource` for that reason only (test setup artifact, not a product bug).

## Regression checks for the old suite (maqet-e2e, base 49b96cb)

| Old id | Status on 662a4f5 |
| --- | --- |
| E2E-001 `/variants` 404 on empty DB | Fixed: `edge cases: empty database` passes, Home has no console errors |
| E2E-002 Edit measures 422 on sample room | Fixed: Edit measures 4x8 gives 32.0 m2 and Undo gives 24.0 m2 |
| E2E-003 DXF blocked "confirm scale" | Fixed: Download DXF saves a file with A-WALL, A-DOOR, A-GLAZ, A-FLOR-FURN |
| E2E-004 AR-unavailable notice racy on desktop | Not re-tested here (ar-flow.spec covers the AR card on a fake WebXR) |
| E2E-005 agent turn 500 shown raw | Fixed in `1f35dca` (see below) |
| KB-1 variants lose edits | Not reproduced: conversation and scene edits survive switching Now/A/fork in the mocked flow |
| KB-2 second turn does nothing | Not reproduced: two consecutive mocked turns both render |
| KB-3 / KB-4 | Need a live agent / AR device; not reproducible with mocks |

## Bugs, ranked by demo impact

### E2E-008 Capture Check: "Looks right" is covered by the 3D sheet (suspected demo-blocking)
- **Status:** Fixed in `a7ba3e2` (marker removed from the e2e test).
- **Severity:** demo-blocking (confirm on a device: the test shows the centre of the button is not hit-testable)
- **Screen:** Capture > Check, both phones
- **Steps:** sample sketch > Next, Next (Check step).
- **Expected:** the Check list and the "Looks right" button are visible and tappable.
- **Actual:** the 3D sheet opens expanded over the editor and the plan canvas is cropped; `elementFromPoint` at the button's centre is not the button, and the button is not in the screenshot.
- **Screenshot:** `web/e2e/screenshots/hunt/pixel7-capture-check.png`
- **Suspected files:** `web/src/view3d/MaquetteSheet.tsx` (initial expanded state on Check), `web/src/intake/IntakeScreen.tsx` / `CheckList.tsx`.
- **Test:** `journey: Check step keeps its list and Looks right reachable above the 3D sheet` (test.fail).

### E2E-005 Agent turn errors are shown raw (409 and 500)
- **Status:** Fixed in `1f35dca` (marker removed from the e2e test).
- **Severity:** major (the demo's likely failure mode)
- **Screen:** Reform / Design chat
- **Steps:** a turn answers 409 (replay miss) or 500.
- **Expected:** one friendly sentence (`chat.errorFallback` style), details behind a disclosure.
- **Actual:** `Agent request failed (409): no recorded response for this request` / `Agent request failed (500): Preliminary: something unexpected failed on the server; no scene was stored.`
- **Screenshot:** `web/e2e/screenshots/hunt/edge-turn-500.png`, `edge-turn-409.png`
- **Suspected files:** `web/src/agent/agentApi.ts` (error formatting), `web/src/App.tsx` (agentError).
- **Tests:** `edge: replay 409 ...`, `edge: server 500 ...` (test.fail).

### E2E-007 Reload mid-flow drops the whole project
- **Status:** Fixed in `8362c79` (marker removed from the e2e test).
- **Severity:** major (Home promises "Changes are saved on this phone")
- **Screen:** any stage after Capture
- **Steps:** sample sketch > Reform > reload the page.
- **Expected:** the project and stage come back.
- **Actual:** back to Home with nothing; the app never writes to localStorage/IndexedDB (`rg localStorage|indexedDB` finds nothing outside AR code).
- **Suspected files:** `web/src/App.tsx` (state only in memory), `web/src/home/HomeScreen.tsx` (offline copy).
- **Test:** `journey: reload mid-flow keeps the project` (test.fail).

### E2E-013 Offline turn shows the raw "Failed to fetch"
- **Status:** Fixed in `33ecfe8` (marker removed from the e2e test).
- **Severity:** major (Home advertises that it works offline)
- **Screen:** Reform chat, `context.setOffline(true)`
- **Expected:** a friendly "no connection, try again" message.
- **Actual:** `Failed to fetch`.
- **Suspected files:** `web/src/agent/agentApi.ts`.
- **Test:** `edge: offline ...` (test.fail).

### E2E-011 A pending agent turn cannot be cancelled
- **Status:** Fixed in `ee50b55` (marker removed from the e2e test).
- **Severity:** major
- **Screen:** Reform chat with a 30 s turn
- **Expected:** "Working on it..." plus a Cancel/Stop control.
- **Actual:** the pending text shows, no cancel control.
- **Screenshot:** `web/e2e/screenshots/hunt/edge-turn-slow-pending.png`
- **Suspected files:** `web/src/agent/ChatSheet.tsx`, `web/src/App.tsx` (no AbortController).
- **Test:** `edge: a slow turn ...` (test.fail).

### E2E-012 Landscape: the chat input leaves the viewport
- **Status:** Fixed in `dafdb97` (marker removed from the e2e test).
- **Severity:** minor (rotation mid-demo)
- **Screen:** Reform, 915x412
- **Actual:** the message input's bottom edge is at 508 px in a 412 px viewport.
- **Screenshot:** `web/e2e/screenshots/hunt/edge-rotate-landscape.png`
- **Suspected files:** `web/src/agent/agent.css`, `web/src/agent/ReformScreen.tsx` (38dvh hero min height).
- **Test:** `edge: rotating the viewport ...` (test.fail).

### E2E-010 Deliver "Plan snapshot" intermittently never appears
- **Status:** Fixed (fix is by construction: SVG namespace + revoke-on-replace; the race was never deterministic, so only a phone confirms it) in `81959cd` (marker removed from the e2e test).
- **Severity:** minor
- **Screen:** Deliver
- **Steps:** reach Deliver (with or without furniture).
- **Actual:** sometimes `/scene/snapshot.svg` answers 200 with valid SVG but no `<img>` is rendered (card hidden). Suspected race: the effect in `DeliverView` revokes/ignores the result when `scene` changes identity before the fetch resolves.
- **Suspected files:** `web/src/deliver/DeliverView.tsx` (effect on `[scene, locale]`).
- **Tests:** the two `deliver: Plan snapshot ...` tests are `test.fixme` because the failure is not deterministic.

### E2E-009 Corner handles: wrong label, overlap with stepper/toolbar, undraggable on 360 px
- **Status:** Fixed in `5b736dc` (marker removed from the e2e test).
- **Severity:** minor
- **Screen:** Capture walls / check / 3D
- **Actual:** every corner handle button is named "Plan editor" (same as the canvas), handle buttons overlap the Wall/Window toolbar buttons (48x5/7 px) and, on Check/3D, the "Reform" stepper tab (48x15 px) because they are not clipped with the canvas; on 360 px the first handle cannot be dragged.
- **Screenshot:** `web/e2e/screenshots/hunt/pixel7-capture-walls.png`, `pixel7-capture-check.png`
- **Suspected files:** `web/src/intake/CornerEditor.tsx` (`handle-btn`, around line 829).
- **Tests:** `screen checks pixel7 capture-walls|capture-check|capture-3d: overlap`, `journey small360: dragging a corner` (test.fail).

### E2E-006 No Redo in the plan editor
- **Status:** Fixed in `ebf7b2a` (marker removed from the e2e test).
- **Severity:** minor
- **Screen:** Capture editor toolbar (Undo exists, Redo does not).
- **Suspected files:** `web/src/intake/IntakeScreen.tsx`, history hook.
- **Test:** `journey: capture C: undo, redo` (test.fail).

### E2E-014 "Needs a licensed professional" disclosure is 36 px tall
- **Status:** Fixed in `e088876` (marker removed from the e2e test).
- **Severity:** minor (tap target)
- **Screen:** Deliver, both phones, when flags are present (appears once furniture is placed).
- **Actual:** `summary` 360x36 px.
- **Screenshot:** `web/e2e/screenshots/hunt/pixel7-deliver.png`
- **Suspected files:** `web/src/deliver/DeliverView.tsx` / `ProBanner.tsx`.
- **Test:** `screen checks ... deliver: targets` (test.fail).

## Open

E2E-004 was not reproduced on `day/bugfix`. In a full parallel `npm run e2e` run, `scene-continuity` (variant switch) fails intermittently; it fails the same way on the base commit 683bd2c (shared server variant state across workers) and passes with `--workers=1` (327 passed).

## Verified working (no bug found)

Home and method cards (AR card hidden without WebXR; draw/type cards disabled and labelled Soon), sample sketch, wall length sheet, door and window via the edit sheet, undo, reset to sketch reading, 3D, mocked add_room turn, tool errors as one sentence with raw codes behind Details, Fork and per-variant conversations, Now read-only, Edit measures plus Undo, Design add / move / rotate / move-to-wall / remove, finishes, In real life (guide PNG sent, image shown in sheet and thumbnail), In real life above the AR card on Present, share link, DXF layers and non-empty files, CSV download, no raw catalog ids in the takeoff, ES on Design / Present / Deliver / Reform with no English markers, es-AR flags deduped and translated, double-tap Send submits once, a very long message at 360 px, empty DB. Per-screen overflow, clipping and Preliminary checks pass everywhere.

## Not covered

Mode A beyond the card/denied states (ar-flow.spec.ts on main covers the fake-WebXR capture), real AR on a device, live Meta calls, iPhone/WebKit, real microphone.
