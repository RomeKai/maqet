"""UX auditor: screenshot each demo screen at phone size, critique it with Muse Spark Open (vision, via Baseten),
and write a prioritized backlog. Read-only on the app: it only clicks and screenshots; it writes docs/UX_BACKLOG.md
and screenshots under docs/ux/.

Needs the app running: server in replay mode on :8000 and `npm run dev` (https) on :5173.
Usage (OPS terminal, BASETEN_API_KEY loaded): python tools/ux_audit.py [--url https://localhost:5173]
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "docs" / "ux"
BACKLOG = ROOT / "docs" / "UX_BACKLOG.md"
BASETEN_URL = "https://inference.baseten.co/v1/chat/completions"
MODEL = "meta-models/muse-spark-open-1026"
PHONE = {"width": 390, "height": 844}


def context_docs() -> str:
    parts = []
    for rel in (".claude/skills/mobile-ui/SKILL.md", "docs/DEMO.md"):
        p = ROOT / rel
        if p.exists():
            parts.append(f"## {rel}\n{p.read_text(encoding='utf-8')}")
    return "\n\n".join(parts)


SYSTEM = """You are a senior mobile UI/UX designer auditing a phone-first PWA (Maqet: assisted home self-build; a
technician captures a room, reforms it by voice with an AI agent, shows an AR maquette and delivers a staged takeoff
and DXF). Judges will watch a 3-minute demo video of these screens. Critique ONLY what you can see in the screenshot.
Rules: never propose changing functionality, data or flows; propose visual and interaction-feedback changes only
(layout, hierarchy, spacing, typography, color, contrast, touch targets >= 44px, motion/transitions, loading and empty
states). Be concrete enough that a developer can implement it (name the element, the CSS-level change, the target
value). Keep the product's honesty labels (Preliminary, Not to scale, provenance) visible; never hide them."""

SCREEN_PROMPT = """Screen: {name}
What the viewer must understand here: {intent}

Return markdown with exactly these sections:
### {name}
**First impression (1 line):**
**Problems** (max 5, each tagged [high]/[med]/[low], most severe first):
**Proposals** (max 5, each: element -> concrete change -> why it helps the demo):
**Keep** (what already works, max 2):"""

SYNTH_PROMPT = """Below are per-screen UX critiques of the same app. Produce a single prioritized backlog for ONE
developer with one day: a markdown table | # | Screen | Change | Impact on demo (high/med/low) | Effort (S/M/L) |,
max 12 rows, ordered by impact/effort. Then a short "Design tokens" section proposing one consistent set (colors,
radius, spacing scale, type scale, motion durations) that fixes the cross-screen inconsistencies you saw.

{critiques}"""


def ask(key: str, messages: list[dict], max_tokens: int = 2500) -> str:
    body = json.dumps({"model": MODEL, "max_tokens": max_tokens, "messages": messages}).encode()
    req = urllib.request.Request(BASETEN_URL, data=body, method="POST",
                                 headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                return json.load(r)["choices"][0]["message"].get("content") or "(empty answer)"
        except (urllib.error.URLError, TimeoutError) as e:
            if attempt == 2:
                return f"(model call failed: {e})"
            time.sleep(5 * (attempt + 1))
    return "(unreachable)"


def critique(key: str, docs: str, name: str, intent: str, png: Path) -> str:
    b64 = base64.b64encode(png.read_bytes()).decode()
    return ask(key, [
        {"role": "system", "content": f"{SYSTEM}\n\n# Product context\n{docs}"},
        {"role": "user", "content": [
            {"type": "text", "text": SCREEN_PROMPT.format(name=name, intent=intent)},
            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}},
        ]},
    ])


def click(page: Page, name: str, role: str = "button") -> bool:
    try:
        page.get_by_role(role, name=name).first.click(timeout=8000)
        page.wait_for_timeout(1500)
        return True
    except Exception as e:  # noqa: BLE001 - a missing control is a finding, not a crash
        print(f"  ! could not click {role} '{name}': {e.__class__.__name__}")
        return False


# (slug, intent, action) — action runs before the screenshot; keep it to clicks so the audit never changes data.
STEPS = [
    ("capture-empty", "Where to start: capture a room (AR, room photo or sketch).", None),
    ("capture-sample-read", "The sketch was read: walls and openings proposed, warnings to confirm.",
     lambda p: click(p, "Sample sketch (no photo)") and p.wait_for_timeout(4000)),
    ("capture-check-measures", "Confirm or correct each wall's length; provenance per wall.",
     lambda p: click(p, "Check wall measures")),
    ("stage-reform", "Reform stage: talk to the agent to change the plan.", lambda p: click(p, "Reform · Skip", "tab")),
    ("stage-design", "Design stage (skippable).", lambda p: click(p, "Design · Skip", "tab")),
    ("stage-present", "Present: show the AR maquette and the render.", lambda p: click(p, "Present", "tab")),
    ("stage-deliver", "Deliver: staged takeoff and DXF, preliminary.", lambda p: click(p, "Deliver", "tab")),
    ("capture-es-AR", "Same app in the es-AR product locale.",
     lambda p: click(p, "Capture", "tab") and click(p, "Español")),
]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="https://localhost:5173")
    ap.add_argument("--shots-only", action="store_true", help="take the screenshots, skip the model calls ($0)")
    args = ap.parse_args()
    key = os.environ.get("BASETEN_API_KEY")
    if not key and not args.shots_only:
        print("BASETEN_API_KEY not set: run `set -a; source .env; set +a` in maqet first", file=sys.stderr)
        return 1
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    docs = context_docs()
    shots: list[tuple[str, str, Path]] = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        ctx = browser.new_context(viewport=PHONE, device_scale_factor=2, is_mobile=True, has_touch=True,
                                  ignore_https_errors=True, locale="en-US")
        page = ctx.new_page()
        page.goto(args.url, wait_until="networkidle", timeout=60000)
        page.wait_for_timeout(2000)
        for slug, intent, action in STEPS:
            print(f"- {slug}")
            if action is not None:
                action(page)
            png = OUT_DIR / f"{slug}.png"
            page.screenshot(path=str(png), full_page=True)
            shots.append((slug, intent, png))
        browser.close()
    if args.shots_only:
        print(f"screenshots in {OUT_DIR.relative_to(ROOT)}")
        return 0

    critiques = []
    for slug, intent, png in shots:
        print(f"  critiquing {slug} ...")
        critiques.append(critique(key, docs, slug, intent, png))
    print("  synthesizing backlog ...")
    backlog = ask(key, [{"role": "system", "content": SYSTEM},
                        {"role": "user", "content": SYNTH_PROMPT.format(critiques="\n\n".join(critiques))}], 4000)

    stamp = datetime.now().strftime("%Y-%m-%d %H:%M")
    BACKLOG.write_text(
        f"# UX backlog\n\nGenerated {stamp} by `tools/ux_audit.py` ({MODEL} via Baseten, vision on phone-size "
        f"screenshots in `docs/ux/`). Proposals only: a human picks what gets built.\n\n## Prioritized backlog\n\n"
        f"{backlog}\n\n## Per-screen critiques\n\n" + "\n\n".join(critiques) + "\n", encoding="utf-8")
    print(f"wrote {BACKLOG.relative_to(ROOT)} ({len(shots)} screens)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
