"""Pure entitlement decisions shared by future project-placement flows."""

from collections.abc import Iterable

ELECTRIC_CATEGORY_ID = "electric"


def can_add_electrical_element(
    max_electrical_elements_per_project: int | None,
    project_element_category_ids: Iterable[str],
) -> bool:
    """Return whether this project may add one more Electric-category object.

    Callers provide category IDs for placed objects in the current project only.
    Re-counting on every decision means deleting an object frees its slot, while
    an over-limit project after downgrade remains unchanged and blocks additions.
    ``None`` is the shared database convention for an unlimited allowance.
    """
    if max_electrical_elements_per_project is not None and (
        type(max_electrical_elements_per_project) is not int
        or max_electrical_elements_per_project < 0
    ):
        raise ValueError("The electrical element limit must be a non-negative integer or None.")

    electrical_count = sum(category_id == ELECTRIC_CATEGORY_ID for category_id in project_element_category_ids)
    return max_electrical_elements_per_project is None or electrical_count < max_electrical_elements_per_project
