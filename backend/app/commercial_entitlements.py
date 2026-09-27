"""Pure plan-entitlement decisions for paid planner modules."""

ACTIVE_SUBSCRIPTION_STATES = frozenset({"active", "trialing"})


def can_use_electrical_layout(plan_key: object, status: object) -> bool:
    """Electrical Layout is a paid module; item catalogue access is not gated."""
    return (
        isinstance(plan_key, str)
        and bool(plan_key.strip())
        and plan_key.strip().casefold() != "free"
        and isinstance(status, str)
        and status in ACTIVE_SUBSCRIPTION_STATES
    )
