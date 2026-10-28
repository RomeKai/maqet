# Submission checklist

Meta Global AI Developer Hackathon. **Track: Indie Developer.** **Theme: Build for Your World.**
**Submit at:** https://cerebralvalley.ai/e/meta-ai-developer-hackathon/hackathon/submit

> **Provenance warning.** The official rules text is **not stored in this repository**. This checklist is assembled from
> what the repo records about them (`PLAN.md`, `HARDENING.md` D1, `README.md`, `mme/milestones.yaml`). Each item names its
> source. Items marked **VERIFY** are things we believe from our own docs but could not confirm against the rules text:
> the human must check them against the official rules page and the Discord answers before submitting, and replace this
> note with the link to the rules.

## Deadlines

| What | When |
|---|---|
| **Internal deadline: submit** | Wed 2026-11-04, **18:00** Buenos Aires (GMT-3) |
| **Official deadline** | Wed 2026-11-04, **9:00 PM ET** (21:00 GMT-5) = **23:00** Buenos Aires |
| Feature freeze | Mon 2026-11-02 (PLAN day 8): fixes, polish and recording only |
| Demo recorded | Mon 2026-11-02 to Tue 11-03 |
| Deploy, README, final video | Tue 2026-11-03 |

Source: the organizers (Discord), confirmed by the human. 9:00 PM ET on Nov 4 is 21:00 GMT-5 (US daylight saving ended
Nov 1) and 23:00 in Buenos Aires (GMT-3). **VERIFY** the deadline the submission page itself displays when you open it.

## Judging criteria (what the submission text and video must serve)

| Criterion | Weight | Where we answer it |
|---|---|---|
| Impact | 30% | README "Motivation" and "Who it's for"; cited sources in `PRODUCT.md`; the story of Rosa |
| Use of Meta AI tools ("go beyond a basic integration") | 25% | README "How Meta models are used": five models, each bounded by deterministic code |
| Technical depth | 20% | One measured Scene as source of truth, validated tools, construction rules in code, replay tests, DXF audited in tests |
| Demo (3-minute video) | 25% | [`DEMO.md`](DEMO.md) |

Source: `docs/PLAN.md`. Bonus prizes we target: **Best Agentic Use-Case** (a tool-calling agent bounded by deterministic
rules) and **Best Creative Build** (sketch to staged material list). Mention both categories in the submission text.

## Required deliverables

- [ ] **Public repository** with source, `LICENSE` (MIT, present) and a README that runs in replay mode without a key.
      **VERIFY** whether the rules require the repo to be public, a specific license, or a judge access list.
- [ ] **Demo video, 3 minutes maximum**, uploaded and publicly viewable (YouTube, Loom, Vimeo or Drive). Spoken Spanish,
      English subtitles burned in or as SRT. See [`DEMO.md`](DEMO.md). **VERIFY** the maximum length and hosting options.
- [ ] **README links the video**: replace the placeholder under the title. The Day 9 gate greps for
      `youtu|loom|vimeo|drive.google`, `muse` and `preliminary|not a structural` (`mme/milestones.yaml`); today the link
      placeholder would fail it.
- [ ] **Text description** (project name and tagline, problem, solution, Meta models used, what is built, what is next).
      Reuse README sections; keep the tagline with the name ("Maqet: from sketch to AR to staged materials").
- [ ] **Track selected: Indie Developer.** **VERIFY** team-size and eligibility rules for the track.
- [ ] **Working access for judges**: either a deployed URL or the replay-mode instructions in the README. If a URL is
      deployed, it must be HTTPS (AR, camera, mic) and work in `MME_MODE=replay` so judges spend no credits.
- [ ] **Submitted before 18:00 ART**, not at 22:50. Take a screenshot of the confirmation page.

## Rules-driven disclosures

- [ ] **Identify your contributions.** The README section "Built during the hackathon" states that the product
      (`server/`, `web/`, `assets/`, `samples/`) was built Oct 26 to Nov 4, 2026, with first commit `9af461d`
      (2026-10-26) as evidence: it has no product code. It also lists what was prepared before kickoff: planning docs,
      agent config, and `mme/` (config for a pre-existing personal dev-tooling harness, not part of the product). The demo
      shows only Maqet. The video opens with the required sentence: *"Planning docs and agent tooling were prepared before
      kickoff; all code you'll see was built this week."* **VERIFY** the exact wording of the rule once `RULES.md` exists,
      and keep any written organizer confirmation (screenshot or Discord link) with the submission materials.
- [ ] **Disclose the `mme.client` dependency.** The product's Meta calls import `mme.client` (`server/intake/read_plan.py`,
      `server/intake/voice.py`), a module of the pre-existing harness that is installed separately and is not in
      `server/requirements.txt`. Decide before submitting whether to vendor a minimal client into this repo (so a fresh
      clone runs) or disclose it as a pre-existing personal tool; the README currently discloses it.
- [ ] **Repository created after kickoff** (Oct 26, 2026) with no pre-existing product code. Check `git log --reverse | head`
      and make sure no history was rewritten or imported.
- [ ] **AI usage disclosure** is complete and linked: [`AI_USAGE.md`](AI_USAGE.md) records the harness and provider per
      session. The log includes a `manual` row for Claude used for planning and documentation outside the gateway, and
      Claude Code is also used for development. **VERIFY** the Discord answers to the three questions in `PLAN.md`
      (are non-Meta coding assistants allowed? must AI use be declared? may we use our own open-source tooling such as MME?)
      and that `MME_POLICY` in `mme/policy.env` (currently `meta-first`) matches the answer.
- [ ] **Third-party material is licensed and declared.** ECC rule packs in `.claude/rules/ecc/` (MIT, with their
      `LICENSE`); sample inputs are original work, CC0 (`samples/plans/SOURCES.md`); assets are CC0 with source and license in
      `assets/catalog.json` (tested by `tests/test_catalog.py`). No CubiCasa5K or web images.
- [ ] **No "simple image analyzer".** The video must reach the voice reform agent and a deliverable early, and the text
      must lead with measured design and the staged takeoff, not "AI reads a plan photo" (`HARDENING.md` D1). **VERIFY** the
      exact wording of the rule.
- [ ] **No secrets in the repo or video.** `.env`, API keys, gateway keys and admin keys are not committed or visible on
      screen. Run a secret scan on the final commit (`git log -p | rg -i "sk-|api[_-]?key|secret"` as a first pass).
- [ ] **No personal data.** Only synthetic or consented inputs appear on screen; no real family, no real address.

## Honesty and safety checks (ours, not from the rules)

- [ ] Every output screen and the DXF notes say **Preliminary**. No claim of structural certification anywhere (README,
      video, text description).
- [ ] The **needs a licensed professional** flag is shown at least once in the video.
- [ ] Statistics are cited exactly as in `PRODUCT.md` (4 million people, Habitat for Humanity 2022 / RENABAP). The "over
      60% of Latin America" figure is a secondary source: leave it out of the video.
- [ ] README "What you can run today" matches `main` on the final commit: nothing marked "Works" that does not, nothing
      shown in the video that is marked "Planned".
- [ ] Name check: always write "Maqet" with its tagline. A trademark search is a post-hackathon task (`PRODUCT.md`).

## Technical gates before submitting (the human runs these)

- [ ] `mme gate` green on `main`; `mme ship` passes (README, replay dir, extra checks in `mme/milestones.yaml`).
- [ ] `cd server && MME_MODE=replay python -m pytest -q` passes offline.
- [ ] `cd web && npm run build && npm test` passes.
- [ ] Full flow in replay: upload to Scene to reform to takeoff to DXF (`tests/test_e2e_flow.py`).
- [ ] Fresh clone test: clone the repo into an empty directory, follow the README only, reach the Capture screen with a
      sample loaded. Fix the README, not your memory.
- [ ] Both phones: AR measuring on the Android phone; AR maquette on iPhone and Android (`ADR-012`).
- [ ] Budget: `mme credits` reviewed; no live calls left in the demo path.

## Submission-day sequence

1. 12:00: freeze verified, video exported, SRT checked, README link filled in.
2. 14:00: fresh-clone test and secret scan on the final commit; tag it (`git tag submission`).
3. 15:00: upload the video, open the submission form, paste the text, attach links.
4. 16:30: judge-eyes read of the repo from a logged-out browser: README renders, video plays with sound and subtitles,
   links work, no private paths.
5. **18:00: submit.** Save the confirmation. Anything after this is buffer for portal problems, not for work.
6. After submitting: do not push to the submitted branch unless the rules allow edits (**VERIFY**).

## Open questions for the human

1. Where are the official rules? Add the link at the top of this file and resolve every **VERIFY** item.
2. Did the organizers' confirmation about pre-kickoff planning docs come in writing? Where is it saved?
3. What were the Discord answers on non-Meta coding assistants and AI disclosure? The AI usage table must reflect them.
4. Is a deployed URL required, or are repo plus video enough? (`milestones.yaml` allows submitting with the replay-mode
   front end and the video if the back-end deploy is cut.)
