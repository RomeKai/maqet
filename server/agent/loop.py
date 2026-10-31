"""Reform agent tool-calling loop (ADR-002, ADR-014).

`run_turn` is the only entry point. It offers the current stage's tools
(`server/agent/stages.py`) as function tools, executes every model tool
call through `server/agent/executor.py`'s `execute()`, feeds each
`ToolResult` back as a tool output, and stops at the first final text
reply or after `MAX_TOOL_ROUNDS` tool rounds (fixed bilingual
"too many steps" reply, worded so it never implies structural safety).

Stable prefix (system prompt + tool schemas) first, user text last, so
prompt caching hits; every call carries a stable `prompt_cache_key` and
`tag="reform"`. Within a turn, `previous_response_id` threads reasoning
across tool rounds; turns are stateless (no cross-turn id passes through
the fixed `run_turn` signature).

Production passes `mme.client()` as `client`; tests pass a scripted fake
implementing the same `respond / output_text / tool_calls` surface (kept
as a `Protocol` so both shapes fit — `mme.client` documents these as
instance methods).
"""

from __future__ import annotations

import copy
import logging
import math
import queue
import re
import threading
import time
from dataclasses import asdict, is_dataclass
from pathlib import Path
from typing import Any, Protocol

from pydantic import BaseModel, Field

from server.agent import stages as stage_table
from server.agent.wall_labels import wall_label
from server.agent import tools as tool_contracts
from server.agent.executor import execute
from server.scene.models import Scene

logger = logging.getLogger(__name__)

# Each model call at tier "max" reasons for ~5k tokens (tens of seconds, and
# mme.client waits up to 300 s per call), so a turn is bounded twice: by rounds
# and by a wall-clock budget, and returns a partial reply instead of letting the
# client time out (bug V).
MAX_TOOL_ROUNDS = 4
TURN_BUDGET_S = 120.0
PROMPT_CACHE_KEY = "reform-v1"
TAG = "reform"
TIER = "max"

_PROMPT_PATH = Path(__file__).resolve().parent / "prompts" / "reform_v1.md"


def _load_instructions() -> str:
    return _PROMPT_PATH.read_text(encoding="utf-8")


_INSTRUCTIONS = _load_instructions()

TOOL_DESCRIPTIONS: dict[str, str] = {
    "add_room": "Add a named room rectangle next to an existing room (semantic anchor, never coordinates).",
    "add_wall": "Add a straight wall segment between two points.",
    "remove_wall": "Remove a wall by id or semantic reference (between/and).",
    "add_opening": "Add a door or window to a wall (semantic wall ref, ratio or offset).",
    "move_opening": "Move an existing door or window along its wall.",
    "resize_room": "Set a room's width and depth in meters (anchored at its west/south corner); walls move with it. Use for 'make the bedroom 3.5 x 4'.",
    "set_wall_length": "Set one wall's length in meters, keeping its start point; connected walls follow.",
    "move_wall": "Slide a wall sideways by offset_m (positive = north/east); connected walls stretch.",
    "set_opening_size": "Change the width, height or sill of an existing door or window.",
    "split_room": "Divide a room with a 0.10 m interior partition; axis x = wall runs east-west, at_ratio = position across the room (0-1).",
    "rename_room": "Rename a room and/or set its function (bedroom, living, kitchen, bath...).",
    "undo": "Undo the last successful change.",
    "list_catalog": "List CC0 catalog items (materials, furniture) for the Design stage.",
    "place_furniture": "Place a catalog item in a room by catalog_id; code finds a free spot (optional room, anchor wall label, scale 0.8-1.2). Design stage.",
    "move_item": "Move a placed item: to a wall label, another room, or meters from a tap (Design stage).",
    "rotate_item": "Rotate a placed item by delta_deg or to rotation_deg; snapped to 90 degrees (Design stage).",
    "remove_item": "Remove a placed item by id, type (bed) or \"last\" (Design stage).",
    "create_variant": "Branch the Scene into a named variant (Present stage).",
    "render_view": "Render a photoreal view of a variant (Present stage, costs money, explicit request only).",
}


class ReformClient(Protocol):
    """Surface `run_turn` needs: `mme.client()` in production, fake in tests."""

    def respond(self, input: Any, **kwargs: Any) -> dict[str, Any]: ...
    def output_text(self, response: dict[str, Any]) -> str: ...
    def tool_calls(self, response: dict[str, Any]) -> list[dict[str, Any]]: ...


class TurnResult(BaseModel):
    """JSON-serializable turn outcome (the route needs plain dicts)."""

    scene: Scene
    history: list[dict[str, Any]] = Field(default_factory=list)
    reply: str = ""
    tool_events: list[dict[str, Any]] = Field(default_factory=list)


def _resolve_refs(node: Any, defs: dict[str, Any]) -> Any:
    """Inline local `$defs` refs so each tool schema is self-contained."""
    if isinstance(node, dict):
        if set(node) == {"$ref"} and node["$ref"].startswith("#/$defs/"):
            return _resolve_refs(copy.deepcopy(defs[node["$ref"].split("/")[-1]]), defs)
        return {key: _resolve_refs(value, defs) for key, value in node.items()}
    if isinstance(node, list):
        return [_resolve_refs(value, defs) for value in node]
    return node


def _function_tools(stage: str) -> list[dict[str, Any]]:
    """Build the stage's function-tool definitions (stable order, cacheable)."""
    tools = []
    for name in stage_table.allowed_tools(stage):
        schema = tool_contracts.TOOL_MODELS[name].model_json_schema()
        defs = schema.pop("$defs", {})
        tools.append(
            {
                # Responses API shape: flat, not Chat Completions' nested "function".
                "type": "function",
                "name": name,
                "description": TOOL_DESCRIPTIONS.get(name, name),
                "parameters": _resolve_refs(schema, defs),
            }
        )
    return tools


def _wall_length_m(wall: Any) -> float:
    return math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1])


def scene_summary(scene: Scene) -> str:
    """Compact Scene digest: ids and names only, never polygons."""
    rooms = ", ".join(f"{r.id}={r.name}({r.function or 'room'})" for r in scene.rooms)
    walls = ", ".join(f"{wall_label(scene, w.id)} [{w.kind}, id {w.id}]" for w in scene.walls)
    openings = ", ".join(
        f"{o.id}({o.kind} on {o.wall_id}, offset {o.offset_m:.2f} m, width {o.width_m:.2f} m)"
        for o in scene.openings
    )
    return (
        f"Scene {scene.id} v{scene.version}. "
        f"Rooms: {rooms or 'none'}. Walls: {walls or 'none'}. "
        f"Openings: {openings or 'none'}."
    )


def _selected_dict(selected: Any) -> dict[str, str] | None:
    """Tap context as a plain {kind, id} dict, or None when absent/malformed.

    Never raises: malformed `selected` (wrong type, missing keys) means
    "no tap context", not a crashed turn.
    """
    if isinstance(selected, BaseModel):
        sel = selected.model_dump()
    elif isinstance(selected, dict):
        sel = dict(selected)
    else:
        return None
    if sel.get("kind") and sel.get("id"):
        return {"kind": str(sel["kind"]), "id": str(sel["id"])}
    return None


def _selected_line(selected: Any) -> str | None:
    sel = _selected_dict(selected)
    if sel is None:
        return None
    return f"Tap-selected: {sel['kind']} {sel['id']} — \"this\"/\"esto\" refers to it."


def _backfill_selected(tool: Any, args: Any, selected: Any) -> dict[str, Any]:
    """Backfill tap context into the call when the model omits it.

    Only for tools whose input model declares a `selected` field, and only
    when the model didn't send one explicitly.
    """
    if not isinstance(args, dict) or "selected" in args:
        return dict(args) if isinstance(args, dict) else {}
    sel = _selected_dict(selected)
    if sel is None:
        return dict(args)
    model_cls = tool_contracts.TOOL_MODELS.get(tool) if isinstance(tool, str) else None
    if model_cls is None or "selected" not in model_cls.model_fields:
        return dict(args)
    return {**args, "selected": sel}


_ES_WORDS = frozenset(
    {
        "agrega", "agregar", "pone", "poner", "saca", "sacar", "mueve", "mover",
        "dormitorio", "cocina", "muro", "pared", "ventana", "puerta", "piso",
        "living", "quiero", "construir", "diseno", "segundo", "bano",
    }
)


def _is_spanish(user_text: str) -> bool:
    if re.search(r"[áéíóúñ¿¡]", user_text):
        return True
    tokens = set(re.findall(r"[a-z]+", user_text.casefold()))
    return bool(tokens & _ES_WORDS)


def _stop_reply(user_text: str) -> str:
    """Fixed preliminary reply for the 6-round stop (never implies safety)."""
    if _is_spanish(user_text):
        return (
            "Demasiados pasos para un solo turno, así que frené antes de cambiar "
            "nada más. Esto es preliminar, no es una certificación estructural — "
            "si tu cambio toca un segundo piso, un muro de carga, una luz larga "
            "o suelo desconocido, requiere un profesional matriculado. "
            "¿Me lo repetís en partes más chicas?"
        )
    return (
        "Too many steps for one turn, so I stopped before changing anything "
        "else. This is preliminary, not a structural certification — if your "
        "change involves a second floor, a load-bearing wall, a long span, or "
        "unknown soil, it needs a licensed professional. Tell me the step "
        "again in smaller pieces?"
    )


def _history_snapshot(history: list) -> list[dict[str, Any]]:
    """Caller-visible history keeps live records; the result carries dicts."""
    snapshot = []
    for record in history:
        if is_dataclass(record) and not isinstance(record, type):
            snapshot.append(asdict(record))
        elif isinstance(record, BaseModel):
            snapshot.append(record.model_dump(mode="json"))
        elif isinstance(record, dict):
            snapshot.append(dict(record))
        else:
            snapshot.append(record)
    return snapshot


CONVERSATION_LIMIT = 12


def _turn_input(user_text: str, conversation: list[dict[str, str]] | None) -> Any:
    """The model input: prior chat turns, then the new message (variable part last).

    With no prior conversation this is the bare string, so existing replay
    fixtures (keyed on the payload) keep hitting. The server holds no state
    and never uses previous_response_id across turns.
    """
    prior = [
        {"role": turn["role"], "content": turn["text"]}
        for turn in (conversation or [])[-CONVERSATION_LIMIT:]
        if turn.get("role") in ("user", "assistant") and str(turn.get("text", "")).strip()
    ]
    if not prior:
        return user_text
    return [*prior, {"role": "user", "content": user_text}]


class _Deadline(Exception):
    """The per-turn wall-clock budget ran out while waiting for the model."""


def _respond(client: Any, deadline: float, input: Any, **kwargs: Any) -> dict[str, Any]:
    """client.respond, but give up when the turn budget is spent.

    The call runs in a daemon thread; if it outlives the budget the turn
    answers with what it has and the stray call finishes (and is cached) alone.
    """
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise _Deadline
    box: queue.Queue[tuple[bool, Any]] = queue.Queue(maxsize=1)

    def work() -> None:
        try:
            box.put((True, client.respond(input, **kwargs)))
        except BaseException as exc:  # noqa: BLE001 - re-raised in the caller
            box.put((False, exc))

    threading.Thread(target=work, daemon=True).start()
    try:
        ok, value = box.get(timeout=remaining)
    except queue.Empty:
        raise _Deadline from None
    if not ok:
        raise value
    return value


def _partial_reply(user_text: str, events: list[dict[str, Any]], reason: str) -> str:
    """Graceful reply for a stopped turn: what was done, what to do next."""
    done = [e["name"] for e in events if e["ok"]]
    failed = [e["name"] for e in events if not e["ok"]]
    es = _is_spanish(user_text)
    if es:
        head = "No pude terminar este pedido a tiempo" if reason == "time" else "Frené este pedido antes de terminarlo"
        did = f" Ya apliqué: {', '.join(done)}." if done else " Todavía no cambié nada."
        bad = f" No funcionó: {', '.join(failed)}." if failed else ""
        return f"{head}.{did}{bad} Pedime el siguiente paso en una frase concreta (por ejemplo: «agregá una ventana en el muro 3»). Esto es preliminar."
    head = "I couldn't finish this in time" if reason == "time" else "I stopped this request before finishing"
    did = f" Applied so far: {', '.join(done)}." if done else " Nothing has changed yet."
    bad = f" Did not work: {', '.join(failed)}." if failed else ""
    return f"{head}.{did}{bad} Ask me for the next step in one concrete sentence (for example: \"add a window on wall 3\"). This is preliminary."


def run_turn(
    scene: Scene,
    history: list,
    stage: str,
    user_text: str,
    client: ReformClient,
    selected: Any = None,
    conversation: list[dict[str, str]] | None = None,
) -> TurnResult:
    """Run one Reform turn: tool rounds until a final text reply (max 6)."""
    try:
        tool_defs = _function_tools(stage)
    except KeyError:
        raise ValueError(
            f"unknown stage {stage!r}; expected one of {sorted(stage_table.STAGES)}"
        ) from None
    parts = [_INSTRUCTIONS, "", "## Current scene (measured, meters)", scene_summary(scene)]
    selected_line = _selected_line(selected)
    if selected_line is not None:
        parts.append(selected_line)
    instructions = "\n".join(parts)
    base_kwargs: dict[str, Any] = {
        "instructions": instructions,
        "tools": tool_defs,
        "tier": TIER,
        "tag": TAG,
        "prompt_cache_key": PROMPT_CACHE_KEY,
        "use_cache": True,
    }

    current = scene
    events: list[dict[str, Any]] = []
    started = time.monotonic()
    deadline = started + TURN_BUDGET_S
    rounds = 0

    def finish(reply: str, outcome: str) -> TurnResult:
        logger.info(
            "reform turn outcome=%s rounds=%d ops=%d seconds=%.1f",
            outcome, rounds, sum(1 for e in events if e["ok"]), time.monotonic() - started,
        )
        return TurnResult(
            scene=current, history=_history_snapshot(history), reply=reply, tool_events=events
        )

    try:
        response = _respond(
            client, deadline, _turn_input(user_text, conversation), previous_response_id=None, **base_kwargs
        )
    except _Deadline:
        return finish(_partial_reply(user_text, events, "time"), "timeout")
    while True:
        calls = client.tool_calls(response)
        if not calls:
            return finish(client.output_text(response), "reply")
        if rounds >= MAX_TOOL_ROUNDS:
            return finish(_stop_reply(user_text) if not events else _partial_reply(user_text, events, "rounds"), "rounds")
        rounds += 1
        outputs = []
        for call in calls:
            name = call.get("name")
            args = _backfill_selected(name, call.get("arguments") or {}, selected)
            current, res = execute(current, history, stage, name, args)
            events.append(
                {
                    "name": name,
                    "arguments": args,
                    "ok": res.ok,
                    "flags": list(res.flags),
                    "errors": [error.code for error in res.errors],
                    "error_messages": [error.message for error in res.errors],
                    "warnings": list(res.warnings),
                }
            )
            outputs.append(
                {
                    "type": "function_call_output",
                    "call_id": call.get("call_id"),
                    "output": res.model_dump_json(),
                }
            )
        response_id = response.get("id") if isinstance(response, dict) else None
        try:
            response = _respond(client, deadline, outputs, previous_response_id=response_id, **base_kwargs)
        except _Deadline:
            return finish(_partial_reply(user_text, events, "time"), "timeout")


__all__ = [
    "MAX_TOOL_ROUNDS",
    "ReformClient",
    "TurnResult",
    "run_turn",
    "scene_summary",
]
