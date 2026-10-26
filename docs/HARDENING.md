# Hardening backlog

Living list of assumptions, shortcuts and patches taken to ship the hackathon build. If budget is left over, spend
one or two days here. Each item: what we assumed or patched, why it matters, and the fix. Priority: **H** (affects a
real family's result), **M** (robustness/UX), **L** (polish). Status: open / done.

## Product: intake (plan and sketch reading)
| # | Pri | Assumption or patch | Why it matters | Hardening |
|---|---|---|---|---|
| I1 | H | Openings in hand sketches are often missed (Spark found 2 of 5 in `croquis_ampliacion`, baseline 2026-10-26) | Missing doors/windows break ventilation rules and the takeoff | Prompt iteration on sketches; SAM 3.1 cross-check on site photos; UI nudge "check doors and windows" before confirming |
| I2 | H | Cleanup closes too few rooms (1 of 3 on `plano_48m`) | Room areas drive the minimum-area rules and the takeoff | Split walls at T-junctions before polygonizing; snap labels to the nearest closed polygon; test per sample |
| I3 | M | Spark returns whole walls; ground truth is split into segments | `segment_iou` reads near 0 even when the plan is right | Keep `segment_iou`, report area IoU of rooms and `wall_length_ratio` as primary metrics |
| I4 | M | Perspective correction cut (`cut_if_late`): photos assumed taken flat | Oblique phone photos distort lengths | Four-corner homography in the editor before scaling |
| I5 | M | Written dimensions: the model transcribes text, the pairing with a wall can be wrong (global scale superseded by per-wall constraints, see I11) | A wrong pairing gives one wrong wall | Attach each dimension to its wall in cleanup; flag contradictions beyond 3% in the solver |
| I6 | M | One retry on schema validation, then a hard failure | A flaky response leaves the technician stuck | User-facing message + manual-trace fallback (draw walls by hand) |
| I7 | M | `max_tokens` 16384; Spark reasons 1k to 8k tokens first | Truncation returns no content (`EmptyResponse`) | Surface it as "try again", log reasoning tokens per call, alert if near the cap |
| I8 | M | Spark calls take 30 to 60 s (reasoning) | Feels broken on site | Progress state with copy; allow editing while waiting; timeout with retry |
| I9 | M | Images downscaled to 2048 px, EXIF orientation fixed | Very small text on big plans may become unreadable | Tile large plans or crop to the drawing before sending |
| I10 | L | Demo inputs are synthetic (generated, CC0) | Real sketches are messier (pencil, shadows, folds) | Collect 5 to 10 real sketches with consent (no personal data) and rerun the report |
| I11 | H | A single global scale (one known dimension) was the first approach; real hand sketches are not drawn to proportion, and the synthetic demo sketches are proportional so tests missed it | Every wall but the measured one comes out wrong on a real croquis | Per-wall constraints with a deterministic solver (ADR-025); a deliberately non-proportional sketch fixture; provenance per wall, `estimated` where no measurement exists |
| I12 | M | WebXR (Mode A) is unsupported on iOS Safari; AR precision depends on lighting and floor texture | iPhone users cannot use A; poor tracking gives centimeter errors that reach the takeoff | Feature-detect and offer modes B/C; show tracking state; let the technician re-tap corners and compare with a tape reading; label `measured_ar` precision as indicative |
| I13 | L | The web editor UI (corner editor, taps, AR view) is tested at logic level, not at component or touch level | Touch regressions only show on a real phone | Component tests with pointer events; a Playwright mobile viewport smoke test; manual pass on both phones before freeze |
| I14 | M | WebXR `immersive-ar` only runs in a secure context (HTTPS): the dev web over the LAN (`http://192.168.x.x:5173`) fails, and a self-signed certificate must be accepted on the phone | Mode A looks "broken" on the phone for a reason unrelated to our code; the demo host must also be HTTPS | Serve dev with `@vitejs/plugin-basic-ssl` + `vite --host` (or a tunnel); verify the device with the official immersive-web hit-test sample first; if WebXR fails on the demo device, the demo uses Mode B |
| I15 | M | Server warnings are free-text English strings (e.g. `kind_defaulted: null kind -> exterior, confirm with human`), one was mixed English/Spanish | If the UI shows them raw they are untranslated in both locales and too technical for a technician | Server returns warning codes + params only (`{"code": "kind_defaulted", "wall": 3}`); the web maps codes to plain es-AR/en strings in the i18n dictionary; test that every code has both translations |

## Product: rules and takeoff
| # | Pri | Assumption or patch | Why it matters | Hardening |
|---|---|---|---|---|
| R1 | H | All values in `server/scene/rules.py` are unverified rules of thumb | A family may trust a "passes" result | Review with an architect or master builder; per-jurisdiction rule sets (CABA Ley 6100, provinces) |
| R2 | H | Window-to-floor ratio 1/10 conflicts with a GCBA secondary source (lighting 20%, ventilation 1/3 of it) | Wrong ventilation verdicts | Resolve with the current code text; make the ratio jurisdiction-specific |
| R3 | H | Material recipes for the staged takeoff are rules of thumb (to be built, ADR-024) | Over- or under-buying wastes savings | Validate recipes with a builder or supplier tables; show ranges, not single numbers |
| R4 | M | Geometric comparisons use `tol + 1e-9` | Float noise at tolerance boundaries | Central `geom.approx_le` helper used everywhere; property tests |

## Product: privacy and cost
| # | Pri | Assumption or patch | Why it matters | Hardening |
|---|---|---|---|---|
| P1 | H | Contributor models may train on inputs; the demo uses only synthetic data | Real family homes and sketches are personal data | `MME_PRIVATE=1` (standard models) for any real use; consent notice in the UI |
| P2 | M | Contributor rate limit is lower (150 vs 3000 in the price table); the gateway falls back to standard | Bursts cost about 19x more on fallback | Queue intake calls; alert when fallback is used |

## Process: gates and integration
| # | Pri | Assumption or patch | Why it matters | Hardening |
|---|---|---|---|---|
| Q1 | M | The Day 1 and 2 gates verified components, not integration: nothing was wired end to end (no `POST /intake`, the web never called the server, `IntakeScreen` not mounted, no `dev` script). Lesson learned 2026-10-26 | A green `mme gate` did not mean the app worked | At least one integration gate per day (route + API test, App renders the stage screen, upload -> Scene); a full-flow replay test (`test_e2e_flow.py`) |

## Dev tooling (MME, gateway, Claude Code), for reference
| # | Pri | Assumption or patch | Status |
|---|---|---|---|
| T1 | M | Meta rejects `stop_sequences`: gateway drops it (`additional_drop_params`) | done |
| T2 | M | Meta requires `max_tokens >= 16`: Claude Code `/model` probe fails; switch with `claude --model ...` | open (clamp in a LiteLLM hook) |
| T3 | M | Claude Code auto mode is unusable behind the gateway (classifier on a slow reasoning model times out) | open: use accept-edits mode |
| T4 | L | Effort / thinking parameters are dropped by LiteLLM for Spark (measured: no effect) | known |
| T5 | M | Watchdog reads LiteLLM's live counter; DB spend lags 3 to 60+ s | done |
| T6 | L | ECC plugin hooks broken on Windows; disabled by emptying the plugin's `hooks.json` (backup kept) | patched locally |
| T7 | M | Admin secrets (`LITELLM_MASTER_KEY`, etc.) live in the project `.env`; settings deny `Read(.env)` but not Bash | open ("option B" declined) |
| T8 | L | Windows: gates/missions now run through Git Bash; scripts expect LF | done |
