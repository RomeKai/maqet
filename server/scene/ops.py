"""Ops (ADR-002): pure Scene -> Scene functions for the Reform stage.

Each op validates its input and the resulting Scene, returns
``(new_scene, OpResult)`` and bumps ``version`` on success. On failure the
input scene is returned unchanged with ``ok=False``.

History: every successful op produces an OpRecord
({op, args, before_version, after_version, actor}). Undo = replay up to N-1
(see replay()/undo() below; variants.py in later phases builds on replay).
"""

from __future__ import annotations

from dataclasses import dataclass, replace

from pydantic import ValidationError

from server.scene.models import Furniture, Opening, Room, Scene, Surface, Wall
from server.scene.rooms import check_furniture, recompute_rooms, repolygonize
from server.scene.validation import (
    ValidationContext,
    validate_scene,
)

VALID_ACTORS = ("agent", "user")


@dataclass(frozen=True)
class OpRecord:
    op: str
    args: dict
    before_version: int
    after_version: int
    actor: str


@dataclass(frozen=True)
class OpResult:
    ok: bool
    errors: tuple[str, ...] = ()
    warnings: tuple[str, ...] = ()
    flags: tuple[str, ...] = ()
    changed_ids: tuple[str, ...] = ()
    record: OpRecord | None = None


def _check_actor(actor: str) -> str | None:
    if actor not in VALID_ACTORS:
        return f"unknown actor {actor!r} (expected one of {VALID_ACTORS})"
    return None


def _fail(scene: Scene, *errors: str) -> tuple[Scene, OpResult]:
    return scene, OpResult(ok=False, errors=tuple(errors))


def _merge_flags(persisted: list[str], raised: tuple[str, ...]) -> list[str]:
    """Append each raised flag's stable code once; never drop one."""
    merged = list(persisted)
    for flag in raised:
        code = getattr(flag, "code", str(flag))
        if code not in merged:
            merged.append(code)
    return merged


def _apply(
    scene: Scene,
    op: str,
    args: dict,
    candidate: Scene,
    changed_ids: list[str],
    actor: str,
    ctx: ValidationContext | None = None,
) -> tuple[Scene, OpResult]:
    # ADR-001/002: rooms are derived — repolygonize after every op, carry
    # survivor assignments, drop dead rooms to unassigned (warn), then
    # re-validate furniture (block, never move silently) + construction rules.
    derived = repolygonize(candidate.walls)
    new_rooms, new_surfaces, new_furniture, room_warnings = recompute_rooms(
        old_rooms=scene.rooms,
        explicit_rooms=list(candidate.rooms),
        derived_polys=derived,
        surfaces=list(candidate.surfaces),
        furniture=list(candidate.furniture),
        old_derived_polys=repolygonize(scene.walls),
    )
    candidate = candidate.model_copy(
        update={
            "rooms": new_rooms,
            "surfaces": new_surfaces,
            "furniture": new_furniture,
        }
    )
    furniture_errors, _ = check_furniture(candidate)
    if furniture_errors:
        return scene, OpResult(ok=False, errors=furniture_errors)
    report = validate_scene(candidate, ctx)
    if report.errors:
        return scene, OpResult(ok=False, errors=report.errors)
    new_scene = candidate.model_copy(
        update={
            "version": scene.version + 1,
            "professional_flags": _merge_flags(
                candidate.professional_flags, report.flags
            ),
        }
    )
    record = OpRecord(
        op=op,
        args=args,
        before_version=scene.version,
        after_version=new_scene.version,
        actor=actor,
    )
    return new_scene, OpResult(
        ok=True,
        warnings=(*room_warnings, *report.warnings),
        flags=report.flags,
        changed_ids=tuple(changed_ids),
        record=record,
    )


def add_room(
    scene: Scene,
    room: Room,
    *,
    actor: str = "agent",
    needs_second_floor: bool = False,
    soil_unknown: bool = False,
    walls: tuple[Wall, ...] = (),
    openings: tuple[Opening, ...] = (),
) -> tuple[Scene, OpResult]:
    """Add a room polygon plus its enclosing ``walls`` and connecting ``openings``.

    The executor derives the walls deterministically (server/agent/room_walls.py);
    they are recorded in the op args so replay reproduces them."""
    if (err := _check_actor(actor)) is not None:
        return _fail(scene, err)
    if any(r.id == room.id for r in scene.rooms):
        return _fail(scene, f"room id {room.id!r} already exists")
    try:
        valid = Room.model_validate(room.model_dump())
    except ValidationError as exc:
        return _fail(scene, f"invalid room: {exc.errors()[0]['msg']}")
    taken = {w.id for w in scene.walls}
    if len({w.id for w in walls}) != len(walls) or any(w.id in taken for w in walls):
        return _fail(scene, "wall id clash while adding room walls")
    candidate = scene.model_copy(
        update={
            "rooms": [*scene.rooms, valid],
            "walls": [*scene.walls, *walls],
            "openings": [*scene.openings, *openings],
        }
    )
    args: dict = {"room": valid.model_dump()}
    if walls:
        args["walls"] = [w.model_dump() for w in walls]
    if openings:
        args["openings"] = [o.model_dump() for o in openings]
    # Recorded only when set so replay reproduces the flags and older
    # history records stay byte-identical.
    if needs_second_floor:
        args["needs_second_floor"] = True
    if soil_unknown:
        args["soil_unknown"] = True
    ctx = ValidationContext(
        needs_second_floor=needs_second_floor, soil_unknown=soil_unknown
    )
    changed = [valid.id, *(w.id for w in walls), *(o.id for o in openings)]
    return _apply(scene, "add_room", args, candidate, changed, actor, ctx)


def add_wall(
    scene: Scene, wall: Wall, *, actor: str = "agent"
) -> tuple[Scene, OpResult]:
    if (err := _check_actor(actor)) is not None:
        return _fail(scene, err)
    if any(w.id == wall.id for w in scene.walls):
        return _fail(scene, f"wall id {wall.id!r} already exists")
    try:
        valid = Wall.model_validate(wall.model_dump())
    except ValidationError as exc:
        return _fail(scene, f"invalid wall: {exc.errors()[0]['msg']}")
    candidate = scene.model_copy(update={"walls": [*scene.walls, valid]})
    return _apply(
        scene, "add_wall", {"wall": valid.model_dump()}, candidate, [valid.id], actor
    )


def remove_wall(
    scene: Scene, wall_id: str, *, actor: str = "agent"
) -> tuple[Scene, OpResult]:
    wall = next((w for w in scene.walls if w.id == wall_id), None)
    if wall is None:
        return _fail(scene, f"unknown wall {wall_id!r}")
    if (err := _check_actor(actor)) is not None:
        return _fail(scene, err)
    removed_openings = [o.id for o in scene.openings if o.wall_id == wall_id]
    candidate = scene.model_copy(
        update={
            "walls": [w for w in scene.walls if w.id != wall_id],
            "openings": [o for o in scene.openings if o.wall_id != wall_id],
        }
    )
    ctx = ValidationContext(removed_load_bearing_wall=wall.load_bearing)
    return _apply(
        scene,
        "remove_wall",
        {"wall_id": wall_id},
        candidate,
        [wall_id, *removed_openings],
        actor,
        ctx,
    )


def add_opening(
    scene: Scene, opening: Opening, *, actor: str = "agent"
) -> tuple[Scene, OpResult]:
    if (err := _check_actor(actor)) is not None:
        return _fail(scene, err)
    if any(o.id == opening.id for o in scene.openings):
        return _fail(scene, f"opening id {opening.id!r} already exists")
    if not any(w.id == opening.wall_id for w in scene.walls):
        return _fail(scene, f"unknown wall {opening.wall_id!r}")
    try:
        valid = Opening.model_validate(opening.model_dump())
    except ValidationError as exc:
        return _fail(scene, f"invalid opening: {exc.errors()[0]['msg']}")
    candidate = scene.model_copy(update={"openings": [*scene.openings, valid]})
    return _apply(
        scene,
        "add_opening",
        {"opening": valid.model_dump()},
        candidate,
        [valid.id],
        actor,
    )


def move_opening(
    scene: Scene, opening_id: str, new_offset_m: float, *, actor: str = "agent"
) -> tuple[Scene, OpResult]:
    if (err := _check_actor(actor)) is not None:
        return _fail(scene, err)
    idx = next((i for i, o in enumerate(scene.openings) if o.id == opening_id), None)
    if idx is None:
        return _fail(scene, f"unknown opening {opening_id!r}")
    if new_offset_m < 0:
        return _fail(scene, f"offset {new_offset_m:.2f} m must be >= 0")
    moved = scene.openings[idx].model_copy(update={"offset_m": new_offset_m})
    candidate = scene.model_copy(
        update={"openings": [*scene.openings[:idx], moved, *scene.openings[idx + 1 :]]}
    )
    return _apply(
        scene,
        "move_opening",
        {"opening_id": opening_id, "new_offset_m": new_offset_m},
        candidate,
        [opening_id],
        actor,
    )


EDIT_OPS = (
    "resize_room",
    "set_wall_length",
    "move_wall",
    "set_opening_size",
    "split_room",
    "rename_room",
)


def edit_geometry(
    scene: Scene,
    label: str,
    *,
    walls: tuple[Wall, ...],
    openings: tuple[Opening, ...],
    rooms: tuple[Room, ...],
    actor: str = "agent",
) -> tuple[Scene, OpResult]:
    """Replace walls/openings/rooms with a deterministically computed result.

    One pure op behind every edit tool (resize_room, set_wall_length, move_wall,
    set_opening_size, split_room, rename_room): the executor computes the new
    geometry in code, this validates it exactly like any other op and records
    the full result in the args so replay reproduces it.
    """
    if (err := _check_actor(actor)) is not None:
        return _fail(scene, err)
    if label not in EDIT_OPS:
        return _fail(scene, f"unknown edit op {label!r}")
    try:
        new_walls = [Wall.model_validate(w.model_dump()) for w in walls]
        new_openings = [Opening.model_validate(o.model_dump()) for o in openings]
        new_rooms = [Room.model_validate(r.model_dump()) for r in rooms]
    except ValidationError as exc:
        return _fail(scene, f"invalid geometry: {exc.errors()[0]['msg']}")
    candidate = scene.model_copy(
        update={"walls": new_walls, "openings": new_openings, "rooms": new_rooms}
    )
    before = {
        "w": {w.id: w for w in scene.walls},
        "o": {o.id: o for o in scene.openings},
        "r": {r.id: r for r in scene.rooms},
    }
    changed = [w.id for w in new_walls if before["w"].get(w.id) != w]
    changed += [o.id for o in new_openings if before["o"].get(o.id) != o]
    changed += [r.id for r in new_rooms if before["r"].get(r.id) != r]
    args = {
        "walls": [w.model_dump() for w in new_walls],
        "openings": [o.model_dump() for o in new_openings],
        "rooms": [r.model_dump() for r in new_rooms],
    }
    return _apply(scene, label, args, candidate, changed, actor)


def _replay_edit(label: str):
    return lambda s, a: edit_geometry(
        s,
        label,
        walls=tuple(Wall.model_validate(w) for w in a["walls"]),
        openings=tuple(Opening.model_validate(o) for o in a["openings"]),
        rooms=tuple(Room.model_validate(r) for r in a["rooms"]),
        actor=a.get("_actor", "agent"),
    )


DESIGN_OPS = (
    "place_furniture",
    "move_item",
    "rotate_item",
    "remove_item",
    "set_surface_material",
)


def edit_design(
    scene: Scene,
    label: str,
    *,
    furniture: tuple[Furniture, ...],
    surfaces: tuple[Surface, ...],
    actor: str = "agent",
) -> tuple[Scene, OpResult]:
    """Replace furniture/surfaces with a result computed in code (Design stage).

    Validated like any op (furniture inside rooms, no overlaps, rules); the full
    result is recorded so replay reproduces it."""
    if (err := _check_actor(actor)) is not None:
        return _fail(scene, err)
    if label not in DESIGN_OPS:
        return _fail(scene, f"unknown design op {label!r}")
    try:
        new_f = [Furniture.model_validate(f.model_dump()) for f in furniture]
        new_s = [Surface.model_validate(x.model_dump()) for x in surfaces]
    except ValidationError as exc:
        return _fail(scene, f"invalid design data: {exc.errors()[0]['msg']}")
    candidate = scene.model_copy(update={"furniture": new_f, "surfaces": new_s})
    old = {f.id: f for f in scene.furniture} | {x.id: x for x in scene.surfaces}
    changed = [x.id for x in (*new_f, *new_s) if old.get(x.id) != x]
    changed += [i for i in old if i not in {x.id for x in (*new_f, *new_s)}]
    args = {"furniture": [f.model_dump() for f in new_f], "surfaces": [x.model_dump() for x in new_s]}
    new_scene, result = _apply(scene, label, args, candidate, changed, actor)
    if result.ok:
        from server.scene.fit import furniture_fit_warnings

        result = replace(result, warnings=(*result.warnings, *furniture_fit_warnings(new_scene)))
    return new_scene, result


_OPS = {
    **{label: _replay_edit(label) for label in EDIT_OPS},
    **{
        label: (lambda lab: lambda s, a: edit_design(
            s, lab,
            furniture=tuple(Furniture.model_validate(f) for f in a["furniture"]),
            surfaces=tuple(Surface.model_validate(x) for x in a["surfaces"]),
            actor=a.get("_actor", "agent"),
        ))(label)
        for label in DESIGN_OPS
    },
    "add_room": lambda s, a: add_room(
        s,
        Room.model_validate(a["room"]),
        actor=a.get("_actor", "agent"),
        needs_second_floor=a.get("needs_second_floor", False),
        soil_unknown=a.get("soil_unknown", False),
        walls=tuple(Wall.model_validate(w) for w in a.get("walls", ())),
        openings=tuple(Opening.model_validate(o) for o in a.get("openings", ())),
    ),
    "add_wall": lambda s, a: add_wall(s, Wall.model_validate(a["wall"]), actor=a.get("_actor", "agent")),
    "remove_wall": lambda s, a: remove_wall(s, a["wall_id"], actor=a.get("_actor", "agent")),
    "add_opening": lambda s, a: add_opening(
        s, Opening.model_validate(a["opening"]), actor=a.get("_actor", "agent")
    ),
    "move_opening": lambda s, a: move_opening(
        s, a["opening_id"], a["new_offset_m"], actor=a.get("_actor", "agent")
    ),
}


def replay(base: Scene, history: list[OpRecord]) -> Scene:
    """Rebuild a Scene by applying history records on top of base. Pure."""
    scene = base
    for record in history:
        fn = _OPS.get(record.op)
        if fn is None:
            raise ValueError(f"unknown op {record.op!r} in history")
        args = dict(record.args)
        args["_actor"] = record.actor
        scene, result = fn(scene, args)
        if not result.ok:
            raise ValueError(
                f"history replay failed at {record.op} "
                f"(v{record.before_version}->v{record.after_version}): "
                f"{'; '.join(result.errors)}"
            )
    return scene


def undo(base: Scene, history: list[OpRecord]) -> tuple[Scene, list[OpRecord]]:
    """Undo = replay up to N-1. Returns (scene, trimmed history). Pure."""
    if not history:
        return base, []
    trimmed = list(history[:-1])
    return replay(base, trimmed), trimmed
