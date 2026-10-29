# REVIEW — scene-snapshot (stage 4/4: review)

Scope reviewed: `git diff main...HEAD` = purely additive, 676 insertions, 0 deletions:
`server/render/snapshot.py` (new), `server/render/__init__.py` (new),
`server/tests/test_snapshot.py` (new), `.mission/PLAN.md`, `.mission/PROGRESS.md`.
Zero existing files touched — causation of any outside failure is impossible by construction.

Verified: snapshot suite 18/18 green; full suite 240 passed, 10 skipped, 2 failed —
both failures are `test_voice.py` replay-fixture misses (no cached ASR responses),
unrelated to this change (no shared code path; documented since stage 2).

Contract check vs. the pre-bed decisions: all hold.
`render_snapshot(scene, locale='en') -> str` + `SUPPORTED_LOCALES` ✓;
`Preliminary`/`Preliminar` + `1f`/comma areas ✓; 100 px = 1 m with adaptive
{1,2,5}×10ⁿ bar + `data-meters` ✓; walls split at openings, door arc+leaf,
window double-line ✓; bounds+0.5 m margin, 3-decimal `_fmt`, sorted-by-id order,
empty → `viewBox '0 0 100 100'` + label ✓. No model calls, no new deps
(imports: `math`, `xml.etree`, `server.scene.models` only). No `xmlns` is a
documented inline-embedding choice, and `ET.fromstring` parses it — valid XML ✓.
Room names go through ET text/attribute serialization, so `&`/`<` escaping is
handled by the stdlib, not by hand — correct.

## Findings

### Blocker — none.

### Major — none.

### Minor

- `server/render/snapshot.py:59` — `_wall_frame(wall)` param unannotated.
  Same at `server/render/snapshot.py:69` (`_furniture_corners(f)`).
  Repo style (AGENTS.md) is type hints on signatures; the rest of the file complies.
- `server/render/snapshot.py:192` — `by_wall: dict[str, list]` uses a bare
  `list` generic; `dict[str, list[Opening]]` states the intent. Cosmetic only.
- `server/render/snapshot.py:53` — `_centroid` is the vertex mean, not the area
  centroid. Fine for convex rooms, but for strongly concave polygons the label
  anchor can land off-polygon (the L-fixture lands on the inner-corner edge by
  luck of the numbers). Acceptable for a P0 deterministic snapshot; if labels
  ever misplace, switch to a point-in-polygon anchor. No action required tonight.

## Merge recommendation

**MERGE.** Clean, in-scope, fully tested additive change; implementation matches
every pre-bed decision; determinism and XML validity proven by tests, not by eye.
The two `test_voice` failures are pre-existing replay-fixture gaps, out of scope.
Suggested follow-ups (not merge blockers): annotate the two private helpers,
and consider a point-in-polygon room-label anchor if concave rooms misplace labels.
