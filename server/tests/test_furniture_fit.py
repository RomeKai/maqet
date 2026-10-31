from server.agent.executor import execute
from server.scene.fit import furniture_fit_warnings
from server.scene.models import Furniture
from server.tests.test_design_tools import _scene


def _with(*items) -> object:
    s = _scene()
    return s.model_copy(update={"furniture": [Furniture(id=i, room_id="r1", position=p, size_m=sz) for i, p, sz in items]})


def test_item_in_door_swing_is_flagged() -> None:
    s = _with(("a", (2.0, 0.6), (1.2, 0.6, 0.9)))
    codes = [w.code for w in furniture_fit_warnings(s)]
    assert "furniture.blocks_door_swing" in codes


def test_narrow_passage_under_one_meter_is_flagged() -> None:
    # 4 x 3 room: a 2.2 m deep wardrobe-like block leaves a 0.8 m passage to the north wall
    s = _with(("a", (2.0, 1.4), (3.0, 1.8, 0.9)))
    codes = [w.code for w in furniture_fit_warnings(s)]
    assert "furniture.narrow_passage" in codes


def test_well_placed_items_have_no_warning() -> None:
    s, _ = execute(_scene(), [], "design", "place_furniture", {"catalog_id": "bed-single-90x190", "room": "r1"})
    assert furniture_fit_warnings(s) == []


def test_move_into_door_swing_returns_warning_but_succeeds() -> None:
    hist: list = []
    s, _ = execute(_scene(), hist, "design", "place_furniture", {"catalog_id": "chair-45x45", "room": "r1", "item_id": "c1"})
    s, res = execute(s, hist, "design", "move_item", {"item": "c1", "position": [2.0, 0.5]})
    assert res.ok and any("door" in w for w in res.warnings)
