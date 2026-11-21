-- Privacy preferences survive payload expiry and apply across every device.
begin;
create table public.planner_privacy_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  recovery_enabled boolean not null,
  updated_at timestamptz not null default now()
);
alter table public.planner_privacy_settings enable row level security;
revoke all on public.planner_privacy_settings from public, anon, authenticated;
grant select, insert, update, delete on public.planner_privacy_settings to service_role;

create function public.get_planner_resume(p_user_id uuid) returns jsonb
language sql security definer set search_path = '' as $$
  select jsonb_build_object(
    'enabled',coalesce((select recovery_enabled from public.planner_privacy_settings where user_id=p_user_id),true),
    'resume',(select jsonb_build_object('document',document,'revision',revision,'updated_at',updated_at)
              from public.planner_resume where user_id=p_user_id and expires_at>now())
  );
$$;
create function public.set_planner_resume_preference(p_user_id uuid,p_enabled boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 91021));
  insert into public.planner_privacy_settings(user_id,recovery_enabled) values(p_user_id,p_enabled)
  on conflict(user_id) do update set recovery_enabled=excluded.recovery_enabled,updated_at=now();
end;
$$;
create or replace function public.save_planner_resume(p_user_id uuid,p_document jsonb,p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved public.planner_resume;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 91021));
  if exists(select 1 from public.planner_privacy_settings where user_id=p_user_id and not recovery_enabled) then
    return jsonb_build_object('status','disabled');
  end if;
  select * into saved from public.planner_resume where user_id=p_user_id for update;
  if saved.user_id is not null and saved.expires_at<=now() then
    delete from public.planner_resume where user_id=p_user_id;
    saved:=null;
  end if;
  if saved.revision is distinct from p_expected_revision then
    return jsonb_build_object('status','conflict');
  end if;
  insert into public.planner_resume(user_id,document,revision)
  values(p_user_id,p_document,coalesce(saved.revision,0)+1)
  on conflict(user_id) do update set document=excluded.document,revision=excluded.revision,
    updated_at=now(),expires_at=now()+interval '180 days'
  returning * into saved;
  return jsonb_build_object('revision',saved.revision);
end;
$$;
create or replace function public.delete_planner_resume(p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 91021));
  insert into public.planner_privacy_settings(user_id,recovery_enabled) values(p_user_id,false)
  on conflict(user_id) do update set recovery_enabled=false,updated_at=now();
  insert into public.planner_resume(user_id,document,revision) values(p_user_id,null,1)
  on conflict(user_id) do update set document=null,revision=public.planner_resume.revision+1,
    updated_at=now(),expires_at=now()+interval '180 days';
end;
$$;
revoke all on function public.get_planner_resume(uuid),public.set_planner_resume_preference(uuid,boolean),
  public.save_planner_resume(uuid,jsonb,bigint),public.delete_planner_resume(uuid) from public,anon,authenticated;
grant execute on function public.get_planner_resume(uuid),public.set_planner_resume_preference(uuid,boolean),
  public.save_planner_resume(uuid,jsonb,bigint),public.delete_planner_resume(uuid) to service_role;
commit;
