# Submission checklist

Meta Global AI Developer Hackathon. **Track: Indie Developer.** **Theme: Build for Your World.**
**Submit at:** https://cerebralvalley.ai/e/meta-ai-developer-hackathon/hackathon/submit

Official rules: [`RULES.md`](RULES.md) (copied verbatim from the hackathon Discord; there is no rules web page). Rule-derived
items below quote it. Items tagged **(our own)** come from our docs, not from the rules. Anything marked **VERIFY** is a
question the rules do not answer; ask the organizers in Discord and save the reply.

## Deadlines

| What | When |
|---|---|
| **Internal deadline: submit** | Wed 2026-11-04, **18:00** Buenos Aires (GMT-3) |
| **Official deadline** | Wed 2026-11-04, **9:00 PM ET** = 21:00 GMT-5 = **23:00** Buenos Aires (US daylight saving ended Nov 1) |
| Feature freeze (our own) | Mon 2026-11-02 (PLAN day 8): fixes, polish and recording only |
| Demo recorded (our own) | Mon 2026-11-02 to Tue 11-03 |
| Deploy, README, final video (our own) | Tue 2026-11-03 |

## What the rules require

| Rule (from `RULES.md`) | Our status |
|---|---|
| **New work only.** "Everything you present has to be built during the hackathon, Oct 26 to Nov 4." | Product built in the window; first commit `9af461d` has no product code. **Risks:** pre-kickoff planning docs and the pre-existing MME library, see "Identify your contributions" |
| **Identify your contributions.** The demo shows only what was built during the event; "if they can't [tell what's new], the project is disqualified." | README section "Built during the hackathon" + the video's opening sentence + git history |
| **Public repo.** | Make the repo public and confirm from a logged-out browser |
| **Teams.** Max 4, solo allowed. One track only (Indie Developer or Startup). One person submits; every team member is added. | Indie Developer. Add every member on the submission form |
| **Demo video, 3 minutes**, required; "a working demo video link". | [`DEMO.md`](DEMO.md), target 2:50, hard cap 3:00 |
| **Banned projects:** legal, ethical or platform-policy violations; code, data or assets without rights; and the generic categories: AI medical or health advice, basic RAG apps, **simple image analyzers**, AI-for-education chatbots, job application screeners, nutrition coaches, personality analyzers, sports analyzers or coaches. | See "Banned projects" below |
| **Theme:** fit one problem statement. | Build for Your World: Meta's models in a domain we know (self-built housing in Argentina) |
| **Waiver:** 18+ and of legal age where you live; Meta or CV staff, contractors, government-affiliated people and their households cannot participate. | Every team member confirms; submitter confirms for the team |
| **Submission content:** public repo, working demo video link, every team member added. | No deployed URL is required by the rules. Replay-mode instructions in the README are enough; a deployed URL is optional |

## Judging criteria (our own, from `PLAN.md`; not in `RULES.md`)

| Criterion | Weight | Where we answer it |
|---|---|---|
| Impact | 30% | README "Motivation" and "Who it's for"; cited sources in `PRODUCT.md`; the story of Rosa |
| Use of Meta AI tools ("go beyond a basic integration") | 25% | README "How Meta models are used": five models, each bounded by deterministic code |
| Technical depth | 20% | One measured Scene as source of truth, validated tools, construction rules in code, replay tests, DXF audited in tests |
| Demo (3-minute video) | 25% | [`DEMO.md`](DEMO.md) |

The weights and the bonus prizes we target (**Best Agentic Use-Case**, **Best Creative Build**) are recorded in `PLAN.md`
and `PRODUCT.md` but are not in `RULES.md`. **VERIFY** them against the Discord announcement before putting them in the
submission text.

## Deliverables

- [ ] **Repository public.** Contains source, `LICENSE` (MIT, present) and a README that runs in replay mode without a key.
- [ ] **Demo video, 3:00 maximum**, publicly viewable at a link (YouTube, Loom, Vimeo or Drive; the rules only ask for a
      working link). Spoken Spanish, English subtitles burned in. See [`DEMO.md`](DEMO.md).
- [ ] **README links the video**: replace the placeholder under the title. The Day 9 gate greps for
      `youtu|loom|vimeo|drive.google`, `muse` and `preliminary|not a structural` (`mme/milestones.yaml`); today the link
      placeholder would fail it.
- [ ] **Text description** (project name and tagline, problem, solution, Meta models used, what is built, what is next).
      Reuse README sections; keep the tagline with the name ("Maqet: from sketch to AR to staged materials").
- [ ] **Track selected: Indie Developer** (and only that track).
- [ ] **Every team member added** on the submission form; one person submits.
- [ ] **Submitted before 18:00 ART**, not at 22:50. Take a screenshot of the confirmation page.

## Identify your contributions

The rule is a disqualifier, so this section is the most important one. A judge must be able to tell in two minutes what is
new. What we claim and where the evidence is:

- [ ] **Product built in the window.** The README section "Built during the hackathon" states that the product (`server/`,
      `web/`, `assets/`, `samples/`) was built Oct 26 to Nov 4, 2026. Evidence: first commit `9af461d` (2026-10-26) has no
      `server/`, `web/` or `assets/`, and `samples/` holds only two `.gitkeep` files (`git show --stat 9af461d`). Check
      `git log --reverse | head` and make sure no history was rewritten or imported.
- [ ] **Pre-kickoff material is listed, not hidden.** In the first commit: planning docs (`docs/PLAN.md`, `PRODUCT.md`,
      `DECISIONS.md`, `CUTLIST.md`, `RUNBOOK.md`), agent config (`AGENTS.md`, `CLAUDE.md`, `.claude/`) and the `mme/`
      config. None of it is product code. The video opens with the required sentence: *"Planning docs and agent tooling were
      prepared before kickoff; all code you'll see was built this week."*
- [ ] **MME is disclosed as a pre-existing dependency.** The product's Meta calls import `mme.client`
      (`server/intake/read_plan.py`, `server/intake/voice.py`). MME is an open-source dev-tooling package (MIT,
      https://github.com/RomeKai/mme, development started 2026-10-22, GitHub repo published 2026-10-28) that Maqet uses as a
      library for the Meta API client and replay cache. It is pinned to commit `e24c418` in `server/requirements.txt`
      (added in `4225340`). The README discloses it. Keep the submission text consistent with that wording.
- [ ] **The demo shows only Maqet.** No MME screens, terminals or dashboards in the video; no pre-kickoff material
      presented as new.
- [ ] **VERIFY with the organizers (highest risk):** "Everything you present has to be built during the hackathon" can be read
      strictly. MME predates kickoff (Oct 22) and the planning docs predate it too. Post a short disclosure in Discord
      (what MME is, that it is an open-source library used for the API client and replay cache, the link, the pinned commit)
      and ask whether that is acceptable. Save the reply (screenshot or message link) with the submission materials. If the
      answer is no, the fallback is to vendor a minimal client into this repo during the window and drop the dependency.
- [ ] **VERIFY:** the original README said the organizers confirmed the pre-kickoff planning docs were acceptable. That
      confirmation is not in the repo. Find it and save it, or ask again together with the MME question.

## Banned projects

- [ ] **Not a "simple image analyzer".** The video reaches the voice reform agent and a deliverable early, and the text
      leads with measured design and the staged takeoff, not "AI reads a plan photo" (`HARDENING.md` D1). The sketch-reading
      step is the entry door, not the product.
- [ ] **Not a banned category.** No medical or health advice, no RAG chatbot, no education chatbot, no screener or analyzer
      of people. State plainly in the text that Maqet gives preliminary construction quantities and never certifies
      structural safety.
- [ ] **Rights to everything shipped.** ECC rule packs in `.claude/rules/ecc/` (MIT, with their `LICENSE`); sample inputs
      are original work, CC0 (`samples/plans/SOURCES.md`); assets are CC0 with source and license in `assets/catalog.json`
      (tested by `tests/test_catalog.py`). No CubiCasa5K or web images. MME is MIT. Dependencies are in
      `server/requirements.txt` and `web/package.json`.
- [ ] **No secrets in the repo or video.** `.env`, API keys, gateway keys and admin keys are not committed or visible on
      screen. Run a secret scan on the final commit (`git log -p | rg -i "sk-|api[_-]?key|secret"` as a first pass).
- [ ] **No personal data.** Only synthetic or consented inputs appear on screen; no real family, no real address.

## AI usage (the rules are silent)

`RULES.md` does not mention AI-assisted development or disclosure. We disclose anyway, as evidence of good faith.

- [ ] [`AI_USAGE.md`](AI_USAGE.md) is complete and linked from the README. It records the harness and provider per session,
      including a `manual` row for Claude used outside the gateway; Claude Code is also used for development.
- [ ] **VERIFY** the Discord answers to the three questions in `PLAN.md` (are non-Meta coding assistants allowed? must AI
      use be declared? may we use our own open-source tooling such as MME?) and that `MME_POLICY` in `mme/policy.env`
      (currently `meta-first`) matches the answer. If there was no answer, say so in the disclosure.

## Honesty and safety checks (our own)

- [ ] Every output screen and the DXF notes say **Preliminary**. No claim of structural certification anywhere (README,
      video, text description).
- [ ] The **needs a licensed professional** flag is shown at least once in the video.
- [ ] Statistics are cited exactly as in `PRODUCT.md` (4 million people, Habitat for Humanity 2022 / RENABAP). The "over
      60% of Latin America" figure is a secondary source: leave it out of the video.
- [ ] README "What you can run today" matches `main` on the final commit: nothing marked "Works" that does not, nothing
      shown in the video that is marked "Planned" or "In progress".
- [ ] Name check: always write "Maqet" with its tagline. A trademark search is a post-hackathon task (`PRODUCT.md`).

## Technical gates before submitting (the human runs these)

- [ ] `mme gate` green on `main`; `mme ship` passes (README, replay dir, extra checks in `mme/milestones.yaml`).
- [ ] `cd server && MME_MODE=replay python -m pytest -q` passes offline.
- [ ] `cd web && npm run build && npm test` passes.
- [ ] Full flow in replay: upload to Scene to reform to takeoff to DXF (`tests/test_e2e_flow.py`).
- [ ] **Fresh clone test:** clone the public repo into an empty directory and follow the README only
      (`pip install -r server/requirements.txt` must pull in MME by itself), reach the Capture screen with a sample loaded.
      Fix the README, not your memory.
- [ ] Both phones: AR measuring on the Android phone; AR maquette on iPhone and Android (`ADR-012`).
- [ ] Budget: `mme credits` reviewed; no live calls left in the demo path.

## Submission-day sequence

1. 12:00: freeze verified, video exported, SRT checked, README link filled in.
2. 14:00: fresh-clone test and secret scan on the final commit; tag it (`git tag submission`); make the repo public.
3. 15:00: upload the video, open the submission form, paste the text, attach links, add every team member.
4. 16:30: judge-eyes read of the repo from a logged-out browser: README renders, video plays with sound and subtitles,
   links work, no private paths.
5. **18:00: submit.** Save the confirmation. Anything after this is buffer for portal problems, not for work.
6. After submitting: the rules do not say whether edits are allowed. **VERIFY** before pushing to the submitted branch.

## Open questions for the human

1. Post the MME disclosure in Discord and save the organizers' answer (see "Identify your contributions").
2. Is there a written organizer confirmation for the pre-kickoff planning docs? Where is it saved?
3. What were the Discord answers on non-Meta coding assistants and AI disclosure? `AI_USAGE.md` must reflect them.
4. Are the judging weights and bonus prizes in `PLAN.md` from an official announcement? Link it.
5. Should the video's opening sentence also name MME ("...and MME, an open-source dev-tool library started Oct 22")? It
   is the longest-lived risk in "Identify your contributions"; I left the required sentence unchanged.
