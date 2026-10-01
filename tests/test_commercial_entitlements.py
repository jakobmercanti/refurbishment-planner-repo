import pytest

from backend.app.commercial_entitlements import can_use_electrical_layout, can_use_planner_build


@pytest.mark.parametrize(("plan", "status", "allowed"), [
    ("free", "free", False),
    ("starter", "active", True),
    ("pro", "active", True),
    ("studio", "active", True),
    ("future-paid-tier", "active", True),
    ("pro", "trialing", True),
    ("pro", "canceled", False),
    ("free", "active", False),
])
def test_electrical_layout_is_available_only_with_an_active_paid_plan(
    plan: str, status: str, allowed: bool,
) -> None:
    assert can_use_electrical_layout(plan, status) is allowed


def test_malformed_entitlement_values_fail_closed() -> None:
    assert not can_use_electrical_layout([], "active")
    assert not can_use_electrical_layout("starter", None)


@pytest.mark.parametrize(("plan", "status", "allowed"), [
    ("free", "free", False),
    ("starter", "active", False),
    ("pro", "active", False),
    ("studio", "active", True),
    ("studio", "trialing", True),
    ("studio", "canceled", False),
    ("future-higher-tier", "active", False),
    ("studio", None, False),
])
def test_full_planner_build_requires_active_studio_tier_or_higher(
    plan: str, status: str, allowed: bool,
) -> None:
    assert can_use_planner_build(plan, status) is allowed


def test_planner_build_entitlement_fails_closed_for_malformed_plan() -> None:
    assert not can_use_planner_build([], "active")
