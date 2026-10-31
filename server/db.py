"""Variant persistence: base Scene + branches/ops as JSON in SQLite.

Deliberately stdlib sqlite3, not SQLModel: SQLModel is absent from
server/requirements.txt and cannot be installed or verified during the
unattended night mission, so this module keeps the agreed contract
(init_db / save_project / load_project) on the standard library instead of
pulling a new dependency. Switch to SQLModel tables when it is available.
"""

from __future__ import annotations

import os
import json
import sqlite3
from dataclasses import asdict
from pathlib import Path

from server.scene.models import Scene
from server.scene.ops import OpRecord
from server.scene.variants import Branch, Project

__all__ = ["init_db", "load_project", "save_project"]

_SCHEMA = """
CREATE TABLE IF NOT EXISTS project (
    id TEXT PRIMARY KEY,
    base_scene_json TEXT NOT NULL,
    chosen TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS branch (
    project_id TEXT NOT NULL,
    label TEXT NOT NULL,
    parent TEXT,
    fork_at_version INTEGER NOT NULL,
    ops_json TEXT NOT NULL,
    PRIMARY KEY (project_id, label)
);
"""

DbPath = str | Path


def _resolve(db_path: DbPath | None) -> str:
    return str(db_path) if db_path is not None else os.environ.get("MAQET_DB", "maqet.db")


def init_db(db_path: DbPath | None = None) -> None:
    """Create tables. The zero-arg form keeps the original import path working."""
    connection = sqlite3.connect(_resolve(db_path))
    try:
        connection.executescript(_SCHEMA)
        connection.commit()
    finally:
        connection.close()


def save_project(
    project: Project, project_id: str = "default", db_path: DbPath | None = None
) -> None:
    """Upsert a Project: base Scene plus every branch and its op history as JSON."""
    path = _resolve(db_path)
    init_db(path)
    base_json = project.base.model_dump_json()
    branch_rows = [
        (
            project_id,
            label,
            branch.parent,
            branch.fork_at_version,
            json.dumps([asdict(record) for record in branch.ops]),
        )
        for label, branch in project.branches.items()
    ]
    connection = sqlite3.connect(path)
    try:
        connection.execute(
            "INSERT INTO project (id, base_scene_json, chosen) VALUES (?, ?, ?) "
            "ON CONFLICT(id) DO UPDATE SET "
            "base_scene_json=excluded.base_scene_json, chosen=excluded.chosen",
            (project_id, base_json, project.chosen),
        )
        connection.execute("DELETE FROM branch WHERE project_id = ?", (project_id,))
        connection.executemany(
            "INSERT INTO branch (project_id, label, parent, fork_at_version, ops_json)"
            " VALUES (?, ?, ?, ?, ?)",
            branch_rows,
        )
        connection.commit()
    finally:
        connection.close()


def load_project(project_id: str = "default", db_path: DbPath | None = None) -> Project:
    """Rebuild a Project from its JSON rows. Raises KeyError when missing."""
    path = _resolve(db_path)
    init_db(path)  # fresh path -> empty tables -> KeyError below, not OperationalError
    connection = sqlite3.connect(path)
    try:
        row = connection.execute(
            "SELECT base_scene_json, chosen FROM project WHERE id = ?", (project_id,)
        ).fetchone()
        if row is None:
            raise KeyError(f"unknown project {project_id!r}")
        base = Scene.model_validate_json(row[0])
        branches: dict[str, Branch] = {}
        for label, parent, fork_at_version, ops_json in connection.execute(
            "SELECT label, parent, fork_at_version, ops_json FROM branch WHERE project_id = ?",
            (project_id,),
        ):
            records = [OpRecord(**item) for item in json.loads(ops_json)]
            branches[label] = Branch(
                parent=parent, fork_at_version=fork_at_version, ops=records
            )
    finally:
        connection.close()
    return Project(base=base, branches=branches, chosen=row[1])
