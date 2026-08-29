from __future__ import annotations

import pytest
from shapely.geometry import Point

from geometry.fixtures import build_l_shaped_fixture
from geometry.models import DoorType, OpeningKind
from geometry.shapes import door_swing_envelope, opening_endpoints, opening_line
from geometry.walls import wall_by_id


def test_door_position_is_derived_from_parent_wall_start() -> None:
    fixture = build_l_shaped_fixture()
    door = next(item for item in fixture.room.openings if item.kind is OpeningKind.DOOR)
    wall = wall_by_id(fixture.room, door.parent_wall_id)
    start, end = opening_endpoints(door, wall)
    assert (start.x, start.y) == pytest.approx((100.0, 0.0))
    assert (end.x, end.y) == pytest.approx((900.0, 0.0))


def test_inward_door_swing_is_inside_room_side() -> None:
    fixture = build_l_shaped_fixture()
    door = next(item for item in fixture.room.openings if item.kind is OpeningKind.DOOR)
    swing = door_swing_envelope(fixture.room, door)
    assert swing.area == pytest.approx(3.141592653589793 * 800.0**2 / 4.0, rel=2e-3)
    assert swing.contains(Point(300.0, 300.0))
    assert swing.bounds[1] >= -1e-6


def test_window_line_and_vertical_values_are_preserved() -> None:
    fixture = build_l_shaped_fixture()
    window = next(item for item in fixture.room.openings if item.kind is OpeningKind.WINDOW)
    line = opening_line(fixture.room, window)
    assert line.length == pytest.approx(1000.0)
    assert window.sill_height_mm == 900.0
    assert window.height.value == 900.0


def test_double_door_has_two_half_width_swing_envelopes() -> None:
    fixture = build_l_shaped_fixture()
    door = next(item for item in fixture.room.openings if item.kind is OpeningKind.DOOR)
    double_door = door.model_copy(update={"door_type": DoorType.DOUBLE})
    swing = door_swing_envelope(fixture.room, double_door)
    expected_area = 2 * (3.141592653589793 * (door.width.value / 2.0) ** 2 / 4.0)
    assert swing.area == pytest.approx(expected_area, rel=2e-3)
    assert swing.contains(Point(200.0, 200.0))
    assert swing.contains(Point(800.0, 200.0))


def test_opening_cannot_exceed_parent_wall() -> None:
    fixture = build_l_shaped_fixture()
    door = next(item for item in fixture.room.openings if item.kind is OpeningKind.DOOR)
    invalid = door.model_copy(update={"offset_mm": 3000.0})
    wall = wall_by_id(fixture.room, invalid.parent_wall_id)
    with pytest.raises(ValueError, match="exceeds parent wall"):
        opening_endpoints(invalid, wall)
