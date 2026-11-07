begin;

create schema if not exists planner_security;
revoke all on schema planner_security from public, anon, authenticated;

create table if not exists planner_security.password_attempts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  failures smallint not null check (failures between 0 and 5),
  expires_at timestamptz not null
);
alter table planner_security.password_attempts enable row level security;
revoke all on planner_security.password_attempts from public, anon, authenticated;
grant usage on schema planner_security to supabase_auth_admin;
grant select, insert, update, delete on planner_security.password_attempts to supabase_auth_admin;
drop policy if exists password_hook_only on planner_security.password_attempts;
create policy password_hook_only on planner_security.password_attempts
  to supabase_auth_admin using (true) with check (true);

-- Register this hook in Supabase Auth to enforce the same ceiling on direct
-- provider requests. No password, email address or IP is stored here.
create or replace function public.planner_password_verification(event jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  account_id uuid := (event->>'user_id')::uuid;
  password_valid boolean := (event->>'valid')::boolean;
  state planner_security.password_attempts%rowtype;
  checked_at timestamptz;
begin
  if account_id is null or password_valid is null then
    raise exception 'Invalid password verification event';
  end if;

  -- Serialize the provider's verified attempts for the same user. Inserting
  -- a row before taking its lock also handles concurrent first attempts.
  insert into planner_security.password_attempts (user_id, failures, expires_at)
  values (account_id, 0, clock_timestamp()) on conflict (user_id) do nothing;
  select * into strict state from planner_security.password_attempts
    where user_id = account_id for update;
  checked_at := clock_timestamp();

  if state.failures = 5 and state.expires_at > checked_at then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 429, 'message', 'Too many sign-in attempts. Wait before trying again.'
    ));
  end if;

  if password_valid then
    -- Keep the row while resetting it so concurrent attempts can acquire it.
    update planner_security.password_attempts set failures = 0, expires_at = checked_at
      where user_id = account_id;
  else
    if state.expires_at <= checked_at then
      state.failures := 0;
      state.expires_at := checked_at + interval '15 minutes';
    end if;
    state.failures := state.failures + 1;
    if state.failures = 5 then
      state.expires_at := checked_at + interval '15 minutes';
    end if;
    update planner_security.password_attempts set failures = state.failures, expires_at = state.expires_at
      where user_id = account_id;
  end if;
  return jsonb_build_object('decision', 'continue');
end;
$$;

revoke all on function public.planner_password_verification(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.planner_password_verification(jsonb) to supabase_auth_admin;

commit;
