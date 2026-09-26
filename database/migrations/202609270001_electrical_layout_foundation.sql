-- Future Electrical Layout entitlement foundation; no project data is changed.
alter table public.commercial_plans
  add column if not exists max_electrical_elements_per_project integer;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.commercial_plans'::regclass
      and conname = 'commercial_plans_electrical_limit_nonnegative'
  ) then
    alter table public.commercial_plans
      add constraint commercial_plans_electrical_limit_nonnegative
      check (max_electrical_elements_per_project is null or max_electrical_elements_per_project >= 0);
  end if;
end $$;

-- Null is the existing-capability representation for unlimited paid plans.
-- New non-free plans also default to unlimited unless explicitly configured.
update public.commercial_plans
set max_electrical_elements_per_project = case when plan_key = 'free' then 5 else null end;
