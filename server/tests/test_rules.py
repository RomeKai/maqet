"""Rule tests (ADR-023): pass/fail per rule + professional flags. Offline."""

from server.scene.models import Furniture, Opening, Room, Scene, Wall
from server.scene.rules import (
    DEFAULT_CEILING_HEIGHT_M,
    DOOR_CLEARANCE_M,
    DOOR_WIDTH_M,
    MAX_UNSUPPORTED_SPAN_M,
    MIN_CEILING_HEIGHT_M,
    MIN_CORRIDOR_WIDTH_M,
    MIN_DOOR_WIDTH_M,
    MIN_HABITABLE_ROOM_AREA_M2,
    MIN_HABITABLE_ROOM_SIDE_M,
    MIN_VENT_OPENABLE_RATIO,
    MIN_WINDOW_TO_FLOOR_RATIO,
    PRO_FLAG_LOAD_BEARING,
    PRO_FLAG_SECOND_FLOOR,
    PRO_FLAG_SOIL,
    PRO_FLAG_SPAN,
)
from server.scene.validation import ValidationContext, validate_scene


def _base_scene() -> Scene:
    """3x3 bedroom scene that passes every rule with no flags."""
    return Scene(
        id="s1",
        version=0,
        scale_confirmed=True,
        ceiling_height_m=2.6,
        walls=[
            Wall(id="w1", a=(0.0, 0.0), b=(3.0, 0.0), thickness_m=0.20, kind="exterior"),
            Wall(id="w2", a=(3.0, 0.0), b=(3.0, 3.0), thickness_m=0.20, kind="exterior"),
            Wall(id="w3", a=(3.0, 3.0), b=(0.0, 3.0), thickness_m=0.20, kind="exterior"),
            Wall(id="w4", a=(0.0, 3.0), b=(0.0, 0.0), thickness_m=0.20, kind="exterior"),
        ],
        openings=[
            Opening(
                id="d1",
                wall_id="w1",
                kind="door",
                offset_m=1.0,
                width_m=0.90,
                height_m=2.10,
            ),
            Opening(
                id="v1",
                wall_id="w2",
                kind="window",
                offset_m=0.5,
                width_m=1.20,
                height_m=1.20,
                sill_m=0.90,
            ),
        ],
        rooms=[
            Room(
                id="r1",
                name="Dormitorio",
                polygon=[(0.0, 0.0), (3.0, 0.0), (3.0, 3.0), (0.0, 3.0)],
                function="bedroom",
            )
        ],
    )


def test_base_scene_is_clean() -> None:
    report = validate_scene(_base_scene())
    assert report.ok
    assert report.errors == ()
    assert report.warnings == ()
    assert report.flags == ()


# --- Habitable room area ------------------------------------------------------


def test_room_area_pass() -> None:
    assert validate_scene(_base_scene()).ok


def test_room_area_fail() -> None:
    scene = _base_scene()
    scene.rooms[0].polygon = [(0.0, 0.0), (2.0, 0.0), (2.0, 2.0), (0.0, 2.0)]
    report = validate_scene(scene)
    assert not report.ok
    assert any("area" in e and "m2" in e for e in report.errors)


# --- Habitable room side ------------------------------------------------------


def test_room_side_pass() -> None:
    assert validate_scene(_base_scene()).ok


def test_room_side_fail() -> None:
    scene = _base_scene()
    # Area 6.65 m2 passes; min side 1.9 m fails.
    scene.rooms[0].polygon = [(0.0, 0.0), (3.5, 0.0), (3.5, 1.9), (0.0, 1.9)]
    report = validate_scene(scene)
    assert not report.ok
    assert any("min side" in e for e in report.errors)


# --- Window-to-floor ratio ----------------------------------------------------


def test_window_ratio_pass() -> None:
    report = validate_scene(_base_scene())
    assert not any("window/floor" in w for w in report.warnings)


def test_window_ratio_fail() -> None:
    scene = _base_scene()
    scene.openings[1].width_m = 0.5
    scene.openings[1].height_m = 0.5
    report = validate_scene(scene)
    assert any("window/floor" in w for w in report.warnings)


# --- Ceiling height -----------------------------------------------------------


def test_ceiling_pass() -> None:
    assert validate_scene(_base_scene()).ok


def test_ceiling_fail() -> None:
    scene = _base_scene()
    scene.ceiling_height_m = 2.4
    report = validate_scene(scene)
    assert not report.ok
    assert any("ceiling height" in e for e in report.errors)


# --- Door width ---------------------------------------------------------------


def test_door_width_pass() -> None:
    assert validate_scene(_base_scene()).ok


def test_door_width_fail() -> None:
    scene = _base_scene()
    scene.openings[0].width_m = 0.70
    report = validate_scene(scene)
    assert not report.ok
    assert any("below minimum" in e for e in report.errors)


# --- Wall thickness -----------------------------------------------------------


def test_exterior_wall_thickness_pass() -> None:
    assert validate_scene(_base_scene()).ok


def test_exterior_wall_thickness_fail() -> None:
    scene = _base_scene()
    scene.walls[0].thickness_m = 0.15
    report = validate_scene(scene)
    assert not report.ok
    assert any("thickness" in e for e in report.errors)


def test_interior_wall_thickness_pass() -> None:
    scene = _base_scene()
    scene.walls.append(
        Wall(id="w5", a=(1.5, 0.0), b=(1.5, 3.0), thickness_m=0.10, kind="interior")
    )
    assert validate_scene(scene).ok


def test_interior_wall_thickness_fail() -> None:
    scene = _base_scene()
    scene.walls.append(
        Wall(id="w5", a=(1.5, 0.0), b=(1.5, 3.0), thickness_m=0.05, kind="interior")
    )
    report = validate_scene(scene)
    assert not report.ok
    assert any("thickness" in e for e in report.errors)


# --- Span ---------------------------------------------------------------------


def test_span_pass() -> None:
    report = validate_scene(_base_scene())
    assert not any(f.startswith(PRO_FLAG_SPAN) for f in report.flags)


def test_span_over_limit_flag() -> None:
    scene = _base_scene()
    scene.walls[0].b = (5.0, 0.0)
    report = validate_scene(scene)
    assert f"{PRO_FLAG_SPAN}:w1" in report.flags
    # Flags never block geometry.
    assert report.ok


# --- Corridor width -----------------------------------------------------------


def test_corridor_pass() -> None:
    scene = _base_scene()
    scene.rooms.append(
        Room(
            id="r2",
            name="Pasillo",
            polygon=[(0.0, 0.0), (2.0, 0.0), (2.0, 1.2), (0.0, 1.2)],
            function="hall",
        )
    )
    report = validate_scene(scene)
    assert not any("narrow side" in w for w in report.warnings)


def test_corridor_fail() -> None:
    scene = _base_scene()
    scene.rooms.append(
        Room(
            id="r2",
            name="Pasillo",
            polygon=[(0.0, 0.0), (2.0, 0.0), (2.0, 0.8), (0.0, 0.8)],
            function="hall",
        )
    )
    report = validate_scene(scene)
    assert any("narrow side" in w for w in report.warnings)


# --- Door clearance -----------------------------------------------------------


def _clearance_scene() -> Scene:
    # Room extends past the door wall so the opening center tests inside it.
    scene = _base_scene()
    scene.rooms[0].polygon = [(0.0, -0.5), (3.0, -0.5), (3.0, 3.0), (0.0, 3.0)]
    return scene


def test_door_clearance_pass() -> None:
    report = validate_scene(_clearance_scene())
    assert not any("clearance" in w for w in report.warnings)


def test_door_clearance_fail() -> None:
    scene = _clearance_scene()
    scene.furniture.append(
        Furniture(
            id="f1", room_id="r1", position=(1.45, 0.3), size_m=(0.5, 0.5, 0.5)
        )
    )
    report = validate_scene(scene)
    assert any("clearance" in w for w in report.warnings)


# --- Professional-required flags ----------------------------------------------


def test_flag_second_floor() -> None:
    report = validate_scene(
        _base_scene(), ValidationContext(needs_second_floor=True)
    )
    assert PRO_FLAG_SECOND_FLOOR in report.flags
    assert report.ok


def test_flag_load_bearing_wall_removed() -> None:
    report = validate_scene(
        _base_scene(), ValidationContext(removed_load_bearing_wall=True)
    )
    assert PRO_FLAG_LOAD_BEARING in report.flags
    assert report.ok


def test_flag_unknown_soil() -> None:
    report = validate_scene(_base_scene(), ValidationContext(soil_unknown=True))
    assert PRO_FLAG_SOIL in report.flags
    assert report.ok


def test_no_flags_by_default() -> None:
    report = validate_scene(_base_scene())
    assert report.flags == ()


# --- Constants not enforced by validation -------------------------------------


def test_unenforced_rule_constants_coherent() -> None:
    # Guard the intended defaults for rules validate_scene does not enforce.
    assert DEFAULT_CEILING_HEIGHT_M == MIN_CEILING_HEIGHT_M
    assert DOOR_WIDTH_M >= MIN_DOOR_WIDTH_M
    assert 0.0 < MIN_VENT_OPENABLE_RATIO <= 1.0
    assert 0.0 < MIN_WINDOW_TO_FLOOR_RATIO <= 1.0
    assert DOOR_CLEARANCE_M > 0.0
    assert MAX_UNSUPPORTED_SPAN_M > 0.0
    assert MIN_CORRIDOR_WIDTH_M > 0.0
    assert MIN_HABITABLE_ROOM_AREA_M2 > 0.0
    assert MIN_HABITABLE_ROOM_SIDE_M > 0.0
