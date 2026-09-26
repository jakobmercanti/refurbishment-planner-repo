import pytest

from backend.app.commercial_entitlements import can_add_electrical_element


@pytest.mark.parametrize("count", range(5))
def test_free_project_can_add_electrical_objects_until_its_fifth(count: int) -> None:
    categories = ["electric"] * count
    assert can_add_electrical_element(5, categories)


def test_free_project_blocks_the_sixth_electrical_object() -> None:
    assert not can_add_electrical_element(5, ["electric"] * 5)


def test_other_categories_do_not_consume_the_electrical_allowance() -> None:
    categories = ["doors", "windows", "storage", "living-sofas"]
    assert can_add_electrical_element(1, categories)


def test_the_allowance_is_calculated_from_one_project_at_a_time() -> None:
    project_at_limit = ["electric"] * 5
    separate_project = ["electric"] * 4
    assert not can_add_electrical_element(5, project_at_limit)
    assert can_add_electrical_element(5, separate_project)


def test_deleting_an_electrical_object_releases_its_project_slot() -> None:
    categories = ["electric"] * 5
    categories.remove("electric")
    assert can_add_electrical_element(5, categories)


def test_downgraded_over_limit_project_is_preserved_and_only_additions_are_blocked() -> None:
    existing_project_categories = ["electric"] * 7
    before = existing_project_categories.copy()

    assert not can_add_electrical_element(5, existing_project_categories)
    assert existing_project_categories == before


@pytest.mark.parametrize("paid_plan", ["starter", "pro", "studio", "future-paid-tier"])
def test_any_paid_plan_uses_none_for_unlimited_electrical_objects(paid_plan: str) -> None:
    del paid_plan  # The entitlement is plan-configured, not tied to tier names.
    assert can_add_electrical_element(None, ["electric"] * 1000)


@pytest.mark.parametrize("invalid_limit", [-1, 1.5, True])
def test_invalid_electrical_limits_are_rejected(invalid_limit: object) -> None:
    with pytest.raises(ValueError, match="non-negative integer or None"):
        can_add_electrical_element(invalid_limit, [])  # type: ignore[arg-type]
