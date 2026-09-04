from __future__ import annotations

import math

import pytest

from geometry.fixtures import build_l_shaped_fixture, measured
from geometry.models import Point2D, RoomDefinition
from geometry.walls import (
    PolygonValidationError,
    derive_walls,
    outward_wall_footprint,
    room_polygon,
)


def make_room(points: list[tuple[float, float]]) -> RoomDefinition:
    return RoomDefinition(
        name="test room",
        vertices=[Point2D(x=x, y=y) for x, y in points],
        wall_height=measured(2400.0),
        wall_thickness=measured(100.0),
    )


@pytest.mark.parametrize(
    ("points", "expected_area"),
    [
        ([(0, 0), (2000, 0), (2000, 1000), (0, 1000)], 2_000_000.0),
        (
            [(0, 0), (3200, 0), (3200, 1800), (2200, 1800), (2200, 2800), (0, 2800)],
            7_960_000.0,
        ),
        ([(0, 0), (3000, 0), (3000, 1000), (1500, 500), (0, 1000)], 2_250_000.0),
    ],
)
def test_valid_rectangle_l_shape_and_concave_polygon(points: list[tuple[float, float]], expected_area: float) -> None:
    assert room_polygon(make_room(points)).area == pytest.approx(expected_area)


def test_self_intersection_is_rejected_with_useful_error() -> None:
    room = make_room([(0, 0), (2000, 2000), (0, 2000), (2000, 0)])
    with pytest.raises(PolygonValidationError, match="Self-intersection"):
        room_polygon(room)


def test_clockwise_polygon_is_rejected() -> None:
    room = make_room([(0, 0), (0, 1000), (2000, 1000), (2000, 0)])
    with pytest.raises(PolygonValidationError, match="counter-clockwise"):
        room_polygon(room)


def test_duplicate_consecutive_vertex_is_rejected() -> None:
    with pytest.raises(ValueError, match="duplicate consecutive vertex"):
        make_room([(0, 0), (2000, 0), (2000, 0), (0, 1000)])


def test_l_shaped_wall_lengths_and_normals_are_exact() -> None:
    fixture = build_l_shaped_fixture()
    walls = derive_walls(fixture.room)
    assert [wall.length_mm for wall in walls] == pytest.approx([3200.0, 1800.0, 1000.0, 1000.0, 2200.0, 2800.0])
    assert walls[0].interior_normal.x == pytest.approx(0.0)
    assert walls[0].interior_normal.y == pytest.approx(1.0)
    assert walls[0].exterior_normal.y == pytest.approx(-1.0)


def test_walls_extrude_outward_without_shrinking_internal_polygon() -> None:
    fixture = build_l_shaped_fixture()
    internal = room_polygon(fixture.room)
    original_area = internal.area
    for wall in derive_walls(fixture.room):
        footprint = outward_wall_footprint(wall)
        assert footprint.area == pytest.approx(wall.length_mm * 100.0)
        assert footprint.intersection(internal).area == pytest.approx(0.0, abs=1e-6)
    assert room_polygon(fixture.room).area == original_area


def test_angled_wall_length_is_not_rounded() -> None:
    room = make_room([(0, 0), (1000, 0), (1500, 500), (0, 1000)])
    walls = derive_walls(room)
    assert walls[1].length_mm == pytest.approx(math.sqrt(500**2 + 500**2))


def test_individual_wall_thickness_overrides_the_room_default() -> None:
    room = make_room([(0, 0), (2000, 0), (2000, 1000), (0, 1000)]).model_copy(
        update={"wall_thickness_overrides_mm": {"wall-002": 215.0}}
    )

    walls = derive_walls(room)

    assert [wall.thickness_mm for wall in walls] == pytest.approx([100.0, 215.0, 100.0, 100.0])
    assert outward_wall_footprint(walls[1]).area == pytest.approx(walls[1].length_mm * 215.0)


def test_wall_thickness_override_rejects_unknown_wall_and_invalid_value() -> None:
    with pytest.raises(ValueError, match="unknown wall"):
        RoomDefinition(
            name="unknown thickness override",
            vertices=[Point2D(x=x, y=y) for x, y in [(0, 0), (2000, 0), (2000, 1000), (0, 1000)]],
            wall_height=measured(2400.0),
            wall_thickness=measured(100.0),
            wall_thickness_overrides_mm={"wall-005": 150.0},
        )
    with pytest.raises(ValueError, match="greater than zero"):
        RoomDefinition(
            name="invalid thickness override",
            vertices=[Point2D(x=x, y=y) for x, y in [(0, 0), (2000, 0), (2000, 1000), (0, 1000)]],
            wall_height=measured(2400.0),
            wall_thickness=measured(100.0),
            wall_thickness_overrides_mm={"wall-001": 0.0},
        )
