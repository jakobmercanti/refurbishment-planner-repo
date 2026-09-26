-- AI 3D generation stays behind a separately metered allowance. All plan
-- allowances default to zero until pricing and inclusion are approved.
alter table public.commercial_plans
  add column if not exists ai_3d_generations_per_period integer not null default 0
  check (ai_3d_generations_per_period >= 0);

alter table public.upload_reservations drop constraint if exists upload_reservations_purpose_check;
alter table public.upload_reservations add constraint upload_reservations_purpose_check
  check (purpose in ('asset', 'render-reference', 'ai-3d-reference'));
alter table public.upload_reservations drop constraint if exists upload_reservations_check;
alter table public.upload_reservations add constraint upload_reservations_check
  check ((purpose = 'asset' and asset_id is not null) or
         (purpose in ('render-reference', 'ai-3d-reference') and asset_id is null));

create table if not exists public.ai_3d_generation_jobs (
  generation_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  asset_id uuid not null unique references public.asset_definitions(asset_id) on delete cascade,
  asset_name text not null check (length(asset_name) between 1 and 200),
  declared_dimensions_mm jsonb not null check (
    case
      when jsonb_typeof(declared_dimensions_mm) = 'object' and
        jsonb_typeof(declared_dimensions_mm->'width') = 'number' and
        jsonb_typeof(declared_dimensions_mm->'depth') = 'number' and
        jsonb_typeof(declared_dimensions_mm->'height') = 'number'
      then (declared_dimensions_mm->>'width')::numeric between 1 and 10000 and
        (declared_dimensions_mm->>'depth')::numeric between 1 and 10000 and
        (declared_dimensions_mm->>'height')::numeric between 1 and 10000
      else false
    end
  ),
  reference_inputs jsonb not null check (
    case when jsonb_typeof(reference_inputs) = 'array'
      then jsonb_array_length(reference_inputs) between 0 and 3 else false end
  ),
  provider text not null default 'tripo',
  provider_model text not null,
  provider_task_id text,
  provider_usage jsonb not null default '{}'::jsonb check (jsonb_typeof(provider_usage) = 'object'),
  status text not null default 'queued' check (status in ('queued', 'submitting', 'generating', 'storing', 'succeeded', 'failed', 'cancelled')),
  progress integer not null default 0 check (progress between 0 and 100),
  retry_count integer not null default 0 check (retry_count between 0 and 3),
  safe_error text check (safe_error is null or length(safe_error) <= 500),
  idempotency_key text not null check (length(idempotency_key) between 8 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (user_id, generation_id),
  unique (user_id, idempotency_key)
);
create index if not exists ai_3d_generation_user_created_idx
  on public.ai_3d_generation_jobs(user_id, created_at desc);

create table if not exists public.ai_3d_generation_ledger (
  ledger_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  generation_id uuid not null references public.ai_3d_generation_jobs(generation_id) on delete cascade,
  quantity_delta integer not null check (quantity_delta <> 0),
  source_type text not null check (source_type in ('generation_reservation', 'generation_refund', 'admin_adjustment')),
  period_start timestamptz,
  period_end timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, source_type, generation_id)
);
create index if not exists ai_3d_generation_ledger_user_period_idx
  on public.ai_3d_generation_ledger(user_id, period_start, created_at);

alter table public.ai_3d_generation_jobs enable row level security;
alter table public.ai_3d_generation_ledger enable row level security;
revoke all on public.ai_3d_generation_jobs, public.ai_3d_generation_ledger from anon, authenticated;
grant all on public.ai_3d_generation_jobs, public.ai_3d_generation_ledger to service_role;

alter table public.commercial_jobs add column if not exists ai_generation_id uuid
  references public.ai_3d_generation_jobs(generation_id) on delete cascade;
alter table public.commercial_jobs drop constraint if exists commercial_jobs_job_type_check;
alter table public.commercial_jobs add constraint commercial_jobs_job_type_check
  check (job_type in ('process-asset', 'render', 'ai-3d-asset'));
alter table public.commercial_jobs drop constraint if exists commercial_jobs_check;
alter table public.commercial_jobs add constraint commercial_jobs_check
  check ((job_type = 'process-asset' and asset_id is not null and render_id is null and ai_generation_id is null) or
         (job_type = 'render' and render_id is not null and asset_id is null and ai_generation_id is null) or
         (job_type = 'ai-3d-asset' and ai_generation_id is not null and asset_id is null and render_id is null));

create or replace function public.ai_3d_generation_quota(p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare s public.commercial_subscriptions%rowtype; p public.commercial_plans%rowtype;
  v_allowance integer := 0; v_used integer := 0; v_remaining integer := 0;
begin
  select * into s from public.commercial_subscriptions
    where user_id=p_user_id and status in ('active','trialing')
      and (current_period_end is null or current_period_end >= now());
  if not found then
    return jsonb_build_object('enabled',false,'remaining',0,'allowance',0);
  end if;
  select * into p from public.commercial_plans where plan_key=s.plan_key and active;
  if not found then return jsonb_build_object('enabled',false,'remaining',0,'allowance',0); end if;
  v_allowance := p.ai_3d_generations_per_period;
  select coalesce(sum(quantity_delta),0)::integer into v_used
    from public.ai_3d_generation_ledger
    where user_id=p_user_id
      and coalesce(period_start,'epoch'::timestamptz)=coalesce(s.current_period_start,'epoch'::timestamptz)
      and source_type in ('generation_reservation','generation_refund','admin_adjustment');
  v_remaining := greatest(0,v_allowance+v_used);
  return jsonb_build_object('enabled',v_remaining>0,'remaining',v_remaining,'allowance',v_allowance);
end $$;

create or replace function public.reserve_ai_3d_reference(
  p_user_id uuid,p_reservation_id uuid,p_object_key text,p_content_type text,p_expected_bytes bigint
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_usage jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,0));
  if p_content_type not in ('image/png','image/jpeg','image/webp') or p_expected_bytes not between 1 and 10485760 or
     p_object_key not like 'temporary/ai-3d-references/'||p_user_id::text||'/%' then
    raise exception 'invalid_ai_3d_reference' using errcode='22023';
  end if;
  if not coalesce((public.ai_3d_generation_quota(p_user_id)->>'enabled')::boolean,false) then
    raise exception 'ai_3d_generation_unavailable' using errcode='54000';
  end if;
  if (select count(*) from public.upload_reservations where user_id=p_user_id and purpose='ai-3d-reference'
      and status='reserved' and expires_at>now()) >= 10 then
    raise exception 'ai_3d_upload_limit' using errcode='54000';
  end if;
  insert into public.upload_reservations(reservation_id,user_id,purpose,object_key,content_type,expected_byte_size,expires_at)
    values(p_reservation_id,p_user_id,'ai-3d-reference',p_object_key,p_content_type,p_expected_bytes,now()+interval '15 minutes');
  return jsonb_build_object('reservation_id',p_reservation_id,'expires_at',now()+interval '15 minutes');
end $$;

create or replace function public.create_ai_3d_generation_job(
  p_user_id uuid,p_generation_id uuid,p_asset_id uuid,p_asset_name text,p_dimensions_mm jsonb,
  p_references jsonb,p_idempotency_key text,p_provider_model text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.commercial_subscriptions%rowtype; p public.commercial_plans%rowtype;
  g public.ai_3d_generation_jobs%rowtype; a public.asset_definitions%rowtype; r public.upload_reservations%rowtype;
  v_usage jsonb; v_allowance integer; v_used integer; v_count integer; v_distinct integer;
  v_resolved jsonb := '[]'::jsonb; v_item jsonb; v_ref_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,0));
  select * into g from public.ai_3d_generation_jobs where user_id=p_user_id and idempotency_key=p_idempotency_key;
  if found then return jsonb_build_object('status','existing','generation',to_jsonb(g)); end if;
  select * into s from public.commercial_subscriptions where user_id=p_user_id and status in ('active','trialing')
    and (current_period_end is null or current_period_end>=now());
  if not found then raise exception 'ai_3d_generation_unavailable' using errcode='54000'; end if;
  select * into p from public.commercial_plans where plan_key=s.plan_key and active for update;
  if not found then raise exception 'ai_3d_generation_unavailable' using errcode='54000'; end if;
  v_allowance:=p.ai_3d_generations_per_period;
  select coalesce(sum(quantity_delta),0)::integer into v_used from public.ai_3d_generation_ledger
    where user_id=p_user_id and coalesce(period_start,'epoch'::timestamptz)=coalesce(s.current_period_start,'epoch'::timestamptz)
      and source_type in ('generation_reservation','generation_refund','admin_adjustment');
  if v_allowance+v_used <= 0 then raise exception 'ai_3d_quota_exceeded' using errcode='54000'; end if;
  if case
       when jsonb_typeof(p_dimensions_mm)='object' and
         jsonb_typeof(p_dimensions_mm->'width')='number' and
         jsonb_typeof(p_dimensions_mm->'depth')='number' and
         jsonb_typeof(p_dimensions_mm->'height')='number'
       then (p_dimensions_mm->>'width')::numeric between 1 and 10000 and
         (p_dimensions_mm->>'depth')::numeric between 1 and 10000 and
         (p_dimensions_mm->>'height')::numeric between 1 and 10000
       else false
     end is not true or
     p_asset_name is null or length(trim(p_asset_name)) not between 1 and 200 or
     p_provider_model is null or length(p_provider_model) not between 1 and 100 or
     p_idempotency_key is null or length(p_idempotency_key) not between 8 and 200 then
    raise exception 'invalid_ai_3d_request' using errcode='22023';
  end if;
  if case when jsonb_typeof(p_references)='array'
    then jsonb_array_length(p_references) between 1 and 3 else false end is not true then
    raise exception 'invalid_ai_3d_reference' using errcode='22023';
  end if;
  select count(*),count(distinct value->>'view') into v_count,v_distinct
    from jsonb_array_elements(p_references) as refs(value);
  if v_count<>v_distinct or exists(select 1 from jsonb_array_elements(p_references) refs(value)
      where jsonb_typeof(value)<>'object' or value->>'view' not in ('front','left','right','back') or value->>'reservation_id' is null) or
      not exists(select 1 from jsonb_array_elements(p_references) refs(value) where value->>'view'='front') then
    raise exception 'invalid_ai_3d_reference' using errcode='22023';
  end if;
  v_usage:=public.commercial_usage(p_user_id);
  if coalesce((v_usage->>'assets')::integer,0)>=p.asset_limit then raise exception 'asset_quota_exceeded' using errcode='54000'; end if;
  for v_item in select value from jsonb_array_elements(p_references) as refs(value) loop
    v_ref_id:=(v_item->>'reservation_id')::uuid;
    select * into r from public.upload_reservations where reservation_id=v_ref_id and user_id=p_user_id
      and purpose='ai-3d-reference' and status='reserved' and expires_at>=now() for update;
    if not found or r.object_key not like 'temporary/ai-3d-references/'||p_user_id::text||'/%' or
       r.content_type not in ('image/png','image/jpeg','image/webp') or r.expected_byte_size>10485760 then
      raise exception 'ai_3d_reference_missing' using errcode='P0002';
    end if;
    v_resolved:=v_resolved||jsonb_build_array(jsonb_build_object(
      'object_key',r.object_key,'content_type',r.content_type,'expected_byte_size',r.expected_byte_size,'view',v_item->>'view'));
    update public.upload_reservations set status='consumed' where reservation_id=r.reservation_id;
  end loop;
  insert into public.asset_definitions(asset_id,user_id,name,original_format,original_object_key,declared_dimensions_mm,geometry_authority,processing_status)
    values(p_asset_id,p_user_id,trim(p_asset_name),'glb',
      'users/'||p_user_id::text||'/assets/'||p_asset_id::text||'/original/generated.glb',
      p_dimensions_mm,'visual-only','queued') returning * into a;
  insert into public.ai_3d_generation_jobs(generation_id,user_id,asset_id,asset_name,declared_dimensions_mm,reference_inputs,
    provider_model,status,progress,idempotency_key)
    values(p_generation_id,p_user_id,p_asset_id,trim(p_asset_name),p_dimensions_mm,v_resolved,p_provider_model,'queued',0,p_idempotency_key)
    returning * into g;
  insert into public.ai_3d_generation_ledger(user_id,generation_id,quantity_delta,source_type,period_start,period_end)
    values(p_user_id,p_generation_id,-1,'generation_reservation',s.current_period_start,s.current_period_end);
  insert into public.commercial_jobs(user_id,job_type,ai_generation_id)
    values(p_user_id,'ai-3d-asset',p_generation_id);
  return jsonb_build_object('status','created','generation',to_jsonb(g),'asset',to_jsonb(a));
end $$;

create or replace function public.finish_ai_3d_generation(
  p_user_id uuid,p_generation_id uuid,p_status text,p_original_bytes bigint,p_derived_bytes bigint,
  p_triangles bigint,p_bounds jsonb,p_provider_usage jsonb,p_error text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare g public.ai_3d_generation_jobs%rowtype; a public.asset_definitions%rowtype;
  p public.commercial_plans%rowtype; u jsonb; v_error text; v_status text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,0));
  select * into g from public.ai_3d_generation_jobs where generation_id=p_generation_id and user_id=p_user_id for update;
  if not found or g.status in ('succeeded','failed','cancelled') then return jsonb_build_object('status','ignored'); end if;
  select * into a from public.asset_definitions where asset_id=g.asset_id and user_id=p_user_id for update;
  v_error:=p_error;
  if v_error is null and p_status='succeeded' then
    if p_original_bytes not between 0 and 52428800 or p_derived_bytes not between 20 and 52428800 or
       p_triangles not between 1 and 2000000 or case
         when jsonb_typeof(p_bounds)='object' and jsonb_typeof(p_bounds->'x')='number' and
           jsonb_typeof(p_bounds->'y')='number' and jsonb_typeof(p_bounds->'z')='number'
         then (p_bounds->>'x')::numeric>0 and (p_bounds->>'y')::numeric>0 and (p_bounds->>'z')::numeric>0
         else false end is not true then
      v_error:='The generated model did not pass the supported size and geometry checks.';
    else
      select * into p from public.commercial_plans where plan_key=(select plan_key from public.commercial_subscriptions
        where user_id=p_user_id and status in ('active','trialing') and (current_period_end is null or current_period_end>=now())) and active;
      if not found then v_error:='An active subscription is required to save generated assets.';
      else
        u:=public.commercial_usage(p_user_id);
        if coalesce((u->>'storage_bytes')::bigint,0)+p_original_bytes+p_derived_bytes>p.storage_limit_bytes then
          v_error:='The generated model exceeds the available storage allowance.';
        end if;
      end if;
    end if;
  elsif v_error is null then
    v_error:='The generation did not complete successfully.';
  end if;
  if v_error is null then
    update public.asset_definitions set original_byte_size=p_original_bytes,derived_byte_size=p_derived_bytes,
      original_object_key='users/'||p_user_id::text||'/assets/'||g.asset_id::text||'/derived/model.glb',
      derived_object_key='users/'||p_user_id::text||'/assets/'||g.asset_id::text||'/derived/model.glb',
      thumbnail_object_key='users/'||p_user_id::text||'/assets/'||g.asset_id::text||'/derived/thumbnail.png',
      triangle_count=p_triangles,computed_bounds_mm=p_bounds,geometry_authority='visual-only',
      processing_status='ready',processing_error=null,updated_at=now()
      where asset_id=g.asset_id and user_id=p_user_id returning * into a;
    update public.ai_3d_generation_jobs set status='succeeded',progress=100,
      provider_usage=case when jsonb_typeof(p_provider_usage)='object' then p_provider_usage else '{}'::jsonb end,
      reference_inputs='[]'::jsonb,safe_error=null,completed_at=now(),updated_at=now()
      where generation_id=p_generation_id and user_id=p_user_id returning * into g;
    update public.commercial_jobs set status='succeeded',locked_at=null,locked_by=null
      where ai_generation_id=p_generation_id and user_id=p_user_id and status='processing';
    v_status:='succeeded';
  else
    update public.asset_definitions set processing_status='failed',processing_error=left(v_error,500),updated_at=now()
      where asset_id=g.asset_id and user_id=p_user_id returning * into a;
    update public.ai_3d_generation_jobs set status='failed',safe_error=left(v_error,500),reference_inputs='[]'::jsonb,
      completed_at=now(),updated_at=now() where generation_id=p_generation_id and user_id=p_user_id returning * into g;
      insert into public.ai_3d_generation_ledger
        (user_id,generation_id,quantity_delta,source_type,period_start,period_end)
        select user_id,generation_id,1,'generation_refund',period_start,period_end
          from public.ai_3d_generation_ledger
          where user_id=p_user_id and generation_id=p_generation_id and source_type='generation_reservation'
        on conflict (user_id,source_type,generation_id) do nothing;
    update public.commercial_jobs set status='failed',last_error=left(v_error,500),locked_at=null,locked_by=null
      where ai_generation_id=p_generation_id and user_id=p_user_id and status='processing';
    v_status:='failed';
  end if;
  return jsonb_build_object('status',v_status,'generation',to_jsonb(g),'asset',to_jsonb(a));
end $$;

create or replace function public.claim_commercial_job(p_worker_id text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare j public.commercial_jobs%rowtype; exhausted public.commercial_jobs%rowtype;
begin
  for exhausted in select * from public.commercial_jobs
    where status='processing' and locked_at < now()-interval '10 minutes' and attempts >= 5
    order by created_at for update skip locked
  loop
    if exhausted.job_type='render' then
      perform public.finish_render_job(exhausted.user_id,exhausted.render_id,0,'{}'::jsonb,'The render worker exceeded its retry limit.');
    elsif exhausted.job_type='ai-3d-asset' then
      perform public.finish_ai_3d_generation(exhausted.user_id,exhausted.ai_generation_id,'failed',0,0,0,'{}'::jsonb,'{}'::jsonb,'The 3D generation worker exceeded its retry limit.');
    else
      perform public.finish_asset_processing(exhausted.user_id,exhausted.asset_id,'failed',null,null,0,0,'{}'::jsonb,'The asset worker exceeded its retry limit.');
    end if;
  end loop;
  with candidate as (
    select job_id from public.commercial_jobs where
      (status='queued' and available_at<=now()) or
      (status='processing' and locked_at < now()-interval '10 minutes' and attempts < 5)
    order by available_at,created_at for update skip locked limit 1
  )
  update public.commercial_jobs q set status='processing',attempts=q.attempts+1,locked_at=now(),locked_by=p_worker_id
    from candidate where q.job_id=candidate.job_id returning q.* into j;
  if not found then return null; end if;
  return to_jsonb(j) || jsonb_build_object(
    'asset', case when j.asset_id is null then null else (select to_jsonb(a) from public.asset_definitions a where a.asset_id=j.asset_id and a.user_id=j.user_id) end,
    'render', case when j.render_id is null then null else (select to_jsonb(r) from public.render_jobs r where r.render_id=j.render_id and r.user_id=j.user_id) end,
    'generation', case when j.ai_generation_id is null then null else (select to_jsonb(g) from public.ai_3d_generation_jobs g where g.generation_id=j.ai_generation_id and g.user_id=j.user_id) end
  );
end $$;

revoke all on function public.ai_3d_generation_quota(uuid),
  public.reserve_ai_3d_reference(uuid,uuid,text,text,bigint),
  public.create_ai_3d_generation_job(uuid,uuid,uuid,text,jsonb,jsonb,text,text),
  public.finish_ai_3d_generation(uuid,uuid,text,bigint,bigint,bigint,jsonb,jsonb,text),
  public.claim_commercial_job(text) from public, anon, authenticated;
grant execute on function public.ai_3d_generation_quota(uuid),
  public.reserve_ai_3d_reference(uuid,uuid,text,text,bigint),
  public.create_ai_3d_generation_job(uuid,uuid,uuid,text,jsonb,jsonb,text,text),
  public.finish_ai_3d_generation(uuid,uuid,text,bigint,bigint,bigint,jsonb,jsonb,text),
  public.claim_commercial_job(text) to service_role;
