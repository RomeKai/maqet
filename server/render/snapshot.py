"""Deterministic top-view SVG snapshot of a Scene (no model calls, no new deps).

Same Scene -> byte-identical SVG: sorted-by-id element order, one 3-decimal
float formatter, no timestamps or random ids. SVG user units are meters
(``viewBox`` in meters, ``data-px-per-m="100"`` documents the fixed on-screen
scale). Plan y-up is mirrored once into SVG y-down via ``Y(y) = miny+maxy-y``.

No ``xmlns`` on purpose: the snapshot is embedded inline in the app UI, and a
bare ``<svg>`` root keeps ``ET.fromstring`` queries namespace-free.
"""

from __future__ import annotations

import math
import xml.etree.ElementTree as ET

from server.scene.models import Scene
from server.scene.names import room_display_name

SUPPORTED_LOCALES = ("en", "es-AR")

_PX_PER_M = 100
_MARGIN_M = 0.5
_EMPTY_VIEWBOX = "0 0 100 100"

_PRELIMINARY = {"en": "Preliminary", "es-AR": "Preliminar"}


def _fmt(v: float) -> str:
    """Single float formatter for byte-determinism (kills -0.000)."""
    r = round(float(v), 3)
    if r == 0:
        r = 0.0
    return f"{r:.3f}"


def _len_label(meters: float, locale: str, estimated: bool = False) -> str:
    """'3.00 m' (en) / '3,00 m' (es-AR); '≈' marks a length nobody measured."""
    s = f"{meters:.2f}"
    if locale == "es-AR":
        s = s.replace(".", ",")
    return f"{'≈' if estimated else ''}{s} m"


def _area_label(area_m2: float, locale: str) -> str:
    s = f"{abs(area_m2):.1f}"
    if locale == "es-AR":
        s = s.replace(".", ",")
    return f"{s} m²"


def _shoelace(poly: list[tuple[float, float]]) -> float:
    total = 0.0
    n = len(poly)
    for i in range(n):
        x0, y0 = poly[i]
        x1, y1 = poly[(i + 1) % n]
        total += x0 * y1 - x1 * y0
    return abs(total) / 2.0


def _centroid(poly: list[tuple[float, float]]) -> tuple[float, float]:
    xs = [p[0] for p in poly]
    ys = [p[1] for p in poly]
    return (sum(xs) / len(xs), sum(ys) / len(ys))


def _wall_frame(wall) -> tuple[tuple[float, float], float] | None:
    """Unit direction + length of a wall centerline; None if degenerate."""
    dx = wall.b[0] - wall.a[0]
    dy = wall.b[1] - wall.a[1]
    length = math.hypot(dx, dy)
    if length <= 0:
        return None
    return ((dx / length, dy / length), length)


def _furniture_corners(f) -> list[tuple[float, float]]:
    w, d = f.size_m[0], f.size_m[1]
    rad = math.radians(f.rotation_deg)
    cos_r, sin_r = math.cos(rad), math.sin(rad)
    corners = []
    for sx, sy in ((1, 1), (-1, 1), (-1, -1), (1, -1)):
        lx, ly = sx * w / 2.0, sy * d / 2.0
        corners.append((
            f.position[0] + lx * cos_r - ly * sin_r,
            f.position[1] + lx * sin_r + ly * cos_r,
        ))
    return corners


def _nice_bar(max_len: float) -> float:
    """Largest {1,2,5}x10^n fitting in max_len."""
    if max_len <= 0:
        return 0.0
    exp = math.floor(math.log10(max_len))
    for m in (5, 2, 1):
        cand = m * (10.0**exp)
        if cand <= max_len:
            return cand
    return 5.0 * (10.0 ** (exp - 1))


def _sub(parent: ET.Element, tag: str, attrs: dict[str, str]) -> ET.Element:
    return ET.SubElement(parent, tag, attrs)


def render_snapshot(scene: Scene, locale: str = "en") -> str:
    """Render the Scene as a deterministic top-view SVG document string."""
    if locale not in SUPPORTED_LOCALES:
        raise ValueError(f"unsupported locale {locale!r}; expected one of {SUPPORTED_LOCALES}")

    walls = sorted(scene.walls, key=lambda w: w.id)
    frames = {w.id: _wall_frame(w) for w in walls}

    # --- bounds over walls (±thickness/2), rooms, furniture footprints ---
    minx = miny = math.inf
    maxx = maxy = -math.inf

    def grow(x: float, y: float) -> None:
        nonlocal minx, miny, maxx, maxy
        minx, miny = min(minx, x), min(miny, y)
        maxx, maxy = max(maxx, x), max(maxy, y)

    for w in walls:
        if frames[w.id] is None:
            continue
        h = w.thickness_m / 2.0
        for px, py in (w.a, w.b):
            grow(px - h, py - h)
            grow(px + h, py + h)
    for r in scene.rooms:
        for px, py in r.polygon:
            grow(px, py)
    for f in scene.furniture:
        for px, py in _furniture_corners(f):
            grow(px, py)
    # A door's swing square (hinge .. hinge + width on the left normal) must fit, not only the wall footprint.
    wall_by_id = {w.id: w for w in walls}
    for o in scene.openings:
        w = wall_by_id.get(o.wall_id)
        frame = frames.get(o.wall_id)
        if w is None or frame is None or o.kind != "door":
            continue
        (ux, uy), length = frame
        cs, ce = max(0.0, o.offset_m), min(length, o.offset_m + o.width_m)
        if ce - cs <= 1e-9:
            continue
        for t in (cs, ce):
            bx, by = w.a[0] + ux * t, w.a[1] + uy * t
            grow(bx, by)
            grow(bx - uy * (ce - cs), by + ux * (ce - cs))

    # Dimension labels sit outside the plan: size them from the plan so they stay readable on a phone card
    # (the card scales the whole viewBox to its width), then make room for them in the bounds.
    label_size = 0.24
    if not math.isinf(minx):
        label_size = max(0.24, 0.032 * max(maxx - minx, maxy - miny))
    centre = ((minx + maxx) / 2.0, (miny + maxy) / 2.0) if not math.isinf(minx) else (0.0, 0.0)
    labels: list[dict] = []
    for w in walls:
        frame = frames[w.id]
        if frame is None:
            continue
        (ux, uy), length = frame
        nx, ny = -uy, ux
        mx, my = (w.a[0] + w.b[0]) / 2.0, (w.a[1] + w.b[1]) / 2.0
        outward = 1.0 if (mx - centre[0]) * nx + (my - centre[1]) * ny >= 0 else -1.0
        off = w.thickness_m / 2.0 + label_size * 1.4
        text = _len_label(length, locale, estimated=w.provenance == "estimated")
        labels.append({"kind": "wall", "id": w.id, "x": mx + nx * off * outward, "y": my + ny * off * outward, "text": text})
    for o in sorted(scene.openings, key=lambda o: o.id):
        w = wall_by_id.get(o.wall_id)
        frame = frames.get(o.wall_id)
        if w is None or frame is None:
            continue
        (ux, uy), length = frame
        cs, ce = max(0.0, o.offset_m), min(length, o.offset_m + o.width_m)
        if ce - cs <= 1e-9:
            continue
        nx, ny = -uy, ux
        mx, my = w.a[0] + ux * (cs + ce) / 2.0, w.a[1] + uy * (cs + ce) / 2.0
        # Opposite the door swing (left normal), so the label never sits on the arc.
        off = w.thickness_m / 2.0 + label_size * 0.9
        labels.append({"kind": "opening", "id": o.id, "x": mx - nx * off, "y": my - ny * off, "text": _len_label(ce - cs, locale)})
    for lab in labels:
        half = 0.62 * label_size * len(lab["text"]) / 2.0
        grow(lab["x"] - half, lab["y"] - label_size)
        grow(lab["x"] + half, lab["y"] + label_size * 0.3)

    root = ET.Element("svg", {
        "data-px-per-m": str(_PX_PER_M),
    })
    if math.isinf(minx):
        root.set("viewBox", _EMPTY_VIEWBOX)
        root.set("width", "100")
        root.set("height", "100")
        prelim = _sub(root, "text", {
            "data-preliminary": "true",
            "x": _fmt(100 - 0.2),
            "y": _fmt(0.4),
            "text-anchor": "end",
            "font-size": "4",
        })
        prelim.text = _PRELIMINARY[locale]
        return ET.tostring(root, encoding="unicode")

    minx -= _MARGIN_M
    miny -= _MARGIN_M
    maxx += _MARGIN_M
    maxy += _MARGIN_M
    width, height = maxx - minx, maxy - miny
    root.set("viewBox", f"{_fmt(minx)} {_fmt(miny)} {_fmt(width)} {_fmt(height)}")
    root.set("width", _fmt(width * _PX_PER_M))
    root.set("height", _fmt(height * _PX_PER_M))

    def X(x: float) -> str:
        return _fmt(x)

    def Y(y: float) -> str:
        return _fmt(miny + maxy - y)

    # --- rooms: outline + name/area labels ---
    rooms_g = _sub(root, "g", {"data-layer": "rooms"})
    for r in sorted(scene.rooms, key=lambda r: r.id):
        pts = " ".join(f"{X(px)},{Y(py)}" for px, py in r.polygon)
        _sub(rooms_g, "polygon", {
            "data-room": r.id,
            "points": pts,
            "fill": "none",
            "stroke": "#111111",
            "stroke-width": _fmt(0.03),
        })
        cx, cy = _centroid(r.polygon)
        name_t = _sub(rooms_g, "text", {
            "data-room": r.id,
            "x": X(cx),
            "y": Y(cy),
            "text-anchor": "middle",
            "font-size": _fmt(0.28),
        })
        name_t.text = room_display_name(r.name, locale)
        area_t = _sub(rooms_g, "text", {
            "data-room": r.id,
            "x": X(cx),
            "y": _fmt(miny + maxy - cy + 0.35),
            "text-anchor": "middle",
            "font-size": _fmt(0.24),
        })
        area_t.text = _area_label(_shoelace([(p[0], p[1]) for p in r.polygon]), locale)

    # --- walls: centerline split at openings, one polygon per solid run ---
    by_wall: dict[str, list] = {}
    for o in scene.openings:
        by_wall.setdefault(o.wall_id, []).append(o)
    walls_g = _sub(root, "g", {"data-layer": "walls"})
    openings_g = _sub(root, "g", {"data-layer": "openings"})
    for w in walls:
        frame = frames[w.id]
        if frame is None:
            continue
        (ux, uy), length = frame
        nx, ny = -uy, ux  # left normal; door leaves swing to this side
        h = w.thickness_m / 2.0

        blocked: list[tuple[float, float]] = []
        for o in sorted(by_wall.get(w.id, []), key=lambda o: o.id):
            cs, ce = max(0.0, o.offset_m), min(length, o.offset_m + o.width_m)
            if ce - cs <= 1e-9:
                continue
            blocked.append((cs, ce))
        blocked.sort()
        solid: list[tuple[float, float]] = []
        cursor = 0.0
        for cs, ce in blocked:
            if cs > cursor:
                solid.append((cursor, min(cs, length)))
            cursor = max(cursor, ce)
        if cursor < length:
            solid.append((cursor, length))

        for s0, s1 in solid:
            if s1 - s0 <= 1e-9:
                continue
            p0 = (w.a[0] + ux * s0, w.a[1] + uy * s0)
            p1 = (w.a[0] + ux * s1, w.a[1] + uy * s1)
            corners = (
                (p0[0] + nx * h, p0[1] + ny * h),
                (p1[0] + nx * h, p1[1] + ny * h),
                (p1[0] - nx * h, p1[1] - ny * h),
                (p0[0] - nx * h, p0[1] - ny * h),
            )
            _sub(walls_g, "polygon", {
                "data-wall": w.id,
                "points": " ".join(f"{X(cx)},{Y(cy)}" for cx, cy in corners),
                "fill": "#3f3f46",
                "stroke": "none",
            })

        for o in sorted(by_wall.get(w.id, []), key=lambda o: o.id):
            cs, ce = max(0.0, o.offset_m), min(length, o.offset_m + o.width_m)
            cw = ce - cs
            if cw <= 1e-9:
                continue  # clamped away: gap off the wall, draw nothing
            if o.kind == "door":
                hx, hy = w.a[0] + ux * cs, w.a[1] + uy * cs
                sx, sy = hx + ux * cw, hy + uy * cw
                ex, ey = hx + nx * cw, hy + ny * cw
                v0 = (sx - hx, (miny + maxy - sy) - (miny + maxy - hy))
                v1 = (ex - hx, (miny + maxy - ey) - (miny + maxy - hy))
                sweep = "1" if (v0[0] * v1[1] - v0[1] * v1[0]) > 0 else "0"
                _sub(openings_g, "path", {
                    "data-opening": o.id,
                    "d": (f"M {X(sx)},{Y(sy)} A {_fmt(cw)} {_fmt(cw)} "
                          f"0 0 {sweep} {X(ex)},{Y(ey)}"),
                    "fill": "none",
                    "stroke": "#111111",
                    "stroke-width": _fmt(0.02),
                })
                _sub(openings_g, "line", {
                    "data-opening": o.id,
                    "x1": X(hx), "y1": Y(hy),
                    "x2": X(ex), "y2": Y(ey),
                    "stroke": "#111111",
                    "stroke-width": _fmt(0.03),
                })
            else:  # window: two parallel lines across the gap
                d = w.thickness_m / 4.0
                for side in (1.0, -1.0):
                    x0 = w.a[0] + ux * cs + nx * d * side
                    y0 = w.a[1] + uy * cs + ny * d * side
                    x1 = w.a[0] + ux * ce + nx * d * side
                    y1 = w.a[1] + uy * ce + ny * d * side
                    _sub(openings_g, "line", {
                        "data-opening": o.id,
                        "x1": X(x0), "y1": Y(y0),
                        "x2": X(x1), "y2": Y(y1),
                        "stroke": "#111111",
                        "stroke-width": _fmt(0.02),
                    })

    # --- furniture footprints ---
    furn_g = _sub(root, "g", {"data-layer": "furniture"})
    for f in sorted(scene.furniture, key=lambda f: f.id):
        attrs = {
            "data-furniture": f.id,
            "points": " ".join(f"{X(px)},{Y(py)}" for px, py in _furniture_corners(f)),
            "fill": "none",
            "stroke": "#52525b",
            "stroke-width": _fmt(0.02),
        }
        if f.concept:
            attrs["data-concept"] = "true"
            attrs["stroke-dasharray"] = f"{_fmt(0.12)} {_fmt(0.08)}"
        _sub(furn_g, "polygon", attrs)

    # --- dimensions: wall lengths outside, opening widths on the inner side ---
    dims_g = _sub(root, "g", {"data-layer": "dimensions"})
    for lab in labels:
        t = _sub(dims_g, "text", {
            "data-dim": lab["kind"],
            "data-for": lab["id"],
            "x": X(lab["x"]),
            "y": Y(lab["y"]),
            "text-anchor": "middle",
            "dominant-baseline": "middle",
            "font-size": _fmt(label_size if lab["kind"] == "wall" else label_size * 0.85),
            "fill": "#111111" if lab["kind"] == "wall" else "#52525b",
        })
        t.text = lab["text"]

    # --- scale bar, bottom-left inside the margin ---
    bar = _nice_bar(width / 4.0)
    if bar > 0:
        # SVG space: y grows downward, so bottom-left = large y near the base.
        bx = minx + 0.2
        bh = 0.12
        rect_y = miny + height - 0.2 - bh
        bar_g = _sub(root, "g", {"data-meters": _fmt(bar)})
        _sub(bar_g, "rect", {
            "x": X(bx), "y": _fmt(rect_y),
            "width": _fmt(bar), "height": _fmt(bh),
            "fill": "#111111",
        })
        bar_t = _sub(bar_g, "text", {
            "x": X(bx), "y": _fmt(rect_y - 0.05),
            "font-size": _fmt(0.24),
        })
        bar_t.text = f"{bar:g} m"

    # --- preliminary corner label, top-right ---
    prelim = _sub(root, "text", {
        "data-preliminary": "true",
        "x": X(maxx - 0.2),
        "y": _fmt(miny + 0.4),
        "text-anchor": "end",
        "font-size": _fmt(0.28),
    })
    prelim.text = _PRELIMINARY[locale]

    return ET.tostring(root, encoding="unicode")
