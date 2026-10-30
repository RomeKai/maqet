"""Stage-scoped tool executor (reform-agent skill). No model calls.

`execute(scene, history, stage, tool, args)` is the only entry point; tests
call it directly. Order: unknown stage -> unknown tool -> out-of-stage
refusal -> anchor resolution -> exactly one pure op in server/scene/ops.py,
validated by server/scene/rules.py. On success the OpRecord (plus a
namespaced `_undo` snapshot) is appended to `history`; on failure nothing is
touched. `undo` inverts the last record purely and is global across stages.
Ops missing from ops.py report `op.not_implemented` — never invented here.
"""

from __future__ import annotations

import json
import math
from dataclasses import replace
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field, ValidationError

from server.agent import stages as stage_table
from server.agent import tools as tool_contracts
from server.agent import edit_tools
from server.agent.room_walls import enclosing_walls
from server.scene import ops
from server.scene.models import Opening, Room, Scene, Wall
from server.scene.validation import rooms_overlap_m2
from server.scene import geom
from server.scene.rules import (
    DOOR_WIDTH_M,
    PRO_FLAG_SECOND_FLOOR,
    WINDOW_HEIGHT_M,
    WINDOW_SILL_M,
    PRO_FLAG_SOIL,
)

_DEFAULT_WINDOW_WIDTH_M = 1.20
_DEFAULT_DOOR_HEIGHT_M = 2.10
_DEFAULT_WINDOW_HEIGHT_M = WINDOW_HEIGHT_M


class ToolError(BaseModel):
    code: str
    message: str


class ToolResult(BaseModel):
    ok: bool
    errors: list[ToolError] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    flags: list[str] = Field(default_factory=list)
    changed_ids: list[str] = Field(default_factory=list)
    version: int = 0
    data: dict[str, Any] | None = None


def _fail(scene: Scene, code: str, message: str) -> tuple[Scene, ToolResult]:
    return scene, ToolResult(
        ok=False, errors=[ToolError(code=code, message=message)], version=scene.version
    )


def _op_fail(scene: Scene, result: ops.OpResult) -> tuple[Scene, ToolResult]:
    # Finding is a str subclass carrying .code; plain-string op errors map to op.invalid.
    return scene, ToolResult(
        ok=False,
        errors=[
            ToolError(code=getattr(e, "code", "op.invalid"), message=str(e))
            for e in result.errors
        ],
        version=scene.version,
    )


def _unique_id(prefix: str, taken: list[str]) -> str:
    owned = set(taken)
    n = len(owned) + 1
    while f"{prefix}{n}" in owned:
        n += 1
    return f"{prefix}{n}"


def _match_id(items: list, attr: str, ref: str) -> list:
    want = ref.strip().casefold()
    return [it for it in items if getattr(it, attr).casefold() == want]


def _rooms_named(scene: Scene, ref: str) -> list[Room]:
    want = ref.strip().casefold()
    return [
        r for r in scene.rooms if r.name.casefold() == want or r.id.casefold() == want
    ]


# --- Reform handlers: exactly one op each ---------------------------------------


def _free_side(
    scene: Scene, anchor: Room, size_m: tuple[float, float] | list[float], level: int
) -> list[tuple[float, float]] | None:
    """First side of the anchor's bounding box (E, S, W, N) where a w x h
    rectangle overlaps no existing room on ``level``, flush with the anchor's
    lower/left corner on that side; None when all four are taken."""
    xs = [p[0] for p in anchor.polygon]
    ys = [p[1] for p in anchor.polygon]
    minx, maxx, miny, maxy = min(xs), max(xs), min(ys), max(ys)
    w, h = float(size_m[0]), float(size_m[1])
    origins = (
        (maxx, miny),  # east
        (minx, miny - h),  # south
        (minx - w, miny),  # west
        (minx, maxy),  # north
    )
    for x0, y0 in origins:
        poly = [(x0, y0), (x0 + w, y0), (x0 + w, y0 + h), (x0, y0 + h)]
        probe = Room(id="_probe", name="_probe", polygon=poly, level=level)
        if all(rooms_overlap_m2(probe, r) == 0.0 for r in scene.rooms):
            return poly
    return None


def _handle_add_room(
    scene: Scene, history: list, a: tool_contracts.AddRoomInput
) -> tuple[Scene, ToolResult]:
    if a.polygon is not None:
        poly = [(float(x), float(y)) for x, y in a.polygon]
    else:
        ref = a.next_to or a.room
        if ref is None and a.selected is not None:
            if a.selected.kind.casefold() != "room":
                return _fail(
                    scene,
                    "anchor.unknown",
                    f"selected {a.selected.kind} {a.selected.id!r} is not a room; "
                    "say which room; Scene unchanged",
                )
            ref = a.selected.id
        if ref is not None:
            matches = _rooms_named(scene, ref)
            if not matches:
                return _fail(scene, "anchor.unknown", f"no room matches {ref!r}; Scene unchanged")
            if len(matches) > 1:
                return _fail(
                    scene,
                    "anchor.ambiguous",
                    f"{len(matches)} rooms match {ref!r}; say which one; Scene unchanged",
                )
            free = _free_side(scene, matches[0], a.size_m, a.level)
            if free is None:
                return _fail(
                    scene,
                    "anchor.no_free_side",
                    f"every side of {ref!r} is taken by another room; "
                    "say where it should go; Scene unchanged",
                )
            poly = free
        else:
            w, h = a.size_m
            poly = [(0.0, 0.0), (w, 0.0), (w, h), (0.0, h)]
    rid = a.room_id or _unique_id("r", [r.id for r in scene.rooms])
    room = Room(
        id=rid, name=a.name or a.function, polygon=poly, function=a.function, level=a.level
    )
    # Upper levels have no walls of their own (models.Room.level).
    new_walls, door, door_warnings = (
        enclosing_walls(scene, poly) if a.level == 1 else ([], None, [])
    )
    new_scene, res = ops.add_room(
        scene,
        room,
        needs_second_floor=a.level > 1,
        soil_unknown=a.foundation_unknown_soil,
        walls=tuple(new_walls),
        openings=(door,) if door is not None else (),
    )
    if not res.ok:
        return _op_fail(scene, res)
    flags = [str(f) for f in res.flags]
    if a.level > 1 and PRO_FLAG_SECOND_FLOOR not in flags:
        flags.append(PRO_FLAG_SECOND_FLOOR)
    if a.foundation_unknown_soil and PRO_FLAG_SOIL not in flags:
        flags.append(PRO_FLAG_SOIL)
    history.append(
        replace(
            res.record,
            args={
                **res.record.args,
                "_undo": {
                    "kind": "room",
                    "added_ids": [rid],
                    "added_wall_ids": [w.id for w in new_walls],
                    "added_opening_ids": [door.id] if door is not None else [],
                },
            },
        )
    )
    return new_scene, ToolResult(
        ok=True,
        warnings=[*door_warnings, *(str(w) for w in res.warnings)],
        flags=flags,
        changed_ids=list(res.changed_ids),
        version=new_scene.version,
    )


def _handle_add_wall(
    scene: Scene, history: list, a: tool_contracts.AddWallInput
) -> tuple[Scene, ToolResult]:
    wid = a.wall_id or _unique_id("w", [w.id for w in scene.walls])
    wall = Wall(
        id=wid,
        a=(float(a.a[0]), float(a.a[1])),
        b=(float(a.b[0]), float(a.b[1])),
        thickness_m=a.thickness_m,
        kind=a.kind,
    )
    new_scene, res = ops.add_wall(scene, wall)
    if not res.ok:
        return _op_fail(scene, res)
    history.append(
        replace(
            res.record,
            args={**res.record.args, "_undo": {"kind": "wall", "added_ids": [wid]}},
        )
    )
    return new_scene, ToolResult(
        ok=True,
        warnings=[str(w) for w in res.warnings],
        flags=[str(f) for f in res.flags],
        changed_ids=[wid],
        version=new_scene.version,
    )


def _resolve_wall_id(scene: Scene, a: tool_contracts.RemoveWallInput) -> str | None:
    """Explicit id (case-insensitive) -> selected -> between/and fragment match."""
    ref = a.wall_id or a.wall
    if ref is not None:
        return _match_id(scene.walls, "id", ref)[0].id if _match_id(scene.walls, "id", ref) else None
    if a.selected is not None and a.selected.kind.casefold() == "wall":
        found = _match_id(scene.walls, "id", a.selected.id)
        return found[0].id if found else None
    if a.between is not None and a.and_ is not None:
        frags = [a.between.strip().casefold(), a.and_.strip().casefold()]
        hits = [w for w in scene.walls if all(f in w.id.casefold() for f in frags)]
        if len(hits) == 1:
            return hits[0].id
        return None  # 0 hits -> unknown, 2+ -> ambiguous; caller distinguishes
    return None


def _handle_remove_wall(
    scene: Scene, history: list, a: tool_contracts.RemoveWallInput
) -> tuple[Scene, ToolResult]:
    wid = _resolve_wall_id(scene, a)
    if wid is None:
        if a.between is not None and a.and_ is not None:
            frags = [a.between.strip().casefold(), a.and_.strip().casefold()]
            n = sum(1 for w in scene.walls if all(f in w.id.casefold() for f in frags))
            if n > 1:
                return _fail(
                    scene,
                    "anchor.ambiguous",
                    f"{n} walls sit between {a.between!r} and {a.and_!r}; say which one; Scene unchanged",
                )
        ref = a.wall_id or a.wall or a.between or (a.selected.id if a.selected else "?")
        return _fail(scene, "anchor.unknown", f"no wall matches {ref!r}; Scene unchanged")
    idx = next(i for i, w in enumerate(scene.walls) if w.id == wid)
    wall = scene.walls[idx]
    doomed = [(i, o) for i, o in enumerate(scene.openings) if o.wall_id == wid]
    new_scene, res = ops.remove_wall(scene, wid)
    if not res.ok:
        return _op_fail(scene, res)
    history.append(
        replace(
            res.record,
            args={
                **res.record.args,
                "_undo": {
                    "wall": wall.model_dump(),
                    "wall_index": idx,
                    "openings": [o.model_dump() for _, o in doomed],
                    "opening_indices": [i for i, _ in doomed],
                },
            },
        )
    )
    return new_scene, ToolResult(
        ok=True,
        warnings=[str(w) for w in res.warnings],
        flags=[str(f) for f in res.flags],  # load-bearing flag arrives via validation
        changed_ids=[wid, *[o.id for _, o in doomed]],
        version=new_scene.version,
    )


def _wall_length(wall: Wall) -> float:
    return math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1])


def _handle_add_opening(
    scene: Scene, history: list, a: tool_contracts.AddOpeningInput
) -> tuple[Scene, ToolResult]:
    ref = a.wall_id or a.wall
    if ref is None and a.selected is not None and a.selected.kind.casefold() == "wall":
        ref = a.selected.id
    found = _match_id(scene.walls, "id", ref) if ref else []
    if not found:
        return _fail(scene, "anchor.unknown", f"no wall matches {ref!r}; Scene unchanged")
    wall = found[0]
    length = _wall_length(wall)
    width = a.width_m if a.width_m is not None else (
        DOOR_WIDTH_M if a.kind == "door" else _DEFAULT_WINDOW_WIDTH_M
    )
    height = a.height_m if a.height_m is not None else (
        _DEFAULT_DOOR_HEIGHT_M if a.kind == "door" else _DEFAULT_WINDOW_HEIGHT_M
    )
    if a.offset_m is not None:
        offset = a.offset_m
    else:
        offset = a.at_ratio * max(length - width, 0.0)
    # Avoid overlapping existing openings on the same wall (validator
    # rejects geometric overlap; placement must respect it).
    existing = sorted(
        [o for o in scene.openings if o.wall_id == wall.id],
        key=lambda o: o.offset_m,
    )
    if existing:
        def _overlaps(off: float) -> bool:
            return any(
                not (geom.approx_le(off + width, o.offset_m) or geom.approx_ge(off, o.offset_m + o.width_m))
                for o in existing
            )
        if _overlaps(offset):
            gaps: list[tuple[float, float]] = []
            gaps.append((0.0, existing[0].offset_m))
            for i in range(len(existing) - 1):
                gaps.append((existing[i].offset_m + existing[i].width_m, existing[i + 1].offset_m))
            gaps.append((existing[-1].offset_m + existing[-1].width_m, length))
            if a.offset_m is None:
                # Default placement: pick largest gap that fits.
                best = None
                best_len = 0.0
                for g0, g1 in gaps:
                    glen = g1 - g0
                    if geom.approx_ge(glen, width) and glen > best_len:
                        best = (g0, g1)
                        best_len = glen
                if best is not None:
                    offset = best[0] + (best[1] - best[0] - width) / 2.0
            else:
                # Explicit offset overlaps: nudge to nearest gap that fits.
                candidates: list[tuple[float, float]] = []
                for g0, g1 in gaps:
                    if geom.approx_ge(g1 - g0, width):
                        clamped = max(g0, min(offset, g1 - width))
                        dist = abs(clamped - offset)
                        candidates.append((dist, clamped))
                if candidates:
                    candidates.sort()
                    offset = candidates[0][1]
            # else: no gap fits — keep computed offset and let validator decide
    oid = a.opening_id or _unique_id("o", [o.id for o in scene.openings])
    opening = Opening(
        id=oid, wall_id=wall.id, kind=a.kind,
        offset_m=offset, width_m=width, height_m=height,
        sill_m=a.sill_m if a.sill_m is not None else (WINDOW_SILL_M if a.kind == "window" else None),
    )
    new_scene, res = ops.add_opening(scene, opening)
    if not res.ok:
        return _op_fail(scene, res)
    history.append(
        replace(
            res.record,
            args={**res.record.args, "_undo": {"kind": "opening", "added_ids": [oid]}},
        )
    )
    return new_scene, ToolResult(
        ok=True,
        warnings=[str(w) for w in res.warnings],
        flags=[str(f) for f in res.flags],
        changed_ids=[oid],
        version=new_scene.version,
    )


def _handle_move_opening(
    scene: Scene, history: list, a: tool_contracts.MoveOpeningInput
) -> tuple[Scene, ToolResult]:
    ref = a.opening_id or a.opening
    if (
        ref is None
        and a.selected is not None
        and a.selected.kind.casefold() == "opening"
    ):
        ref = a.selected.id
    found = _match_id(scene.openings, "id", ref) if ref else []
    if not found:
        return _fail(scene, "anchor.unknown", f"no opening matches {ref!r}; Scene unchanged")
    opening = found[0]
    wall = next((w for w in scene.walls if w.id == opening.wall_id), None)
    if wall is None:  # unreachable post-validation; guard anyway
        return _fail(scene, "op.invalid", f"opening {opening.id!r} has no wall; Scene unchanged")
    if a.new_offset_m is not None:
        target = a.new_offset_m
    else:
        ratio = a.at_ratio if a.at_ratio is not None else 0.5
        target = ratio * max(_wall_length(wall) - opening.width_m, 0.0)
    new_scene, res = ops.move_opening(scene, opening.id, target)
    if not res.ok:
        return _op_fail(scene, res)
    history.append(
        replace(
            res.record,
            args={**res.record.args, "_undo": {"previous_offset_m": opening.offset_m}},
        )
    )
    return new_scene, ToolResult(
        ok=True,
        warnings=[str(w) for w in res.warnings],
        flags=[str(f) for f in res.flags],
        changed_ids=[opening.id],
        version=new_scene.version,
    )


def _handle_undo(scene: Scene, history: list, args: dict) -> tuple[Scene, ToolResult]:
    if not history:
        return _fail(scene, "history.empty", "nothing to undo; history is empty")
    record = history.pop()
    raw_args = record.args if isinstance(record.args, dict) else {}
    snap = raw_args.get("_undo", {})
    if not isinstance(snap, dict):
        snap = {}
    if record.op in ("add_room", "add_wall", "add_opening"):
        kind = snap.get(
            "kind",
            {"add_room": "room", "add_wall": "wall", "add_opening": "opening"}[record.op],
        )
        dropped = set(snap.get("added_ids", []))
        if not dropped:  # foreign record without our snapshot: never silently version-1
            history.append(record)
            return _fail(
                scene,
                "history.corrupt",
                f"cannot undo {record.op!r}: missing snapshot; history unchanged",
            )
        if kind == "room":
            dead_walls = set(snap.get("added_wall_ids", []))
            dead_openings = set(snap.get("added_opening_ids", []))
            rebuilt = scene.model_copy(
                update={
                    "rooms": [r for r in scene.rooms if r.id not in dropped],
                    "walls": [w for w in scene.walls if w.id not in dead_walls],
                    "openings": [o for o in scene.openings if o.id not in dead_openings],
                }
            )
            dropped = dropped | dead_walls | dead_openings
        elif kind == "wall":
            rebuilt = scene.model_copy(update={"walls": [w for w in scene.walls if w.id not in dropped]})
        else:
            rebuilt = scene.model_copy(
                update={"openings": [o for o in scene.openings if o.id not in dropped]}
            )
        changed = sorted(dropped)
    elif record.op in ops.EDIT_OPS:
        if snap.get("kind") != "geometry":
            history.append(record)
            return _fail(
                scene,
                "history.corrupt",
                f"cannot undo {record.op!r}: missing snapshot; history unchanged",
            )
        rebuilt = scene.model_copy(
            update={
                "walls": [Wall.model_validate(w) for w in snap["walls"]],
                "openings": [Opening.model_validate(o) for o in snap["openings"]],
                "rooms": [Room.model_validate(r) for r in snap["rooms"]],
            }
        )
        changed = [record.op]
    elif record.op == "remove_wall":
        if not all(k in snap for k in ("wall", "wall_index", "openings", "opening_indices")):
            history.append(record)
            return _fail(
                scene,
                "history.corrupt",
                "cannot undo 'remove_wall': missing snapshot; history unchanged",
            )
        wall = Wall.model_validate(snap["wall"])
        walls = list(scene.walls)
        walls.insert(min(snap["wall_index"], len(walls)), wall)
        openings = list(scene.openings)
        pairs = sorted(zip(snap["opening_indices"], snap["openings"]), key=lambda p: p[0])
        for i, dump in pairs:
            openings.insert(min(i, len(openings)), Opening.model_validate(dump))
        rebuilt = scene.model_copy(update={"walls": walls, "openings": openings})
        changed = [wall.id, *[Opening.model_validate(d).id for d in snap["openings"]]]
    elif record.op == "move_opening":
        if "previous_offset_m" not in snap or not isinstance(raw_args.get("opening_id"), str):
            history.append(record)
            return _fail(
                scene,
                "history.corrupt",
                "cannot undo 'move_opening': missing snapshot; history unchanged",
            )
        oid = raw_args["opening_id"]
        if not any(o.id == oid for o in scene.openings):
            history.append(record)
            return _fail(
                scene,
                "history.corrupt",
                f"cannot undo 'move_opening': opening {oid!r} is gone; history unchanged",
            )
        rebuilt = scene.model_copy(
            update={
                "openings": [
                    o.model_copy(update={"offset_m": snap["previous_offset_m"]})
                    if o.id == oid
                    else o
                    for o in scene.openings
                ]
            }
        )
        changed = [oid]
    else:  # pragma: no cover - histories only ever hold the five ops above
        history.append(record)
        return _fail(scene, "history.unknown_op", f"cannot undo unknown op {record.op!r}")
    rebuilt = rebuilt.model_copy(update={"version": max(scene.version - 1, 0)})
    return rebuilt, ToolResult(ok=True, changed_ids=changed, version=rebuilt.version)


# --- Design read-only + stubs ----------------------------------------------------


_CATALOG_CANDIDATES = (
    Path("assets/catalog.json"),
    Path(__file__).resolve().parents[2] / "assets" / "catalog.json",
)


def _catalog_items(data: object) -> list:
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        found: list = []
        for key in ("items", "furniture", "materials"):
            if isinstance(data.get(key), list):
                found.extend(data[key])
        return found
    return []


def _handle_list_catalog(scene: Scene, args: dict) -> tuple[Scene, ToolResult]:
    items: list | None = None
    for candidate in _CATALOG_CANDIDATES:
        try:
            if candidate.is_file():
                items = _catalog_items(json.loads(candidate.read_text(encoding="utf-8")))
                break
        except (OSError, ValueError):
            continue  # corrupt/unreadable file degrades like a missing one
    if items is None:
        return scene, ToolResult(
            ok=True,
            warnings=["catalog.missing: assets/catalog.json not found or unreadable; empty catalog"],
            version=scene.version,
            data={"items": []},
        )
    query = args.get("query")
    if isinstance(query, str) and query.strip():
        needle = query.strip().casefold()
        items = [it for it in items if needle in json.dumps(it).casefold()]
    return scene, ToolResult(ok=True, version=scene.version, data={"items": items})


_MISSING_OP = {
    "place_furniture": "place_furniture",
    "move_item": "move_item",
    "rotate_item": "rotate_item",
    "remove_item": "remove_item",
    "create_variant": "create_variant",
    "render_view": "render_view",
}

def _make_edit_handler(tool: str):
    def handler(scene: Scene, history: list, a) -> tuple[Scene, ToolResult]:
        try:
            new_scene, res, snapshot = edit_tools.run_edit(scene, tool, a)
        except edit_tools.EditError as exc:
            return _fail(scene, exc.code, exc.message)
        if not res.ok:
            return _op_fail(scene, res)
        edit_tools.attach_history(history, res.record, snapshot)
        return new_scene, ToolResult(
            ok=True,
            warnings=[str(w) for w in res.warnings],
            flags=[str(f) for f in res.flags],
            changed_ids=list(res.changed_ids),
            version=new_scene.version,
        )

    return handler


_HANDLERS = {
    **{tool: _make_edit_handler(tool) for tool in edit_tools.COMPUTE},
    "add_room": _handle_add_room,
    "add_wall": _handle_add_wall,
    "remove_wall": _handle_remove_wall,
    "add_opening": _handle_add_opening,
    "move_opening": _handle_move_opening,
}


def execute(
    scene: Scene, history: list, stage: str, tool: str, args: dict | None = None
) -> tuple[Scene, ToolResult]:
    """Run one stage-scoped tool call. Pure except appending to `history` on success."""
    if args is None:
        raw: dict = {}
    elif isinstance(args, dict):
        raw = dict(args)
    else:
        return _fail(
            scene, "tool.invalid_args", f"args must be an object, got {type(args).__name__}"
        )
    if not isinstance(stage, str) or stage not in stage_table.STAGES:
        return _fail(scene, "stage.unknown_stage", f"unknown stage {stage!r}")
    if not isinstance(tool, str):
        return _fail(scene, "tool.unknown_tool", f"unknown tool {tool!r}")
    model_cls = tool_contracts.TOOL_MODELS.get(tool)
    if model_cls is None:
        return _fail(scene, "tool.unknown_tool", f"unknown tool {tool!r}")
    allowed = stage_table.allowed_tools(stage)
    if tool not in allowed:
        return _fail(
            scene,
            "stage.tool_not_allowed",
            f"tool {tool!r} not allowed in stage {stage!r}; allowed: {', '.join(allowed)}",
        )
    if tool == "undo":
        return _handle_undo(scene, history, raw)
    if tool == "list_catalog":
        return _handle_list_catalog(scene, raw)
    if tool in _MISSING_OP:
        missing = _MISSING_OP[tool]
        return _fail(
            scene,
            "op.not_implemented",
            f"op {missing!r} is not implemented in server/scene/ops.py yet; "
            "Scene and history unchanged",
        )
    try:
        parsed = model_cls(**raw)
    except ValidationError as exc:
        details = "; ".join(
            f"{'.'.join(str(p) for p in e['loc'])}: {e['msg']}" for e in exc.errors()
        )
        return _fail(scene, "tool.invalid_args", f"invalid args for {tool!r}: {details}")
    return _HANDLERS[tool](scene, history, parsed)


__all__ = ["ToolError", "ToolResult", "execute"]
