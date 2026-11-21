-- One private recovery document per verified account, independent of paid project storage.
begin;
create table public.planner_resume (
  user_id uuid primary key references auth.users(id) on delete cascade,
  document jsonb check (octet_length(document::text) <= 8388608),
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '180 days')
);
alter table public.planner_resume enable row level security;
revoke all on public.planner_resume from public, anon, authenticated;
grant select, insert, update, delete on public.planner_resume to service_role;

create function public.save_planner_resume(p_user_id uuid, p_document jsonb, p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved public.planner_resume;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 91021));
  select * into saved from public.planner_resume where user_id = p_user_id for update;
  if saved.user_id is not null and saved.expires_at <= now() then
    delete from public.planner_resume where user_id = p_user_id;
    saved := null;
  end if;
  if saved.revision is distinct from p_expected_revision then
    return jsonb_build_object('status','conflict');
  end if;
  insert into public.planner_resume (user_id,document,revision)
  values (p_user_id,p_document,coalesce(saved.revision,0)+1)
  on conflict (user_id) do update set document=excluded.document,
    revision=excluded.revision,updated_at=now(),expires_at=now()+interval '180 days'
  returning * into saved;
  return jsonb_build_object('revision',saved.revision);
end;
revoke all on function public.save_planner_resume(uuid,jsonb,bigint) from public, anon, authenticated;
grant execute on function public.save_planner_resume(uuid,jsonb,bigint) to service_role;

-- Erase the payload immediately; keep a revision tombstone so an in-flight
-- save from another tab cannot resurrect the deleted setup.
create function public.delete_planner_resume(p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 91021));
  insert into public.planner_resume (user_id,document,revision) values (p_user_id,null,1)
  on conflict (user_id) do update set document=null,
    revision=public.planner_resume.revision+1,updated_at=now(),expires_at=now()+interval '180 days';
end;
$$;
revoke all on function public.delete_planner_resume(uuid) from public, anon, authenticated;
grant execute on function public.delete_planner_resume(uuid) to service_role;

-- Call daily from the privileged retention job; expiry also prevents reads/restoration.
create function public.purge_planner_resume() returns void
language sql security definer set search_path = '' as $$
  delete from public.planner_resume where expires_at <= now();
$$;
revoke all on function public.purge_planner_resume() from public, anon, authenticated;
grant execute on function public.purge_planner_resume() to service_role;
create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('purge-planner-resume','17 3 * * *','select public.purge_planner_resume()');
commit;
