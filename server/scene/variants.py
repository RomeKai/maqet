"""Variants as Scene branches (ADR-013).

A Project holds one measured base Scene plus named branches (A/B/C...).
Branch 'A' always exists and is the default proposal: a project with no extra
variants behaves as a single proposal (the P0 default).

Materialization is deterministic: base Scene + ancestor ops up to each fork +
the branch's own ops, replayed through server.scene.ops.replay and cached by
(branch, fork, op counts) so repeated reads are free and parent edits after a
fork can never leak stale scenes into the child.
"""

from __future__ import annotations

import math

from pydantic import BaseModel, ConfigDict, Field, PrivateAttr, model_validator

from server.scene.models import Scene
from server.scene.ops import OpRecord, replay

__all__ = [
    "Branch",
    "Project",
    "choose",
    "create_variant",
    "materialize",
    "undo_in_branch",
]


class Branch(BaseModel):
    """One variant line: fork point plus its own op history."""

    model_config = ConfigDict(arbitrary_types_allowed=True)

    parent: str | None = None
    fork_at_version: int = Field(default=0, ge=0)
    ops: list[OpRecord] = Field(default_factory=list)


class Project(BaseModel):
    """Base Scene + branches. Branch 'A' is auto-created; chosen defaults to it."""

    model_config = ConfigDict(arbitrary_types_allowed=True)

    base: Scene
    branches: dict[str, Branch] = Field(default_factory=dict)
    chosen: str = "A"

    _cache: dict = PrivateAttr(default_factory=dict)

    @model_validator(mode="after")
    def _ensure_default_branch(self) -> Project:
        if "A" not in self.branches:
            self.branches["A"] = Branch()
        if self.chosen not in self.branches:
            raise ValueError(f"chosen branch {self.chosen!r} does not exist")
        return self


def _check_label(label: str) -> None:
    if not isinstance(label, str) or not label or label != label.upper():
        raise ValueError(
            f"branch label must be a non-empty uppercase string, got {label!r}"
        )


def _chain(project: Project, label: str) -> list[str]:
    """Ancestor labels from root to `label` (cycle-safe)."""
    chain: list[str] = []
    seen: set[str] = set()
    current: str | None = label
    while current is not None:
        if current in seen:
            raise ValueError(f"branch cycle detected at {current!r}")
        seen.add(current)
        chain.append(current)
        current = project.branches[current].parent
    chain.reverse()
    return chain


def _collect_ops(project: Project, label: str, upto_version: float) -> list[OpRecord]:
    """Own ops (sliced by version) plus the parent chain sliced at each fork."""
    branch = project.branches[label]
    own = [record for record in branch.ops if record.after_version <= upto_version]
    if branch.parent is None:
        return own
    return _collect_ops(project, branch.parent, branch.fork_at_version) + own


def materialize(project: Project, label: str) -> Scene:
    """Base + ancestor ops up to each fork + own ops, cached by op counts."""
    if label not in project.branches:
        raise KeyError(f"unknown branch {label!r}")
    chain = _chain(project, label)
    key = (
        label,
        tuple(
            (name, project.branches[name].fork_at_version, len(project.branches[name].ops))
            for name in chain
        ),
    )
    cached = project._cache.get(key)
    if cached is None:
        cached = replay(project.base, _collect_ops(project, label, math.inf))
        project._cache[key] = cached
    return cached


def create_variant(project: Project, from_branch: str, label: str) -> Project:
    """Fork `label` from `from_branch` at its current materialized version."""
    _check_label(label)
    if from_branch not in project.branches:
        raise KeyError(f"unknown branch {from_branch!r}")
    if label in project.branches:
        raise ValueError(f"branch {label!r} already exists")
    fork_at_version = materialize(project, from_branch).version
    project.branches[label] = Branch(parent=from_branch, fork_at_version=fork_at_version)
    project._cache.clear()
    return project


def undo_in_branch(project: Project, label: str) -> Scene:
    """Drop the branch's last own op (never parent history) and re-materialize."""
    if label not in project.branches:
        raise KeyError(f"unknown branch {label!r}")
    if project.branches[label].ops:
        project.branches[label].ops.pop()
        project._cache.clear()
    return materialize(project, label)


def choose(project: Project, label: str) -> Project:
    """Select the active variant. Only sets `chosen`; nothing else changes."""
    if label not in project.branches:
        raise KeyError(f"unknown branch {label!r}")
    project.chosen = label
    return project
