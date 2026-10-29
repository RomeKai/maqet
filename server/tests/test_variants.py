"""Variant branch tests (ADR-013). Offline: pure ops + sqlite round-trip, no Meta calls."""

from __future__ import annotations

from pathlib import Path

import pytest

from server.db import init_db, load_project, save_project
from server.scene.models import Opening, Scene, Wall
from server.scene.ops import add_opening, add_wall, remove_wall
from server.scene.variants import (
    Project,
    choose,
    create_variant,
    materialize,
    undo_in_branch,
)


def _base() -> Scene:
    return Scene(id="s", scale_confirmed=True)


def _wall(wid: str, x1: float = 2.0) -> Wall:
    return Wall(id=wid, a=(0.0, 0.0), b=(x1, 0.0), thickness_m=0.10, kind="interior")


def _apply(project: Project, label: str, wall: Wall) -> Scene:
    """Apply add_wall to a branch's materialized scene and record the op."""
    scene, result = add_wall(materialize(project, label), wall, actor="user")
    assert result.ok, result.errors
    assert result.record is not None
    project.branches[label].ops.append(result.record)
    return scene


def test_default_project_is_single_proposal() -> None:
    base = _base()
    project = Project(base=base)
    assert set(project.branches) == {"A"}
    assert project.branches["A"].parent is None
    assert project.chosen == "A"
    scene = materialize(project, "A")
    assert scene == base
    assert scene.version == base.version


def test_create_variant_forks_at_current_version() -> None:
    project = Project(base=_base())
    _apply(project, "A", _wall("w1"))
    create_variant(project, "A", "B")
    branch = project.branches["B"]
    assert branch.parent == "A"
    assert branch.fork_at_version == materialize(project, "A").version == 1
    assert branch.ops == []
    assert materialize(project, "B") == materialize(project, "A")


def test_branches_diverge_independently() -> None:
    project = Project(base=_base())
    create_variant(project, "A", "B")
    _apply(project, "A", _wall("wA"))
    _apply(project, "B", _wall("wB"))
    assert [w.id for w in materialize(project, "A").walls] == ["wA"]
    assert [w.id for w in materialize(project, "B").walls] == ["wB"]


def test_parent_ops_after_fork_stay_out_of_child() -> None:
    project = Project(base=_base())
    _apply(project, "A", _wall("w1"))
    create_variant(project, "A", "B")
    assert [w.id for w in materialize(project, "B").walls] == ["w1"]  # warms cache
    _apply(project, "A", _wall("w2"))
    assert [w.id for w in materialize(project, "B").walls] == ["w1"]
    assert [w.id for w in materialize(project, "A").walls] == ["w1", "w2"]
    assert materialize(project, "B").version == 1


def test_undo_in_branch_trims_only_own_ops() -> None:
    project = Project(base=_base())
    _apply(project, "A", _wall("w1"))
    create_variant(project, "A", "B")
    _apply(project, "B", _wall("wB1"))
    _apply(project, "B", _wall("wB2"))
    scene = undo_in_branch(project, "B")
    assert [w.id for w in scene.walls] == ["w1", "wB1"]
    assert [w.id for w in materialize(project, "A").walls] == ["w1"]
    assert len(project.branches["B"].ops) == 1


def test_undo_in_parent_updates_child_slice() -> None:
    project = Project(base=_base())
    _apply(project, "A", _wall("w1"))
    _apply(project, "A", _wall("w2"))
    create_variant(project, "A", "B")
    assert [w.id for w in materialize(project, "B").walls] == ["w1", "w2"]
    undo_in_branch(project, "A")
    assert [w.id for w in materialize(project, "B").walls] == ["w1"]


def test_undo_in_branch_with_no_own_ops_is_noop() -> None:
    project = Project(base=_base())
    _apply(project, "A", _wall("w1"))
    create_variant(project, "A", "B")
    before = materialize(project, "B")
    assert undo_in_branch(project, "B") == before
    assert project.branches["B"].ops == []


def test_choose_sets_chosen_and_rejects_unknown() -> None:
    project = Project(base=_base())
    create_variant(project, "A", "B")
    before_b = materialize(project, "B")
    choose(project, "B")
    assert project.chosen == "B"
    assert materialize(project, "B") == before_b  # no other side effects
    with pytest.raises(KeyError):
        choose(project, "Z")


def test_create_variant_rejects_bad_labels_and_sources() -> None:
    project = Project(base=_base())
    with pytest.raises(KeyError):
        create_variant(project, "Z", "B")
    with pytest.raises(ValueError):
        create_variant(project, "A", "")
    with pytest.raises(ValueError):
        create_variant(project, "A", "b")
    create_variant(project, "A", "B")
    with pytest.raises(ValueError):
        create_variant(project, "A", "B")
    with pytest.raises(KeyError):
        materialize(project, "Z")
    with pytest.raises(KeyError):
        undo_in_branch(project, "Z")


def test_materialize_caches_by_version() -> None:
    project = Project(base=_base())
    create_variant(project, "A", "B")
    first = materialize(project, "B")
    assert materialize(project, "B") is first
    _apply(project, "B", _wall("wB"))
    second = materialize(project, "B")
    assert second is not first
    assert [w.id for w in second.walls] == ["wB"]


def test_db_round_trip_preserves_project(tmp_path: Path) -> None:
    db_path = tmp_path / "maqet.db"
    init_db(db_path)
    project = Project(base=_base())
    _apply(project, "A", _wall("w1"))
    create_variant(project, "A", "B")
    _apply(project, "B", _wall("wB"))
    choose(project, "B")
    save_project(project, project_id="p1", db_path=db_path)
    loaded = load_project("p1", db_path=db_path)
    assert loaded.base == project.base
    assert loaded.chosen == "B"
    assert set(loaded.branches) == {"A", "B"}
    assert loaded.branches["B"].parent == "A"
    assert loaded.branches["B"].fork_at_version == 1
    assert len(loaded.branches["A"].ops) == 1
    assert len(loaded.branches["B"].ops) == 1
    assert materialize(loaded, "A") == materialize(project, "A")
    assert materialize(loaded, "B") == materialize(project, "B")


def test_load_unknown_project_raises_key_error(tmp_path: Path) -> None:
    db_path = tmp_path / "empty.db"
    init_db(db_path)
    with pytest.raises(KeyError):
        load_project("missing", db_path=db_path)


def test_load_project_on_fresh_path_raises_key_error(tmp_path: Path) -> None:
    """Never-touched db file must raise KeyError, not sqlite OperationalError."""
    with pytest.raises(KeyError):
        load_project("missing", db_path=tmp_path / "never-created.db")


def test_fork_from_fork_chains_grandparent_ops() -> None:
    """C forked from B sees B's fork-time slice of A, not A's later ops."""
    project = Project(base=_base())
    _apply(project, "A", _wall("w1"))
    _apply(project, "A", _wall("w2"))
    create_variant(project, "A", "B")
    _apply(project, "B", _wall("wB"))
    create_variant(project, "B", "C")
    assert project.branches["C"].parent == "B"
    assert project.branches["C"].fork_at_version == materialize(project, "B").version
    assert [w.id for w in materialize(project, "C").walls] == ["w1", "w2", "wB"]
    _apply(project, "A", _wall("w3"))
    _apply(project, "B", _wall("wB2"))
    assert [w.id for w in materialize(project, "C").walls] == ["w1", "w2", "wB"]
    assert [w.id for w in materialize(project, "B").walls] == ["w1", "w2", "wB", "wB2"]


def test_wall_with_optional_fields_survives_db_round_trip(tmp_path: Path) -> None:
    """OpRecord.args JSON must preserve provenance/load_bearing/height exactly."""
    db_path = tmp_path / "opts.db"
    project = Project(base=_base())
    _apply(
        project,
        "A",
        Wall(
            id="w1",
            a=(0.0, 0.0),
            b=(4.0, 0.0),
            thickness_m=0.20,
            kind="exterior",
            height_m=2.8,
            load_bearing=True,
            provenance="measured_ar",
        ),
    )
    save_project(project, project_id="p1", db_path=db_path)
    loaded = load_project("p1", db_path=db_path)
    wall = materialize(loaded, "A").walls[0]
    assert (wall.height_m, wall.load_bearing, wall.provenance) == (2.8, True, "measured_ar")
    assert materialize(loaded, "A") == materialize(project, "A")


def test_remove_wall_and_opening_replay_in_branch() -> None:
    """Non-add_wall ops replay through variants, not just add_wall."""
    project = Project(base=_base())
    _apply(project, "A", _wall("w1", x1=5.0))
    opening = Opening(id="d1", wall_id="w1", kind="door", offset_m=1.0, width_m=0.9, height_m=2.1)
    scene, result = add_opening(materialize(project, "A"), opening, actor="user")
    assert result.ok, result.errors
    project.branches["A"].ops.append(result.record)
    create_variant(project, "A", "B")
    scene_b, result_b = remove_wall(materialize(project, "B"), "w1", actor="user")
    assert result_b.ok, result_b.errors
    project.branches["B"].ops.append(result_b.record)
    assert materialize(project, "B").walls == []
    assert materialize(project, "B").openings == []  # cascaded with the wall
    assert [w.id for w in materialize(project, "A").walls] == ["w1"]


def test_repeated_create_and_save_is_idempotent(tmp_path: Path) -> None:
    """save_project twice with new branches keeps exactly one row per label."""
    import sqlite3

    db_path = tmp_path / "idem.db"
    project = Project(base=_base())
    _apply(project, "A", _wall("w1"))
    create_variant(project, "A", "B")
    save_project(project, project_id="p1", db_path=db_path)
    _apply(project, "B", _wall("wB"))
    save_project(project, project_id="p1", db_path=db_path)
    connection = sqlite3.connect(db_path)
    try:
        labels = [
            row[0]
            for row in connection.execute(
                "SELECT label FROM branch WHERE project_id = ?", ("p1",)
            )
        ]
    finally:
        connection.close()
    assert sorted(labels) == ["A", "B"]
    assert materialize(load_project("p1", db_path=db_path), "B") == materialize(project, "B")
