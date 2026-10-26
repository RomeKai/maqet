"""Scene round-trip and determinism tests (ADR-001). Offline, no Meta calls."""

from server.scene.models import Opening, Room, Scene, Wall


def _base_scene() -> Scene:
    return Scene(
        id="s1",
        version=0,
        scale_confirmed=True,
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


def test_round_trip_json_identical() -> None:
    scene = _base_scene()
    restored = Scene.model_validate_json(scene.model_dump_json())
    assert restored == scene


def test_determinism_same_dump_twice() -> None:
    scene = _base_scene()
    assert (
        scene.model_dump_json()
        == Scene.model_validate(scene.model_dump()).model_dump_json()
    )


def test_defaults_match_skill() -> None:
    scene = Scene(id="s")
    assert scene.units == "m"
    assert scene.ceiling_height_m == 2.6
    assert scene.scale_confirmed is False
    assert scene.version == 0
