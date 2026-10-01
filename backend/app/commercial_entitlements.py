"""Pure plan-entitlement decisions for licensed planner modules."""

ACTIVE_SUBSCRIPTION_STATES = frozenset({"active", "trialing"})
PLAN_RANKS = {"free": 0, "starter": 1, "pro": 2, "studio": 3}


def can_use_electrical_layout(plan_key: object, status: object) -> bool:
    """Electrical Layout is a paid module; item catalogue access is not gated."""
    return (
        isinstance(plan_key, str)
        and bool(plan_key.strip())
        and plan_key.strip().casefold() != "free"
        and isinstance(status, str)
        and status in ACTIVE_SUBSCRIPTION_STATES
    )


def can_use_planner_build(plan_key: object, status: object) -> bool:
    """The full PlannerBuild project-planning module requires Studio or higher."""
    if not isinstance(plan_key, str) or not isinstance(status, str):
        return False
    if status not in ACTIVE_SUBSCRIPTION_STATES:
        return False
    # Unknown plan keys fail closed until they are assigned a tier in PLAN_RANKS.
    return PLAN_RANKS.get(plan_key.strip().casefold(), -1) >= PLAN_RANKS["studio"]
