"""Staged construction takeoff (ADR-021, ADR-024).

Deterministic: Scene geometry x per-material recipes in assets/catalog.json,
split by construction stage. No model calls, no prices. Every output is
labelled preliminary; Maqet never certifies structural safety (ADR-023).
"""

from __future__ import annotations

import csv
import io
import json
import math
from pathlib import Path

from pydantic import BaseModel, Field

from server.scene.models import Scene, Wall
from server.scene.rules import PRO_FLAG_SOIL
from server.scene.validation import validate_scene

CATALOG_PATH = Path(__file__).resolve().parents[2] / "assets" / "catalog.json"

STAGE_ORDER: tuple[str, ...] = (
    "foundations",
    "walls",
    "bond_beams_roof",
    "openings",
    "finishes",
)

# --- Provisional footing (rule of thumb, unverified) ---------------------------
# No footing recipe exists in the catalog; size below is a provisional default
# "to be confirmed by a professional" (human decision, 2026-10-28). Day crew
# moves these into rules.py; every foundations line is labelled estimated.
FOOTING_WIDTH_M = 0.40  # provisional, rule of thumb, unverified
FOOTING_DEPTH_M = 0.60  # provisional, rule of thumb, unverified
FOOTING_SOURCE = (
    "provisional footing 0.40 x 0.60 m, rule of thumb, unverified - "
    "to be confirmed by a licensed professional"
)
# 1:2:3 concrete yield per m3 of concrete (provisional, same status as above).
# Gravel comes from the catalog recipe; sand/cement have no footing recipe.
CONCRETE_SAND_M3_PER_M3 = 0.45  # provisional, rule of thumb, unverified
CONCRETE_CEMENT_BAGS_PER_M3 = 7.0  # provisional, rule of thumb, unverified
CONCRETE_DERIVED_SOURCE = (
    "provisional 1:2:3 concrete yield, rule of thumb, unverified - "
    "to be confirmed by a licensed professional"
)

FINISH_SOURCE = "geometric area, no catalog recipe"
UNITS_MATERIAL = "unspecified"

_EPS = 1e-6


def _load_recipes() -> dict[str, dict[str, object]]:
    catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    recipes: dict[str, dict[str, object]] = {}
    for material in catalog["materials"]:
        recipes[material["id"]] = {
            "unit": material["unit"],
            "qty": float(material["recipe"]["qty"]),
            "waste_factor": float(material["waste_factor"]),
            "recipe_source": str(material["recipe_source"]),
        }
    return recipes


RECIPES: dict[str, dict[str, object]] = _load_recipes()


class TakeoffItem(BaseModel):
    material_id: str = Field(min_length=1)
    unit: str = Field(min_length=1)
    quantity: float
    waste_factor: float
    recipe_source: str = Field(min_length=1)
    estimated: bool = False


class TakeoffStage(BaseModel):
    name: str = Field(min_length=1)
    items: list[TakeoffItem] = Field(default_factory=list)


class Takeoff(BaseModel):
    stages: list[TakeoffStage] = Field(default_factory=list)
    built_m: float = 0.0
    demolished_m: float = 0.0
    built_m2: float = 0.0
    demolished_m2: float = 0.0
    professional_flags: list[str] = Field(default_factory=list)
    has_estimated: bool = False
    preliminary: bool = True


def _wall_length(wall: Wall) -> float:
    return math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1])


def _wall_height(wall: Wall, scene: Scene) -> float:
    return wall.height_m if wall.height_m is not None else scene.ceiling_height_m


def _polygon_area(poly: list[tuple[float, float]]) -> float:
    area = 0.0
    n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        area += x1 * y2 - x2 * y1
    return abs(area) / 2.0


def _same_point(p: tuple[float, float], q: tuple[float, float]) -> bool:
    return abs(p[0] - q[0]) <= _EPS and abs(p[1] - q[1]) <= _EPS


def _moved(a: Wall, b: Wall) -> bool:
    same = (_same_point(a.a, b.a) and _same_point(a.b, b.b)) or (
        # Same segment stored with endpoints flipped (common in CAD
        # round-trips) is not a rebuild.
        _same_point(a.a, b.b) and _same_point(a.b, b.a)
    )
    return not same


def _diff_walls(
    scene: Scene, base: Scene | None
) -> tuple[list[Wall], list[Wall]]:
    """Match walls by id only. Returns (built, demolished)."""
    if base is None:
        return list(scene.walls), []
    base_by_id = {w.id: w for w in base.walls}
    scene_by_id = {w.id: w for w in scene.walls}
    built = [
        w
        for wid, w in scene_by_id.items()
        if wid not in base_by_id or _moved(w, base_by_id[wid])
    ]
    demolished = [
        w
        for wid, w in base_by_id.items()
        if wid not in scene_by_id or _moved(w, scene_by_id[wid])
    ]
    return built, demolished


def _brick_for_thickness(thickness_m: float) -> str:
    known = (
        ("brick-solid-common-20", 0.20),
        ("brick-hollow-12-10", 0.10),
        ("brick-hollow-18-18", 0.18),
    )
    for material_id, nominal in known:
        if abs(thickness_m - nominal) <= _EPS:
            return material_id
    return min(known, key=lambda pair: abs(thickness_m - pair[1]))[0]


def _recipe_line(
    material_id: str, raw_qty: float, estimated: bool
) -> TakeoffItem:
    recipe = RECIPES[material_id]
    qty = float(recipe["qty"])
    waste = float(recipe["waste_factor"])
    return TakeoffItem(
        material_id=material_id,
        unit=str(recipe["unit"]),
        quantity=raw_qty * qty * waste,
        waste_factor=waste,
        recipe_source=str(recipe["recipe_source"]),
        estimated=estimated,
    )


def compute_takeoff(scene: Scene, base: Scene | None = None) -> Takeoff:
    """Staged takeoff of `scene`; when `base` is given only new walls count.

    Pure: reads the Scene (and catalog recipes loaded at import), never calls
    models, never mutates its inputs.
    """
    built, demolished = _diff_walls(scene, base)
    built_ids = {w.id for w in built}
    scene_wall_ids = {w.id for w in scene.walls}

    openings_by_wall: dict[str, list] = {}
    base_opening_ids = {o.id for o in base.openings} if base is not None else set()
    for opening in scene.openings:
        if opening.wall_id not in scene_wall_ids:
            # Orphan: references a wall that is not in this scene
            # (removed, or never existed). Never produces material.
            continue
        if (
            opening.wall_id in built_ids
            or base is None
            or opening.id not in base_opening_ids
        ):
            openings_by_wall.setdefault(opening.wall_id, []).append(opening)

    def wall_net_m2(wall: Wall) -> float:
        gross = _wall_length(wall) * _wall_height(wall, scene)
        holes = sum(
            o.width_m * o.height_m
            for o in openings_by_wall.get(wall.id, [])
        )
        return max(gross - holes, 0.0)

    def is_estimated(wall: Wall) -> bool:
        return wall.provenance == "estimated"

    # --- foundations: footing volume on built walls -------------------------
    built_length_m = sum(_wall_length(w) for w in built)
    concrete_m3 = built_length_m * FOOTING_WIDTH_M * FOOTING_DEPTH_M
    foundations: list[TakeoffItem] = []
    if concrete_m3 > 0:
        gravel = RECIPES["gravel-m3"]
        foundations.append(
            TakeoffItem(
                material_id="gravel-m3",
                unit=str(gravel["unit"]),
                quantity=concrete_m3
                * float(gravel["qty"])
                * float(gravel["waste_factor"]),
                waste_factor=float(gravel["waste_factor"]),
                recipe_source=str(gravel["recipe_source"]),
                estimated=True,
            )
        )
        foundations.append(
            TakeoffItem(
                material_id="sand-m3",
                unit="m3",
                quantity=concrete_m3 * CONCRETE_SAND_M3_PER_M3 * 1.1,
                waste_factor=1.1,
                recipe_source=CONCRETE_DERIVED_SOURCE,
                estimated=True,
            )
        )
        foundations.append(
            TakeoffItem(
                material_id="cement-bag-50kg",
                unit="bag",
                quantity=concrete_m3 * CONCRETE_CEMENT_BAGS_PER_M3 * 1.05,
                waste_factor=1.05,
                recipe_source=CONCRETE_DERIVED_SOURCE,
                estimated=True,
            )
        )

    # --- walls: bricks by thickness, mortar + binders on total net m2 --------
    # mortar-13 recipe assumes a 0.20 m wall; applying it to thinner walls is
    # a provisional overstatement (noted, not hidden).
    net_by_brick: dict[str, float] = {}
    net_estimated_by_brick: dict[str, bool] = {}
    total_net_m2 = 0.0
    walls_estimated = False
    for wall in built:
        net = wall_net_m2(wall)
        if net <= 0:
            continue
        total_net_m2 += net
        brick = _brick_for_thickness(wall.thickness_m)
        net_by_brick[brick] = net_by_brick.get(brick, 0.0) + net
        if is_estimated(wall):
            net_estimated_by_brick[brick] = True
            walls_estimated = True
    walls: list[TakeoffItem] = []
    for material_id, net in sorted(net_by_brick.items()):
        if net > 0:
            walls.append(
                _recipe_line(
                    material_id, net, net_estimated_by_brick.get(material_id, False)
                )
            )
    if total_net_m2 > 0:
        walls.append(_recipe_line("mortar-13", total_net_m2, walls_estimated))
        mortar_raw_m3 = total_net_m2 * float(RECIPES["mortar-13"]["qty"])
        # cement and sand derive from the mortar volume via their
        # m3_mortar recipes (raw = mortar_m3 x qty, waste applied inside).
        cement_qty = float(RECIPES["cement-bag-50kg"]["qty"])
        cement_waste = float(RECIPES["cement-bag-50kg"]["waste_factor"])
        walls.append(
            TakeoffItem(
                material_id="cement-bag-50kg",
                unit="bag",
                quantity=mortar_raw_m3 * cement_qty * cement_waste,
                waste_factor=cement_waste,
                recipe_source=str(RECIPES["cement-bag-50kg"]["recipe_source"]),
                estimated=walls_estimated,
            )
        )
        sand_qty = float(RECIPES["sand-m3"]["qty"])
        sand_waste = float(RECIPES["sand-m3"]["waste_factor"])
        walls.append(
            TakeoffItem(
                material_id="sand-m3",
                unit="m3",
                quantity=mortar_raw_m3 * sand_qty * sand_waste,
                waste_factor=sand_waste,
                recipe_source=str(RECIPES["sand-m3"]["recipe_source"]),
                estimated=walls_estimated,
            )
        )

    # --- bond beams + roof ----------------------------------------------------
    beam_roof: list[TakeoffItem] = []
    beam_estimated = any(is_estimated(w) for w in built)
    if built_length_m > 0:
        beam_roof.append(
            _recipe_line("steel-bar-6mm", built_length_m, beam_estimated)
        )
        beam_roof.append(
            _recipe_line("steel-bar-8mm", built_length_m, beam_estimated)
        )
    roof_m2 = sum(_polygon_area(list(r.polygon)) for r in scene.rooms)
    if roof_m2 > 0:
        beam_roof.append(
            _recipe_line("roofing-sheet-galv", roof_m2, beam_estimated)
        )

    # --- openings: pieces on built walls --------------------------------------
    # Provisional: counts only (door-90 / window-120 per piece regardless of
    # actual width). Removed openings ride inside demolished wall metres.
    doors = sum(
        1 for ops in openings_by_wall.values() for o in ops if o.kind == "door"
    )
    windows = sum(
        1 for ops in openings_by_wall.values() for o in ops if o.kind == "window"
    )
    openings_estimated = any(
        is_estimated(w)
        for w in built
        if w.id in openings_by_wall and openings_by_wall[w.id]
    )
    openings: list[TakeoffItem] = []
    if doors > 0:
        openings.append(_recipe_line("door-90", float(doors), openings_estimated))
    if windows > 0:
        openings.append(
            _recipe_line("window-120", float(windows), openings_estimated)
        )

    # --- finishes: geometric areas even with empty surfaces -------------------
    # Floors: one line per room (floor-surface material else 'unspecified').
    # Wall finish: one line per wall side (side-surface material else
    # 'unspecified'); walls carry no room attribution, so no room grouping is
    # invented for them.
    room_floor_material: dict[str, str] = {}
    wall_side_material: dict[tuple[str, str], str] = {}
    for surface in scene.surfaces:
        target = surface.target
        if target.type == "room" and target.part == "floor":
            room_floor_material.setdefault(target.room_id, surface.material_id)
        elif target.type == "wall":
            wall_side_material.setdefault(
                (target.wall_id, target.side), surface.material_id
            )
    finishes: list[TakeoffItem] = []
    for room in scene.rooms:
        area = _polygon_area(list(room.polygon))
        if area > 0:
            finishes.append(
                TakeoffItem(
                    material_id=room_floor_material.get(room.id, UNITS_MATERIAL),
                    unit="m2",
                    quantity=area,
                    waste_factor=1.0,
                    recipe_source=FINISH_SOURCE,
                    estimated=False,
                )
            )
    for wall in built:
        net = wall_net_m2(wall)
        if net <= 0:
            continue
        for side in ("left", "right"):
            finishes.append(
                TakeoffItem(
                    material_id=wall_side_material.get(
                        (wall.id, side), UNITS_MATERIAL
                    ),
                    unit="m2",
                    quantity=net,
                    waste_factor=1.0,
                    recipe_source=FINISH_SOURCE,
                    estimated=is_estimated(wall),
                )
            )

    # --- totals, flags, label --------------------------------------------------
    built_m2 = sum(_wall_length(w) * _wall_height(w, scene) for w in built)
    demolished_m2 = 0.0
    if base is not None:
        demolished_m2 = sum(
            _wall_length(w) * _wall_height(w, base) for w in demolished
        )
    flags = [str(f) for f in validate_scene(scene).flags]
    if foundations and PRO_FLAG_SOIL not in flags:
        # Foundations sit on untested soil until a study says otherwise.
        flags.append(PRO_FLAG_SOIL)

    stages = [
        TakeoffStage(name="foundations", items=foundations),
        TakeoffStage(name="walls", items=walls),
        TakeoffStage(name="bond_beams_roof", items=beam_roof),
        TakeoffStage(name="openings", items=openings),
        TakeoffStage(name="finishes", items=finishes),
    ]
    has_estimated = any(i.estimated for s in stages for i in s.items)
    return Takeoff(
        stages=stages,
        built_m=built_length_m,
        demolished_m=sum(_wall_length(w) for w in demolished),
        built_m2=built_m2,
        demolished_m2=demolished_m2,
        professional_flags=flags,
        has_estimated=has_estimated,
        preliminary=True,
    )


def to_csv(takeoff: Takeoff) -> str:
    """One row per item; header exactly
    stage,material_id,unit,quantity,waste_factor,recipe_source,estimated."""
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(
        [
            "stage",
            "material_id",
            "unit",
            "quantity",
            "waste_factor",
            "recipe_source",
            "estimated",
        ]
    )
    for stage in takeoff.stages:
        for item in stage.items:
            writer.writerow(
                [
                    stage.name,
                    item.material_id,
                    item.unit,
                    item.quantity,
                    item.waste_factor,
                    item.recipe_source,
                    "true" if item.estimated else "false",
                ]
            )
    return buf.getvalue().strip("\r\n")
