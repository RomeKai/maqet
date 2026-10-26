"""Generate original CC0 demo inputs + ground truth (ADR-019/ADR-022, Day 1).

Regenerates the three demo inputs during the event (the old generator script
is not in the repo): two clean plans and one hand-drawn sketch with written
measurements. Each input ships as:
  <name>.png        clean plan / sketch render
  <name>_photo.png  phone-photo-like version (perspective, blur, noise, paper)
  <name>.truth.json walls/openings/rooms in meters, loadable as Scene

Nothing is copied: every wall coordinate below is authored here. CC0.
Offline: stdlib + Pillow + numpy only. Never touches server/scene/.
"""

from __future__ import annotations

import json
import math
import random
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))

from server.scene.models import Scene  # noqa: E402
from server.scene.validation import validate_scene  # noqa: E402

OUT = REPO / "samples" / "plans"
PX = 150  # px per meter
RNG = random.Random(20261026)

# Warm technical palette (ADR-018).
PAPER = (250, 247, 240)
INK = (38, 38, 42)
TEAL = (15, 94, 107)
TERRA = (201, 111, 74)
SKETCH_PAPER = (243, 236, 217)
SKETCH_GRID = (216, 207, 184)
PEN = (34, 48, 74)
PEN_RED = (176, 58, 46)

ARIAL = "C:/Windows/Fonts/arial.ttf"
ARIAL_BD = "C:/Windows/Fonts/arialbd.ttf"


def _font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    for path in (ARIAL_BD if bold else ARIAL,):
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            pass
    return ImageFont.load_default(size=size)  # type: ignore[call-arg]


F_TITLE = _font(40, bold=True)
F_SUB = _font(25)
F_ROOM = _font(30, bold=True)
F_DIM = _font(26)
F_NOTE = _font(22)

M2 = "m\u00b2"  # Arial/Windows always has it; DejaVu fallback too.


# ---------------------------------------------------------------- geometry dicts

def wall(wid: str, ax: float, ay: float, bx: float, by: float,
         thick: float, kind: str) -> dict:
    return {"id": wid, "a": [ax, ay], "b": [bx, by],
            "thickness_m": thick, "kind": kind}


def opening(oid: str, wall_id: str, kind: str, offset: float,
            width: float, height: float, sill: float | None = None) -> dict:
    d: dict = {"id": oid, "wall_id": wall_id, "kind": kind,
               "offset_m": offset, "width_m": width, "height_m": height}
    if sill is not None:
        d["sill_m"] = sill
    return d


def room(rid: str, name: str, poly: list[list[float]],
         function: str | None = None) -> dict:
    return {"id": rid, "name": name, "polygon": poly, "function": function}


def signed_area(poly: list[list[float]]) -> float:
    s = 0.0
    for i in range(len(poly)):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % len(poly)]
        s += x1 * y2 - x2 * y1
    return s / 2.0


def make_scene(sid: str, walls: list[dict], openings: list[dict],
               rooms: list[dict]) -> dict:
    for r in rooms:  # keep CCW, origin bottom-left
        if signed_area(r["polygon"]) < 0:
            r["polygon"] = r["polygon"][::-1]
    return {"id": sid, "version": 0, "units": "m", "scale_confirmed": True,
            "ceiling_height_m": 2.6, "walls": walls, "openings": openings,
            "rooms": rooms, "surfaces": [], "furniture": [], "materials": []}


# ------------------------------------------------------------- the three scenes

def scene_48() -> dict:
    t_ext, t_int = 0.20, 0.10
    walls = [
        wall("w_s1", 0, 0, 4, 0, t_ext, "exterior"),
        wall("w_s2", 4, 0, 8, 0, t_ext, "exterior"),
        wall("w_n1", 0, 6, 4, 6, t_ext, "exterior"),
        wall("w_n2", 4, 6, 8, 6, t_ext, "exterior"),
        wall("w_w1", 0, 0, 0, 3, t_ext, "exterior"),
        wall("w_w2", 0, 3, 0, 6, t_ext, "exterior"),
        wall("w_e1", 8, 0, 8, 3, t_ext, "exterior"),
        wall("w_e2", 8, 3, 8, 6, t_ext, "exterior"),
        wall("w_i1", 0, 2.5, 4, 2.5, t_int, "interior"),
        wall("w_i2", 4, 2.5, 8, 2.5, t_int, "interior"),
        wall("w_i3", 5, 0, 5, 2.5, t_int, "interior"),
    ]
    openings = [
        opening("d_entry", "w_e2", "door", 1.0, 0.9, 2.05),
        opening("d_kit", "w_i1", "door", 1.0, 0.8, 2.05),
        opening("d_bath", "w_i2", "door", 1.5, 0.8, 2.05),
        opening("v_kit", "w_s1", "window", 2.0, 1.2, 1.2, 0.9),
        opening("v_bath", "w_s2", "window", 1.0, 0.6, 0.8, 1.4),
        opening("v_liv1", "w_n1", "window", 1.0, 1.5, 1.4, 0.8),
        opening("v_liv2", "w_n2", "window", 1.5, 1.5, 1.4, 0.8),
        opening("v_liv3", "w_w2", "window", 0.5, 1.2, 1.4, 0.8),
    ]
    rooms = [
        room("r_living", "Estar", [[0, 2.5], [8, 2.5], [8, 6], [0, 6]], "living"),
        room("r_kitchen", "Cocina", [[0, 0], [5, 0], [5, 2.5], [0, 2.5]], "kitchen"),
        room("r_bath", "Ba\u00f1o", [[5, 0], [8, 0], [8, 2.5], [5, 2.5]], "bath"),
    ]
    return make_scene("plano-48m-1ambiente", walls, openings, rooms)


def scene_70() -> dict:
    t_ext, t_int = 0.20, 0.10
    walls = [
        wall("w_s1", 0, 0, 3.5, 0, t_ext, "exterior"),
        wall("w_s2", 3.5, 0, 7, 0, t_ext, "exterior"),
        wall("w_s3", 7, 0, 10, 0, t_ext, "exterior"),
        wall("w_n1", 0, 7, 3.5, 7, t_ext, "exterior"),
        wall("w_n2", 3.5, 7, 7, 7, t_ext, "exterior"),
        wall("w_n3", 7, 7, 10, 7, t_ext, "exterior"),
        wall("w_w1", 0, 0, 0, 3.5, t_ext, "exterior"),
        wall("w_w2", 0, 3.5, 0, 7, t_ext, "exterior"),
        wall("w_e1", 10, 0, 10, 3.5, t_ext, "exterior"),
        wall("w_e2", 10, 3.5, 10, 7, t_ext, "exterior"),
        wall("w_va", 6.5, 0, 6.5, 3.5, t_int, "interior"),
        wall("w_vb", 6.5, 3.5, 6.5, 7, t_int, "interior"),
        wall("w_ua", 7.7, 0, 7.7, 3.5, t_int, "interior"),
        wall("w_ub", 7.7, 3.5, 7.7, 7, t_int, "interior"),
        wall("w_h1", 0, 3, 3.25, 3, t_int, "interior"),
        wall("w_h2", 3.25, 3, 6.5, 3, t_int, "interior"),
        wall("w_h3", 6.5, 3, 7.7, 3, t_int, "interior"),
        wall("w_h4", 7.7, 3, 10, 3, t_int, "interior"),
        wall("w_k1", 4, 0, 4, 3, t_int, "interior"),
    ]
    openings = [
        opening("d_entry", "w_s1", "door", 1.0, 0.9, 2.05),
        opening("d_kit", "w_h1", "door", 1.0, 0.8, 2.05),
        opening("d_hall", "w_vb", "door", 1.5, 0.8, 2.05),
        opening("d_bath", "w_va", "door", 1.0, 0.8, 2.05),
        opening("d_bed1", "w_ub", "door", 1.5, 0.8, 2.05),
        opening("d_bed2", "w_ua", "door", 1.0, 0.8, 2.05),
        opening("v_kit", "w_w1", "window", 1.0, 1.2, 1.2, 0.9),
        opening("v_bath", "w_s2", "window", 0.5, 0.6, 0.8, 1.4),
        opening("v_liv1", "w_n1", "window", 1.0, 1.5, 1.4, 0.8),
        opening("v_liv2", "w_n2", "window", 1.0, 1.5, 1.4, 0.8),
        opening("v_bed1", "w_e2", "window", 1.0, 1.2, 1.4, 0.8),
        opening("v_bed2", "w_e1", "window", 0.8, 1.2, 1.4, 0.8),
    ]
    rooms = [
        room("r_living", "Estar", [[0, 3], [6.5, 3], [6.5, 7], [0, 7]], "living"),
        room("r_kitchen", "Cocina-comedor",
             [[0, 0], [4, 0], [4, 3], [0, 3]], "kitchen"),
        room("r_bath", "Ba\u00f1o",
             [[4, 0], [6.5, 0], [6.5, 3], [4, 3]], "bath"),
        room("r_hall", "Paso",
             [[6.5, 0], [7.7, 0], [7.7, 7], [6.5, 7]], "hall"),
        room("r_bed1", "Dormitorio 1",
             [[7.7, 3], [10, 3], [10, 7], [7.7, 7]], "bedroom"),
        room("r_bed2", "Dormitorio 2",
             [[7.7, 0], [10, 0], [10, 3], [7.7, 3]], "bedroom"),
    ]
    return make_scene("plano-70m-2dorm", walls, openings, rooms)


def scene_sketch() -> dict:
    """Hand-drawn croquis: 6.0 x 3.5 m bedroom + bath addition."""
    t_ext, t_int = 0.20, 0.10
    walls = [
        wall("w_s1", 0, 0, 3, 0, t_ext, "exterior"),
        wall("w_s2", 3, 0, 6, 0, t_ext, "exterior"),
        wall("w_n1", 0, 3.5, 3, 3.5, t_ext, "exterior"),
        wall("w_n2", 3, 3.5, 6, 3.5, t_ext, "exterior"),
        wall("w_w1", 0, 0, 0, 3.5, t_ext, "exterior"),
        wall("w_e1", 6, 0, 6, 3.5, t_ext, "exterior"),
        wall("w_v1", 3.5, 0, 3.5, 3.5, t_int, "interior"),
    ]
    openings = [
        opening("d_dorm", "w_s1", "door", 0.8, 0.9, 2.05),
        opening("d_bath", "w_v1", "door", 1.2, 0.8, 2.05),
        opening("v_dorm1", "w_n1", "window", 0.8, 1.5, 1.2, 1.0),
        opening("v_dorm2", "w_w1", "window", 1.0, 1.2, 1.2, 1.0),
        opening("v_bath", "w_e1", "window", 1.0, 1.0, 0.8, 1.4),
    ]
    rooms = [
        room("r_dorm", "DORM",
             [[0, 0], [3.5, 0], [3.5, 3.5], [0, 3.5]], "bedroom"),
        room("r_bath", "BA\u00d1O",
             [[3.5, 0], [6, 0], [6, 3.5], [3.5, 3.5]], "bath"),
    ]
    return make_scene("croquis-ampliacion-dorm", walls, openings, rooms)


# ------------------------------------------------------------------ rendering

class Canvas:
    def __init__(self, xmax: float, ymax: float, top: int = 70,
                 bottom: int = 150, left: int = 110, right: int = 60,
                 bg=PAPER):
        self.w = int(left + xmax * PX + right)
        self.h = int(top + ymax * PX + bottom)
        self.img = Image.new("RGB", (self.w, self.h), bg)
        self.d = ImageDraw.Draw(self.img)
        self.ox, self.oy, self.ymax = left, top, ymax

    def p(self, x: float, y: float) -> tuple[float, float]:
        return (self.ox + x * PX, self.oy + (self.ymax - y) * PX)


def draw_dim(c: Canvas, ax: float, ay: float, bx: float, by: float,
             off_px: float, text: str, color=TEAL) -> None:
    """Dimension line between two meter points, offset outward by off_px."""
    A, B = c.p(ax, ay), c.p(bx, by)
    dx, dy = B[0] - A[0], B[1] - A[1]
    L = math.hypot(dx, dy) or 1.0
    nx, ny = -dy / L, dx / L
    A2 = (A[0] + nx * off_px, A[1] + ny * off_px)
    B2 = (B[0] + nx * off_px, B[1] + ny * off_px)
    c.d.line([A, (A2[0] - nx * 6, A2[1] - ny * 6)], fill=color, width=1)
    c.d.line([B, (B2[0] - nx * 6, B2[1] - ny * 6)], fill=color, width=1)
    c.d.line([A2, B2], fill=color, width=2)
    for P, s in ((A2, 1), (B2, -1)):
        c.d.line([(P[0] - 6 * dx / L * s, P[1] - 6 * dy / L * s),
                  (P[0] + 6 * dx / L * s, P[1] + 6 * dy / L * s)],
                 fill=color, width=2)
    mx, my = (A2[0] + B2[0]) / 2, (A2[1] + B2[1]) / 2
    tw = c.d.textlength(text, font=F_DIM)
    c.d.rectangle([mx - tw / 2 - 6, my - 16, mx + tw / 2 + 6, my + 16],
                  fill=c.img.getpixel((0, 0)))
    c.d.text((mx - tw / 2, my - 15), text, font=F_DIM, fill=color)


def opening_geom(o: dict, walls: dict[str, dict]):
    w = walls[o["wall_id"]]
    ax, ay = w["a"]
    bx, by = w["b"]
    L = math.hypot(bx - ax, by - ay)
    ux, uy = (bx - ax) / L, (by - ay) / L
    t0, t1 = o["offset_m"] / L, (o["offset_m"] + o["width_m"]) / L
    p0 = (ax + (bx - ax) * t0, ay + (by - ay) * t0)
    p1 = (ax + (bx - ax) * t1, ay + (by - ay) * t1)
    return p0, p1, (ux, uy)


def render_plan(scene: dict, title: str, subtitle: str,
                south_ticks: list[float], west_ticks: list[float]) -> Image.Image:
    walls = {w["id"]: w for w in scene["walls"]}
    xmax = max(max(w["a"][0], w["b"][0]) for w in scene["walls"])
    ymax = max(max(w["a"][1], w["b"][1]) for w in scene["walls"])
    c = Canvas(xmax, ymax)
    for r in scene["rooms"]:  # room fills
        c.d.polygon([c.p(*q) for q in r["polygon"]], fill=(235, 231, 222))
    for w in scene["walls"]:  # walls
        c.d.line([c.p(*w["a"]), c.p(*w["b"])],
                 fill=INK, width=max(3, int(w["thickness_m"] * PX)),
                 joint="curve")
    for o in scene["openings"]:  # gaps + symbols
        p0, p1, (ux, uy) = opening_geom(o, walls)
        wall = walls[o["wall_id"]]
        gap_w = max(3, int(wall["thickness_m"] * PX))
        Q0, Q1 = c.p(*p0), c.p(*p1)
        c.d.line([Q0, Q1], fill=PAPER, width=gap_w)
        if o["kind"] == "door":
            R = o["width_m"] * PX
            side = 1.0
            nx, ny = -uy * side, ux * side
            t = np.linspace(0, math.pi / 3, 12)
            arc = [(Q0[0] + R * (math.cos(a) * ux + math.sin(a) * nx),
                    Q0[1] - R * (math.cos(a) * uy + math.sin(a) * ny))
                   for a in t]
            c.d.line(arc, fill=INK, width=2)
            leaf = arc[-1]
            c.d.line([Q0, leaf], fill=INK, width=2)
            c.d.line([Q0, Q1], fill=INK, width=1)
        else:
            mx, my = (Q0[0] + Q1[0]) / 2, (Q0[1] + Q1[1]) / 2
            L = math.hypot(Q1[0] - Q0[0], Q1[1] - Q0[1]) or 1.0
            nx, ny = -(Q1[1] - Q0[1]) / L, (Q1[0] - Q0[0]) / L
            for s in (-3.5, 3.5):
                c.d.line([(Q0[0] + nx * s, Q0[1] + ny * s),
                          (Q1[0] + nx * s, Q1[1] + ny * s)],
                         fill=INK, width=2)
            void = (mx, my)
            _ = void
    for r in scene["rooms"]:  # labels
        xs = [q[0] for q in r["polygon"]]
        ys = [q[1] for q in r["polygon"]]
        cx, cy = sum(xs) / len(xs), sum(ys) / len(ys)
        area = abs(signed_area(r["polygon"]))
        label = f'{r["name"]}  {area:.1f} {M2}'.replace(".", ",")
        tpos = c.p(cx, cy)
        tw = c.d.textlength(label, font=F_ROOM)
        c.d.text((tpos[0] - tw / 2, tpos[1] - 18), label,
                 font=F_ROOM, fill=INK)
    draw_dim(c, 0, 0, xmax, 0, 46, f"{xmax:.2f} m".replace(".", ","))
    draw_dim(c, 0, 0, 0, ymax, 56, f"{ymax:.2f} m".replace(".", ","))
    for i, x in enumerate(south_ticks):  # interior partition ticks
        X, Y = c.p(x, 0)
        c.d.line([(X, Y + 8), (X, Y + 52)], fill=TEAL, width=2)
        t = f"{x:.2f}".replace(".", ",")
        c.d.text((X - 22, Y + 56), t, font=F_NOTE, fill=TEAL)
    for y in west_ticks:
        X, Y = c.p(0, y)
        c.d.line([(X - 66, Y), (X - 8, Y)], fill=TEAL, width=2)
        t = f"{y:.2f}".replace(".", ",")
        c.d.text((X - 66, Y - 34), t, font=F_NOTE, fill=TEAL)
    c.d.rectangle([20, c.h - 96, c.w - 20, c.h - 20], outline=TERRA, width=3)
    c.d.text((36, c.h - 88), title, font=F_TITLE, fill=INK)
    c.d.text((36, c.h - 44), subtitle, font=F_SUB, fill=TEAL)
    return c.img


# -------------------------------------------------------------------- sketch

def wobble_line(d: ImageDraw.ImageDraw, A, B, passes=2, amp=2.2,
                color=PEN, width=3) -> None:
    dist = math.hypot(B[0] - A[0], B[1] - A[1])
    n = max(4, int(dist / 26))
    for _ in range(passes):
        pts = []
        for i in range(n + 1):
            t = i / n
            x = A[0] + (B[0] - A[0]) * t + RNG.uniform(-amp, amp)
            y = A[1] + (B[1] - A[1]) * t + RNG.uniform(-amp, amp)
            pts.append((x, y))
        d.line(pts, fill=color, width=width, joint="curve")


def render_sketch(scene: dict) -> Image.Image:
    xmax = max(max(w["a"][0], w["b"][0]) for w in scene["walls"])
    ymax = max(max(w["a"][1], w["b"][1]) for w in scene["walls"])
    c = Canvas(xmax, ymax, top=90, bottom=170, left=130, right=90,
               bg=SKETCH_PAPER)
    step = 0.5 * PX  # graph paper
    x = 0.0
    while x < c.w:
        c.d.line([(x, 0), (x, c.h)], fill=SKETCH_GRID, width=1)
        x += step
    y = 0.0
    while y < c.h:
        c.d.line([(0, y), (c.w, y)], fill=SKETCH_GRID, width=1)
        y += step
    walls = {w["id"]: w for w in scene["walls"]}
    for r in scene["rooms"]:
        cx = sum(q[0] for q in r["polygon"]) / len(r["polygon"])
        cy = sum(q[1] for q in r["polygon"]) / len(r["polygon"])
        tpos = c.p(cx, cy)
        tw = c.d.textlength(r["name"], font=F_ROOM)
        c.d.text((tpos[0] - tw / 2 + RNG.uniform(-4, 4),
                  tpos[1] - 18 + RNG.uniform(-4, 4)),
                 r["name"], font=F_ROOM, fill=PEN)
    for w in scene["walls"]:
        A, B = c.p(*w["a"]), c.p(*w["b"])
        dx, dy = B[0] - A[0], B[1] - A[1]
        L = math.hypot(dx, dy) or 1.0
        nx, ny = -dy / L, dx / L
        for s in (-7, 7):  # double-stroke hand wall
            wobble_line(c.d, (A[0] + nx * s, A[1] + ny * s),
                        (B[0] + nx * s, B[1] + ny * s),
                        color=PEN, width=3)
    for o in scene["openings"]:  # gaps + red annotations
        p0, p1, _ = opening_geom(o, walls)
        Q0, Q1 = c.p(*p0), c.p(*p1)
        c.d.line([Q0, Q1], fill=SKETCH_PAPER, width=20)
        mx, my = (Q0[0] + Q1[0]) / 2, (Q0[1] + Q1[1]) / 2
        if o["kind"] == "door":
            c.d.line([Q0, Q1], fill=PEN_RED, width=2)
            c.d.arc([mx - 26, my - 26, mx + 26, my + 26],
                    start=200, end=340, fill=PEN_RED, width=2)
        else:
            L = math.hypot(Q1[0] - Q0[0], Q1[1] - Q0[1]) or 1.0
            nx, ny = -(Q1[1] - Q0[1]) / L, (Q1[0] - Q0[0]) / L
            for s in (-5, 5):
                c.d.line([(Q0[0] + nx * s, Q0[1] + ny * s),
                          (Q1[0] + nx * s, Q1[1] + ny * s)],
                         fill=PEN_RED, width=2)
    notes = [  # handwritten measurements (Argentine comma decimals)
        ((0, 0), (3.5, 0), 60, "3,50"),
        ((3.5, 0), (6, 0), 60, "2,50"),
        ((0, 0), (0, 3.5), 66, "3,50"),
        ((0, 3.5), (6, 3.5), -64, "6,00 total"),
    ]
    for (ax, ay), (bx, by), off, text in notes:
        A, B = c.p(ax, ay), c.p(bx, by)
        dx, dy = B[0] - A[0], B[1] - A[1]
        L = math.hypot(dx, dy) or 1.0
        nx, ny = -dy / L, dx / L
        A2 = (A[0] + nx * off, A[1] + ny * off)
        B2 = (B[0] + nx * off, B[1] + ny * off)
        wobble_line(c.d, A2, B2, passes=1, amp=1.2, color=PEN_RED,
                    width=2)
        for P in (A2, B2):
            c.d.ellipse([P[0] - 3, P[1] - 3, P[0] + 3, P[1] + 3],
                        fill=PEN_RED)
        mx, my = (A2[0] + B2[0]) / 2, (A2[1] + B2[1]) / 2
        tw = c.d.textlength(text, font=F_DIM)
        c.d.text((mx - tw / 2 + RNG.uniform(-3, 3),
                  my - 34 + RNG.uniform(-3, 3)),
                 text, font=F_DIM, fill=PEN_RED)
    c.d.text((36, 22), "CROQUIS — ampliación dormitorio + ba\u00f1o",
             font=F_TITLE, fill=PEN)
    c.d.text((36, c.h - 116),
             "Medidas en metros, croquis a mano — preliminar,",
             font=F_SUB, fill=PEN)
    c.d.text((36, c.h - 80),
             "no es certificaci\u00f3n estructural. CC0 Maqet demo.",
             font=F_SUB, fill=PEN)
    return c.img


# --------------------------------------------------------------- phone photos

def _find_coeffs(dst: list, src: list) -> np.ndarray:
    m = []
    for (xd, yd), (xs, ys) in zip(dst, src):
        m.append([xd, yd, 1, 0, 0, 0, -xs * xd, -xs * yd])
        m.append([0, 0, 0, xd, yd, 1, -ys * xd, -ys * yd])
    return np.linalg.solve(np.array(m, float), np.array(src, float).reshape(8))


def phone_photo(img: Image.Image, seed: int, table: bool = False,
                warp: float = 0.045) -> Image.Image:
    rng = np.random.default_rng(seed)
    base = img
    if table:  # paper sheet on a table
        tw, th = int(img.width * 1.3), int(img.height * 1.28)
        tg = np.linspace(96, 122, th)[:, None, None] * np.ones((1, tw, 3))
        tarr = tg + rng.normal(0, 2.5, (th, tw, 3))
        base = Image.fromarray(np.clip(tarr, 0, 255).astype(np.uint8))
        base.paste(img, ((tw - img.width) // 2, (th - img.height) // 2))
    w, h = base.size
    out = [(0, 0), (w, 0), (w, h), (0, h)]
    src = [(rng.uniform(0, w * warp), rng.uniform(0, h * warp)),
           (w - rng.uniform(0, w * warp), rng.uniform(0, h * warp)),
           (w - rng.uniform(0, w * warp * 0.7),
            h - rng.uniform(0, h * warp * 0.7)),
           (rng.uniform(0, w * warp), h - rng.uniform(0, h * warp * 0.7))]
    warped = base.transform((w, h), Image.PERSPECTIVE,
                            _find_coeffs(out, src).tolist(),
                            Image.BICUBIC)
    warped = warped.filter(__import__("PIL.ImageFilter", fromlist=["x"])
                           .GaussianBlur(0.7))
    arr = np.asarray(warped).astype(float)
    arr += rng.normal(0, 3.2, arr.shape)  # sensor noise
    arr *= np.array([1.03, 1.0, 0.93])  # warm indoor light
    ys, xs = np.mgrid[0:h, 0:w]
    vig = 1.0 - 0.22 * (((xs / w - 0.5) ** 2 + (ys / h - 0.5) ** 2) / 0.5)
    arr *= np.clip(vig, 0.6, 1.0)[..., None]
    shade = 1.0 - 0.18 * (xs / w * 0.6 + ys / h * 0.4)  # soft corner shadow
    arr *= shade[..., None]
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))


# ---------------------------------------------------------------------- main

def save_one(basename: str, scene: dict, img: Image.Image,
             photo_seed: int, table: bool, expect_area: float) -> None:
    total = sum(abs(signed_area(r["polygon"])) for r in scene["rooms"])
    assert abs(total - expect_area) < 1e-6, (basename, total)
    sc = Scene.model_validate(scene)  # truth.json loads as Scene
    report = validate_scene(sc)
    assert not report.errors, (basename, report.errors)
    if report.warnings or report.flags:
        print(f"  note {basename}: warnings={report.warnings} "
              f"flags={report.flags}")
    (OUT / f"{basename}.png").parent.mkdir(parents=True, exist_ok=True)
    img.save(OUT / f"{basename}.png")
    phone_photo(img, seed=photo_seed, table=table).save(
        OUT / f"{basename}_photo.png")
    with open(OUT / f"{basename}.truth.json", "w",
              encoding="utf-8") as fh:
        json.dump(json.loads(json.dumps(scene, ensure_ascii=False)),
                  fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    print(f"  ok {basename}: area={total:.1f} m2, "
          f"walls={len(scene['walls'])} openings={len(scene['openings'])}")


SOURCES = """\
# Sources — samples/plans

Every file in this directory is an **original work generated during the
hackathon event** by `samples/tools/make_samples.py` (deterministic script,
fixed seed). No third-party plan, photo, dataset (including CubiCasa5K) or
web image was used, traced or copied. License: **CC0** (public domain).

| file | what | origin |
|---|---|---|
| `plano_48m_1ambiente.png` / `_photo.png` / `.truth.json` | clean 48 m² plan: 1 ambiente + cocina-baño | generated, CC0 |
| `plano_70m_2dorm.png` / `_photo.png` / `.truth.json` | clean 70 m² plan: 2 dormitorios | generated, CC0 |
| `croquis_ampliacion.png` / `_photo.png` / `.truth.json` | hand-drawn croquis with written measurements (dormitorio + baño, 6.00 × 3.50 m) | generated, CC0 |

Ground truth (`*.truth.json`) holds walls/openings/rooms in meters and loads
as `server/scene/models.py::Scene` (validated by the generator itself).
All outputs are **preliminary**; never a structural certification.
"""


def main() -> None:
    print("generating demo inputs ->", OUT)
    s48 = scene_48()
    save_one("plano_48m_1ambiente", s48,
             render_plan(s48, "PLANO — 48 m² · 1 ambiente + cocina-ba\u00f1o",
                         "Generado por Maqet demo (CC0) · preliminar, "
                         "no es certificaci\u00f3n estructural",
                         south_ticks=[5.0], west_ticks=[2.5]),
             photo_seed=11, table=False, expect_area=48.0)
    s70 = scene_70()
    save_one("plano_70m_2dorm", s70,
             render_plan(s70, "PLANO — 70 m² · 2 dormitorios",
                         "Generado por Maqet demo (CC0) · preliminar, "
                         "no es certificaci\u00f3n estructural",
                         south_ticks=[4.0, 6.5, 7.7], west_ticks=[3.0]),
             photo_seed=22, table=False, expect_area=70.0)
    sk = scene_sketch()
    save_one("croquis_ampliacion", sk, render_sketch(sk),
             photo_seed=33, table=True, expect_area=21.0)
    (OUT / "SOURCES.md").write_text(SOURCES, encoding="utf-8")
    print("wrote SOURCES.md")


if __name__ == "__main__":
    main()
