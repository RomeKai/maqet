"""Ops (ADR-002): pure Scene -> Scene functions for the Reform stage.

Each op validates its input and the resulting Scene, returns
``(new_scene, OpResult)`` and bumps ``version`` on success. On failure the
input scene is returned unchanged with ``ok=False``.

History: every successful op produces an OpRecord
({op, args, before_version, after_version, actor}). Undo = replay up to N-1
(see replay()/undo() below; variants.py in later phases builds on replay).
"""

from __future__ import annotations

from dataclasses import dataclass

from pydantic import ValidationError

from server.scene.models import Opening, Room, Scene, Wall
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


def _apply(
    scene: Scene,
    op: str,
    args: dict,
    candidate: Scene,
    changed_ids: list[str],
    actor: str,
    ctx: ValidationContext | None = None,
) -> tuple[Scene, OpResult]:
    report = validate_scene(candidate, ctx)
    if report.errors:
        return scene, OpResult(ok=False, errors=report.errors)
    new_scene = candidate.model_copy(update={"version": scene.version + 1})
    record = OpRecord(
        op=op,
        args=args,
        before_version=scene.version,
        after_version=new_scene.version,
        actor=actor,
    )
    return new_scene, OpResult(
        ok=True,
        warnings=report.warnings,
        flags=report.flags,
        changed_ids=tuple(changed_ids),
        record=record,
    )


def add_room(
    scene: Scene, room: Room, *, actor: str = "agent"
) -> tuple[Scene, OpResult]:
    """Add a room polygon (rooms are derived from walls after intake; kept for naming/targeting)."""
    if (err := _check_actor(actor)) is not None:
        return _fail(scene, err)
    if any(r.id == room.id for r in scene.rooms):
        return _fail(scene, f"room id {room.id!r} already exists")
    try:
        valid = Room.model_validate(room.model_dump())
    except ValidationError as exc:
        return _fail(scene, f"invalid room: {exc.errors()[0]['msg']}")
    candidate = scene.model_copy(update={"rooms": [*scene.rooms, valid]})
    return _apply(
        scene,
        "add_room",
        {"room": valid.model_dump()},
        candidate,
        [valid.id],
        actor,
    )


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


_OPS = {
    "add_room": lambda s, a: add_room(s, Room.model_validate(a["room"]), actor=a.get("_actor", "agent")),
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
