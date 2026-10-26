"""Construction rules (ADR-023): deterministic, never in prompts.

Small unit-tested rule set of Argentine building rules of thumb. Values
without a verifiable source are marked "# rule of thumb, unverified" — they
are Maqet defaults, not code citations. The current CABA building code is
Ley 6100 (mod. Ley 6438); treat it as "a verificar", never as the confirmed
source of a value.
"""

from __future__ import annotations

# --- Habitable rooms ---------------------------------------------------------
# Commonly summarized guidance: bedrooms >= 9 m2, kitchen >= 6 m2,
# living >= 12 m2. Per-room minimums vary by municipality; use the smallest
# widely-cited value as the shared floor and municipal codes for the strict
# figure.
MIN_HABITABLE_ROOM_AREA_M2 = 6.0  # rule of thumb, unverified
# Minimum side of a habitable room (allows a single bed + circulation).
# Municipal codes usually require 2.40-2.80 m for bedrooms — ours is the
# looser survey floor.
MIN_HABITABLE_ROOM_SIDE_M = 2.0  # rule of thumb, unverified

# --- Ventilation and natural light -------------------------------------------
# Commonly cited rule of thumb: window (iluminación) >= 1/10 of floor area;
# half of it openable (ventilación). Values vary by jurisdiction. Note: a
# secondary GCBA source indicates 20% of floor area for iluminación and 1/3
# of that for ventilación — keep the widely-cited 1/10 minimum below.
MIN_WINDOW_TO_FLOOR_RATIO = 0.10  # rule of thumb, unverified
MIN_VENT_OPENABLE_RATIO = 0.50  # rule of thumb, unverified (half of window area openable)

# --- Minimum ceiling height --------------------------------------------------
# Commonly cited 2.60 m for habitable rooms; the strict figure depends on the
# municipality (CABA Ley 6100 mod. Ley 6438, a verificar).
MIN_CEILING_HEIGHT_M = 2.60  # rule of thumb, unverified
DEFAULT_CEILING_HEIGHT_M = 2.6  # Maqet Scene default (matches rule)

# --- Doors -------------------------------------------------------------------
# Main doors >= 0.90 m leaf for accessibility; interior passage minimum
# 0.80 m.
DOOR_WIDTH_M = 0.90  # rule of thumb, unverified
MIN_DOOR_WIDTH_M = 0.80  # rule of thumb, unverified
# Recommended clear corridor width for a wheelchair turn / moving furniture.
MIN_CORRIDOR_WIDTH_M = 1.00  # rule of thumb, unverified

# --- Masonry wall thicknesses ------------------------------------------------
# Common Argentine construction practice: exterior load-bearing brick wall
# with 18 cm brick + plaster ~= 0.20 m; interior 8 cm brick + plaster ~= 0.10 m.
EXTERIOR_WALL_THICKNESS_M = 0.20  # rule of thumb, unverified (ladrillo 18 + revoques)
INTERIOR_WALL_THICKNESS_M = 0.10  # rule of thumb, unverified (ladrillo 8 + revoques)

# --- Spans -------------------------------------------------------------------
# Common practice: masonry walls spanning more than ~4 m between supports
# need a beam or reinforced bond beam (encadenado); verify with a structural
# calculation for the actual materials and loads.
MAX_UNSUPPORTED_SPAN_M = 4.0  # rule of thumb, unverified — always verify structurally

# --- Geometry / usability -----------------------------------------------------
# Clear space in front of a door leaf swing.
DOOR_CLEARANCE_M = 0.6  # rule of thumb, unverified (usability floor, see scene-model skill)

# --- Professional-required flags (ADR-023) ------------------------------------
# These do not block geometry; they travel in the validation report so every
# output (app, share link, takeoff, DXF notes) shows "needs a licensed
# professional" in Spanish.
PRO_FLAG_SECOND_FLOOR = "needs_professional:second_floor"
PRO_FLAG_LOAD_BEARING = "needs_professional:load_bearing_wall"
PRO_FLAG_SPAN = "needs_professional:span_over_limit"
PRO_FLAG_SOIL = "needs_professional:unknown_soil"
