"""Construction rules (ADR-023): deterministic, never in prompts.

Small unit-tested rule set of Argentine building rules of thumb. Each value
cites its source next to it. Values without a verifiable source are marked
"# rule of thumb, unverified" — they are Maqet defaults, not code citations.
"""

from __future__ import annotations

# --- Habitable rooms ---------------------------------------------------------
# IRAM 11601 / CABA Código de Edificación habitability guidance commonly
# summarized as: bedrooms >= 9 m2, kitchen >= 6 m2, living >= 12 m2.
# Per-room minimums vary by municipality; use the smallest widely-cited value
# as the shared floor and municipal codes for the strict figure.
MIN_HABITABLE_ROOM_AREA_M2 = 6.0  # rule of thumb, unverified
# Minimum side of a habitable room (allows a single bed + circulation).
# Source: common design guidance (Neufert "El arte de proyectar"); municipal
# codes usually require 2.40-2.80 m for bedrooms — ours is the looser survey
# floor, flagged as unverified.
MIN_HABITABLE_ROOM_SIDE_M = 2.0  # rule of thumb, unverified

# --- Ventilation and natural light -------------------------------------------
# CABA Código de Edificación art. 4.6 / commonly cited rule of thumb:
# window (iluminación) >= 1/10 of floor area; half of it openable
# (ventilación). Values vary by jurisdiction; keep the widely-cited minimum.
MIN_WINDOW_TO_FLOOR_RATIO = 0.10  # CABA CE art. 4.6 rule of thumb, verify for municipality
MIN_VENT_OPENABLE_RATIO = 0.50  # rule of thumb, unverified (half of window area openable)

# --- Minimum ceiling height --------------------------------------------------
# CABA Código de Edificación art. 4.5: habitable rooms >= 2.60 m (first
# category), >= 2.40 m other cases — keep the stricter 2.60 m as default.
MIN_CEILING_HEIGHT_M = 2.60  # CABA CE art. 4.5, first-category rooms
DEFAULT_CEILING_HEIGHT_M = 2.6  # Maqet Scene default (matches rule)

# --- Doors -------------------------------------------------------------------
# IRAM / accessibility guidance (and CABA CE): main doors >= 0.90 m leaf for
# accessibility; interior passage minimum 0.80 m.
DOOR_WIDTH_M = 0.90  # accessibility guidance, IRAM/CABA CE rule of thumb
MIN_DOOR_WIDTH_M = 0.80  # absolute passage minimum, rule of thumb, unverified
# Recommended clear corridor width for a wheelchair turn / moving furniture.
MIN_CORRIDOR_WIDTH_M = 1.00  # accessibility guidance, rule of thumb, unverified

# --- Masonry wall thicknesses ------------------------------------------------
# Common Argentine construction practice: exterior load-bearing brick wall
# with 18 cm brick + plaster ~= 0.20 m; interior 8 cm brick + plaster ~= 0.10 m.
EXTERIOR_WALL_THICKNESS_M = 0.20  # common practice (ladrillo 18 + revoques)
INTERIOR_WALL_THICKNESS_M = 0.10  # common practice (ladrillo 8 + revoques)

# --- Spans -------------------------------------------------------------------
# Common practice: masonry walls spanning more than ~4 m between supports
# need a beam or reinforced bond beam (encadenado); verify with a structural
# calculation for the actual materials and loads.
MAX_UNSUPPORTED_SPAN_M = 4.0  # rule of thumb, unverified — always verify structurally

# --- Geometry / usability -----------------------------------------------------
# Clear space in front of a door leaf swing.
DOOR_CLEARANCE_M = 0.6  # usability floor (see scene-model skill)

# --- Professional-required flags (ADR-023) ------------------------------------
# These do not block geometry; they travel in the validation report so every
# output (app, share link, takeoff, DXF notes) shows "needs a licensed
# professional" in Spanish.
PRO_FLAG_SECOND_FLOOR = "needs_professional:second_floor"
PRO_FLAG_LOAD_BEARING = "needs_professional:load_bearing_wall"
PRO_FLAG_SPAN = "needs_professional:span_over_limit"
PRO_FLAG_SOIL = "needs_professional:unknown_soil"
