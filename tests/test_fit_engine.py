from __future__ import annotations

from uuid import UUID

import pytest

from geometry.engine import check_fit
from geometry.fixtures import build_l_shaped_fixture, measured
from geometry.models import CheckStatus, FitStatus, Placement, Point2D, SourceType


@pytest.mark.parametrize(
    ("placement_name", "expected"),
    [("FIT", FitStatus.FIT), ("VERIFY", FitStatus.VERIFY), ("FAIL", FitStatus.FAIL)],
)
def test_mandatory_three_fit_outcomes(placement_name: str, expected: FitStatus) -> None:
    fixture = build_l_shaped_fixture()
    result = check_fit(fixture.room, fixture.product, fixture.placements[placement_name])
    assert result.status is expected
    assert result.summary.startswith(expected.value)


def test_verify_explains_uncertain_installation_width_numerically() -> None:
    fixture = build_l_shaped_fixture()
    result = check_fit(fixture.room, fixture.product, fixture.placements["VERIFY"])
    check = next(item for item in result.checks if item.check_id == "installation-adjustment-range")
    assert check.status is CheckStatus.VERIFY
    assert "1207.0 ± 12.0 mm" in check.explanation
    assert "1195.0–1205.0 mm" in check.explanation
    assert result.manual_measurements_required == ["Measure the finished wall-to-wall installation opening manually."]


def test_fail_identifies_vanity_collision() -> None:
    fixture = build_l_shaped_fixture()
    result = check_fit(fixture.room, fixture.product, fixture.placements["FAIL"])
    collision = next(item for item in result.collisions if item.object_id == "vanity-001")
    assert collision.overlap_area_mm2 > 0
    assert any("Existing vanity" in item.explanation for item in result.checks)


def test_product_partly_outside_room_fails_containment() -> None:
    fixture = build_l_shaped_fixture()
    placement = fixture.placements["FIT"].model_copy(update={"center": Point2D(x=3150.0, y=900.0)})
    result = check_fit(fixture.room, fixture.product, placement)
    check = next(item for item in result.checks if item.check_id == "room-boundary-containment")
    assert check.status is CheckStatus.FAIL
    assert "beyond" in check.explanation


def test_disallowed_rotation_fails_explicitly() -> None:
    fixture = build_l_shaped_fixture()
    placement = fixture.placements["FIT"].model_copy(update={"rotation_deg": 45.0})
    result = check_fit(fixture.room, fixture.product, placement)
    check = next(item for item in result.checks if item.check_id == "orientation-rule")
    assert check.status is CheckStatus.FAIL
    assert "45.0°" in check.explanation


def test_door_swing_collision_is_detected() -> None:
    fixture = build_l_shaped_fixture()
    placement = Placement(
        id=UUID("00000000-0000-0000-0000-000000000399"),
        product_id=fixture.product.id,
        center=Point2D(x=700.0, y=500.0),
        rotation_deg=0.0,
        available_installation_width=measured(1200.0, 1.0),
    )
    result = check_fit(fixture.room, fixture.product, placement)
    door_check = next(item for item in result.checks if item.check_id == "door-swing:door-001")
    assert door_check.status is CheckStatus.FAIL
    assert any(item.collision_type == "door-swing" for item in result.collisions)


def test_clear_installation_width_interval_passes_at_boundaries() -> None:
    fixture = build_l_shaped_fixture()
    placement = fixture.placements["FIT"].model_copy(update={"available_installation_width": measured(1200.0, 5.0)})
    result = check_fit(fixture.room, fixture.product, placement)
    check = next(item for item in result.checks if item.check_id == "installation-adjustment-range")
    assert check.status is CheckStatus.PASS
    assert check.margin_mm == pytest.approx(0.0)


def test_clear_fail_when_uncertainty_interval_is_disjoint() -> None:
    fixture = build_l_shaped_fixture()
    too_small = measured(1180.0, 2.0).model_copy(update={"source_type": SourceType.USER_MEASURED})
    placement = fixture.placements["FIT"].model_copy(update={"available_installation_width": too_small})
    result = check_fit(fixture.room, fixture.product, placement)
    check = next(item for item in result.checks if item.check_id == "installation-adjustment-range")
    assert check.status is CheckStatus.FAIL


def test_result_records_exact_versions_and_engine_input() -> None:
    fixture = build_l_shaped_fixture()
    result = check_fit(fixture.room, fixture.product, fixture.placements["FIT"])
    assert result.room_version == fixture.room.version
    assert result.product_version == fixture.product.version
    assert result.placement == fixture.placements["FIT"]
    assert result.engine_version == "0.1.0"
