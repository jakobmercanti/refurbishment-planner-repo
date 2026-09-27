-- Electrical fittings remain part of the standard catalogue on every plan.
-- The dedicated Electrical Layout workspace is gated by the effective paid
-- subscription in /commercial/summary, so no per-project item limit is needed.
alter table public.commercial_plans
  drop constraint if exists commercial_plans_electrical_limit_nonnegative;

alter table public.commercial_plans
  drop column if exists max_electrical_elements_per_project;
