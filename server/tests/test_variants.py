"""Variant branch tests (ADR-013). Offline: pure ops + sqlite round-trip, no Meta calls."""

from __future__ import annotations

from pathlib import Path

import pytest

from server.db import init_db, load_project, save_project
from server.scene.models import Scene, Wall
from server.scene.ops import add_wall
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
