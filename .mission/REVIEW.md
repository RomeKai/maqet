# REVIEW — ar-capture-walls (stage 4/4)

## Verdict: DO NOT MERGE as mission-complete. Safe to merge as a labeled increment only.

The reducer core is genuinely good — pure, well-tested, well-documented. But the
mission goal names five deliverables and only two landed. `ArMeasure.tsx` (994
lines) still runs the legacy `traceCornerTap` path, so **every tested behavior
is dead code in production**: no XR hit or tap reaches `captureReducer` tonight.

## Blockers

1. **Component wiring missing** (`web/src/measure/ArMeasure.tsx:697,661` still
   calls `traceCornerTap` / `heightFromCeilingTap`; zero imports of
   `captureSession`). W1/W2/F1/F2/F6 exist only in tests. Nothing the phone does
   tonight touches the reducer.
2. **Overlay quads missing (F3)** — `ArOverlay.tsx` untouched; no per-wall floor
   line + translucent quad, no rubber-band quad for the pending ceiling tap.
3. **i18n missing (F6 strings)** — `web/src/measure/measure.i18n.ts` was never
   created; no en/es-AR step-pill, selector, or Undo/Start-over/Done copy.
4. **Adapter flag missing (bed decision)** — `xrAdapter.ts` has no `horizontal`
   boolean on the hit payload, so the `floorHit` trust contract ("geometry stays
   in cornerMath, reducer trusts floorHit only") has no producer. The one piece
   the mission said was unverifiable-on-device wasn't even stubbed.

## Major

5. **Shared constant, two distance metrics** (`cornerMath.ts:116-119` vs
   `captureSession.ts:142-148`). `CLOSE_ROOM_M` is now 0.25 m, but
   `shouldCloseRoom` measures true-3D `distanceM` while the reducer's
   `isCloseTap` measures floor-plane. A chest-height close tap (~1.1 m above
   floor, 11 cm plan distance) is ~1.1 m in 3D: the legacy path in `ArMeasure`
   still in production **cannot close from chest height**, which is exactly what
   W2 was decided for. Widening the constant without fixing the metric gives
   false confidence. Fix: make `shouldCloseRoom` floor-plane, or delete it with
   the legacy path at wiring time.
6. **`finishWalls` after `done` still mutates** (`captureSession.ts:241-243`).
   `done` is supposed to freeze the session (base/ceiling taps correctly
   ignored), but `finishWalls` post-`done` sets `finished` and consumes undo
   depth. Guard it like the tap handlers.

## Minor

7. Finger-bounce guard uses exact float equality (`captureSession.ts:177-183`).
   XR poses rarely repeat bit-for-bit; an epsilon (~1 mm) comparison would catch
   real double-taps. HARDENING candidate.
8. No minimum wall length: a 1 mm re-tap emits a real `addWall` op and consumes
   a wall id (only the exact-duplicate case is guarded). `toSceneOps` drops only
   the exactly-degenerate pair via `pairCornersToNewWall → null`.
9. Snapshots share the `openings` array by reference (`captureSession.ts:119-126`
   shallow-copies state). Harmless while the reducer never writes `openings`,
   but part 2 (openings mission) must copy-on-write or undo will corrupt.
10. `startOver` wipes the entire undo stack (`captureSession.ts:270-274`). Fine
    per the bed decision (confirm is component-local), but an accidental confirm
    is unrecoverable — worth one line in the wiring PR.
11. `floorHit` error asymmetry: non-horizontal → silent accept, horizontal-but-
    NaN → `bad-tap` rejection. Intentional, but the HUD should know a bad datum
    was offered; document or log it at wiring time.

## What's good (keep)

- Reducer design is clean: floor-datum-wins, tap-y-never-leaks, raw-height-kept-
  with-flag, mode changes cost no undo depth, close stays one gesture after the
  snap. Comments cite the exact bed decision at each non-obvious branch.
- `toSceneOps` honors the bed decision (single `addWall`, no `setWallHeight`)
  and reuses `pairCornersToNewWall` — cornerMath stays the only geometry impl.
- Tests are real RED-first spec: 25 tests, floor datum, chaining, 0.25/0.26 m
  boundary, undo-across-taps, flagged-survives-to-ops, exact 4-wall script.
  `CLOSE_ROOM_M === 0.25` pinned. All 156 measure tests green.
- Scope discipline held: only `web/src/measure/**` touched, no `web/src/i18n/*`
  edits, no existing-export signature changes (`CLOSE_ROOM_M` value change only,
  with comment citing W2; `cornerMath.test.ts` boundary updated in the same
  diff). No Meta calls, no secrets, no cost exposure.

## Merge recommendation

- **As "ar-capture-walls complete": NO** — blockers 1–4. The branch does not do
  what the mission says.
- **As an increment ("reducer + tests, wiring follows"): YES, safe.** The diff
  is purely additive except the constant bump; full suite green. But note major
  #5 rides along: the 0.25 m bump changes live close behavior in the legacy path
  without delivering the chest-height fix it was decided for. If merged now, file
  follow-ups for blockers 1–4 + major 5–6 against the openings mission or a
  wiring fast-follow; do not let the reducer rot uncalled.
- `PROGRESS.md` intentionally untouched (stage scope: REVIEW.md only). Suggested
  HARDENING candidates for whoever writes next: #5 (3D vs floor-plane close),
  #7 (tap epsilon), #8 (min wall length), adapter-normal availability on-device
  (from PLAN.md risks), `shouldCloseRoom` removal with the legacy path.

## Stage note

Reviewed `git diff main...HEAD` (4 files, +821/−3): `captureSession.ts` (new),
`captureSession.test.ts` (new), `cornerMath.ts` (+3/−1), `cornerMath.test.ts`
(1 line). Tests run: `npm run test --prefix web -- src/measure` → 7 files,
156 passed. `tsc --noEmit` unavailable in this environment (npx could not
resolve typescript); type-safety judged by read-through only — re-run tsc in CI
before merge.
