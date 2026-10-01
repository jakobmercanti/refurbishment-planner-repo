-- Phase 2 commercial workspace. Apply to the Supabase project before enabling
-- commercial API credentials. Binary payloads remain in private R2 storage.

create table if not exists public.commercial_plans (
  plan_key text primary key check (plan_key in ('free', 'starter', 'pro', 'studio')),
  name text not null,
  monthly_price_pence integer not null check (monthly_price_pence >= 0),
  storage_limit_bytes bigint not null check (storage_limit_bytes >= 0),
  asset_limit integer not null check (asset_limit >= 0),
  project_limit integer not null check (project_limit >= 0),
  included_medium integer not null check (included_medium >= 0),
  included_high integer not null check (included_high >= 0),
  active boolean not null default true
);

insert into public.commercial_plans
  (plan_key, name, monthly_price_pence, storage_limit_bytes, asset_limit, project_limit, included_medium, included_high)
values
  ('free', 'Free', 0, 0, 0, 0, 0, 0),
  ('starter', 'Starter', 990, 10737418240, 100, 50, 10, 0),
  ('pro', 'Pro', 1999, 53687091200, 500, 250, 30, 5),
  ('studio', 'Studio', 2999, 107374182400, 1000, 1000, 60, 15)
on conflict (plan_key) do update set
  name = excluded.name,
  monthly_price_pence = excluded.monthly_price_pence,
  storage_limit_bytes = excluded.storage_limit_bytes,
  asset_limit = excluded.asset_limit,
  project_limit = excluded.project_limit,
  included_medium = excluded.included_medium,
  included_high = excluded.included_high;

create table if not exists public.render_credit_packs (
  pack_key text primary key,
  quality_class text not null check (quality_class in ('medium', 'high')),
  quantity integer not null check (quantity > 0),
  price_pence integer not null check (price_pence > 0),
  active boolean not null default true
);

insert into public.render_credit_packs (pack_key, quality_class, quantity, price_pence)
values
  ('medium_1', 'medium', 1, 50), ('medium_10', 'medium', 10, 449),
  ('medium_50', 'medium', 50, 1999), ('medium_100', 'medium', 100, 3499),
  ('high_1', 'high', 1, 99), ('high_10', 'high', 10, 899),
  ('high_50', 'high', 50, 3999), ('high_100', 'high', 100, 6999)
on conflict (pack_key) do update set
  quality_class = excluded.quality_class, quantity = excluded.quantity, price_pence = excluded.price_pence;

create table if not exists public.commercial_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text check (display_name is null or length(display_name) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.create_commercial_profile()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.commercial_profiles(user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created_commercial_profile on auth.users;
create trigger on_auth_user_created_commercial_profile
  after insert on auth.users for each row execute function public.create_commercial_profile();

create table if not exists public.commercial_subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  plan_key text not null references public.commercial_plans(plan_key),
  status text not null check (status in ('incomplete', 'trialing', 'active', 'past_due', 'unpaid', 'canceled', 'paused')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  last_stripe_event_created bigint not null default 0 check (last_stripe_event_created >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.cloud_projects (
  project_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  schema_version integer not null check (schema_version > 0),
  title text not null check (length(title) between 1 and 200),
  project_json jsonb not null check (jsonb_typeof(project_json) = 'object'),
  revision bigint not null default 1 check (revision > 0),
  byte_size bigint not null default 0 check (byte_size >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (user_id, project_id)
);
create index if not exists cloud_projects_user_updated_idx on public.cloud_projects(user_id, updated_at desc) where deleted_at is null;

create table if not exists public.asset_definitions (
  asset_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  local_asset_key text check (local_asset_key is null or local_asset_key ~ '^local-[a-f0-9]{64}$'),
  name text not null check (length(name) between 1 and 200),
  original_format text not null check (original_format in ('glb', 'stl')),
  content_hash text check (content_hash is null or content_hash ~ '^[a-f0-9]{64}$'),
  original_object_key text not null unique,
  derived_object_key text,
  thumbnail_object_key text,
  original_byte_size bigint not null default 0 check (original_byte_size >= 0),
  derived_byte_size bigint not null default 0 check (derived_byte_size >= 0),
  triangle_count bigint check (triangle_count is null or triangle_count between 0 and 2000000),
  computed_bounds_mm jsonb,
  declared_dimensions_mm jsonb,
  source_unit text check (source_unit is null or source_unit in ('mm', 'cm', 'in')),
  geometry_authority text not null default 'visual-only' check (geometry_authority in ('visual-only', 'user-verified')),
  processing_status text not null default 'uploading' check (processing_status in ('uploading', 'queued', 'processing', 'ready', 'failed', 'deleted')),
  processing_error text check (processing_error is null or length(processing_error) <= 500),
  objects_deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, asset_id)
);
alter table public.asset_definitions add column if not exists objects_deleted_at timestamptz;
create unique index if not exists asset_definitions_user_hash_idx
  on public.asset_definitions(user_id, content_hash) where content_hash is not null and processing_status <> 'deleted';
create unique index if not exists asset_definitions_user_local_key_idx
  on public.asset_definitions(user_id, local_asset_key) where local_asset_key is not null and processing_status <> 'deleted';
create index if not exists asset_definitions_user_created_idx on public.asset_definitions(user_id, created_at desc) where processing_status <> 'deleted';

create table if not exists public.upload_reservations (
  reservation_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  purpose text not null check (purpose in ('asset', 'render-reference')),
  asset_id uuid references public.asset_definitions(asset_id) on delete cascade,
  object_key text not null unique,
  content_type text not null,
  expected_byte_size bigint not null check (expected_byte_size between 1 and 104857600),
  status text not null default 'reserved' check (status in ('reserved', 'uploaded', 'consumed', 'expired', 'rejected')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (user_id, reservation_id),
  check ((purpose = 'asset' and asset_id is not null) or (purpose = 'render-reference' and asset_id is null))
);
create index if not exists upload_reservations_expiry_idx on public.upload_reservations(expires_at) where status = 'reserved';

create table if not exists public.render_jobs (
  render_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid,
  quality_class text not null check (quality_class in ('medium', 'high')),
  provider text not null default 'openai',
  provider_model text not null,
  provider_quality text not null check (provider_quality in ('medium', 'high')),
  requested_size text not null,
  reference_object_key text not null,
  output_object_key text not null unique,
  output_byte_size bigint not null default 0 check (output_byte_size >= 0),
  prompt text not null default '' check (length(prompt) <= 1000),
  status text not null default 'queued' check (status in ('queued', 'processing', 'succeeded', 'failed', 'cancelled')),
  reserved_credit_source text check (reserved_credit_source is null or reserved_credit_source in ('included', 'purchased')),
  idempotency_key text not null check (length(idempotency_key) between 8 and 200),
  provider_usage jsonb,
  safe_error text check (safe_error is null or length(safe_error) <= 500),
  output_deleted_at timestamptz,
  attempts integer not null default 0 check (attempts between 0 and 5),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (user_id, render_id),
  unique (user_id, idempotency_key),
  foreign key (user_id, project_id) references public.cloud_projects(user_id, project_id)
);
alter table public.render_jobs add column if not exists output_deleted_at timestamptz;
create index if not exists render_jobs_user_created_idx on public.render_jobs(user_id, created_at desc);

create table if not exists public.render_credit_ledger (
  ledger_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  credit_class text not null check (credit_class in ('medium', 'high')),
  quantity_delta integer not null check (quantity_delta <> 0),
  source_type text not null check (source_type in ('monthly_allowance', 'purchase', 'render_reservation', 'render_refund', 'admin_adjustment')),
  source_reference text not null,
  period_start timestamptz,
  period_end timestamptz,
  stripe_event_id text,
  render_job_id uuid references public.render_jobs(render_id) on delete set null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  unique (user_id, source_type, source_reference, credit_class)
);
create index if not exists render_credits_user_class_idx on public.render_credit_ledger(user_id, credit_class, created_at);

create table if not exists public.commercial_jobs (
  job_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_type text not null check (job_type in ('process-asset', 'render')),
  asset_id uuid references public.asset_definitions(asset_id) on delete cascade,
  render_id uuid references public.render_jobs(render_id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'processing', 'succeeded', 'failed', 'cancelled')),
  attempts integer not null default 0 check (attempts between 0 and 5),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text check (last_error is null or length(last_error) <= 500),
  created_at timestamptz not null default now(),
  check ((job_type = 'process-asset' and asset_id is not null and render_id is null) or
         (job_type = 'render' and render_id is not null and asset_id is null))
);
create index if not exists commercial_jobs_claim_idx on public.commercial_jobs(available_at, created_at) where status in ('queued', 'processing');

create table if not exists public.stripe_webhook_events (
  stripe_event_id text primary key,
  event_type text not null,
  processed_at timestamptz not null default now(),
  outcome text not null default 'processed' check (length(outcome) <= 100)
);

alter table public.commercial_profiles enable row level security;
alter table public.commercial_subscriptions enable row level security;
alter table public.cloud_projects enable row level security;
alter table public.asset_definitions enable row level security;
alter table public.upload_reservations enable row level security;
alter table public.render_jobs enable row level security;
alter table public.render_credit_ledger enable row level security;
alter table public.commercial_jobs enable row level security;
alter table public.stripe_webhook_events enable row level security;
alter table public.commercial_plans enable row level security;
alter table public.render_credit_packs enable row level security;

drop policy if exists plans_read_active on public.commercial_plans;
create policy plans_read_active on public.commercial_plans for select to anon, authenticated using (active);
drop policy if exists render_packs_read_active on public.render_credit_packs;
create policy render_packs_read_active on public.render_credit_packs for select to anon, authenticated using (active);

drop policy if exists profile_read_own on public.commercial_profiles;
create policy profile_read_own on public.commercial_profiles for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists profile_update_own on public.commercial_profiles;
create policy profile_update_own on public.commercial_profiles for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists subscription_read_own on public.commercial_subscriptions;
create policy subscription_read_own on public.commercial_subscriptions for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists projects_read_own on public.cloud_projects;
create policy projects_read_own on public.cloud_projects for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists assets_read_own on public.asset_definitions;
create policy assets_read_own on public.asset_definitions for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists renders_read_own on public.render_jobs;
create policy renders_read_own on public.render_jobs for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists credits_read_own on public.render_credit_ledger;
create policy credits_read_own on public.render_credit_ledger for select to authenticated using (user_id = (select auth.uid()));

revoke all on public.commercial_plans, public.render_credit_packs, public.commercial_profiles,
  public.commercial_subscriptions, public.cloud_projects, public.asset_definitions,
  public.upload_reservations, public.render_jobs, public.render_credit_ledger,
  public.commercial_jobs, public.stripe_webhook_events from anon, authenticated;
grant select on public.commercial_plans, public.render_credit_packs to anon, authenticated;
grant select on public.commercial_profiles, public.commercial_subscriptions,
  public.cloud_projects, public.asset_definitions, public.render_jobs, public.render_credit_ledger to authenticated;
grant update (display_name) on public.commercial_profiles to authenticated;

create or replace function public.commercial_usage(p_user_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'projects', (select count(*) from public.cloud_projects where user_id = p_user_id and deleted_at is null),
    'assets', (select count(*) from public.asset_definitions where user_id = p_user_id and processing_status <> 'deleted'),
    'storage_bytes',
      coalesce((select sum(byte_size) from public.cloud_projects where user_id = p_user_id and deleted_at is null), 0) +
      coalesce((select sum(original_byte_size + derived_byte_size) from public.asset_definitions where user_id = p_user_id and processing_status <> 'deleted'), 0) +
      coalesce((select sum(output_byte_size) from public.render_jobs where user_id = p_user_id and status = 'succeeded'), 0) +
      coalesce((select sum(expected_byte_size) from public.upload_reservations where user_id = p_user_id and purpose = 'asset' and status = 'reserved' and expires_at > now()), 0)
  )
$$;

create or replace function public.commercial_summary(p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  s public.commercial_subscriptions%rowtype;
  p public.commercial_plans%rowtype;
  v_usage jsonb;
  v_monthly_medium integer := 0;
  v_monthly_high integer := 0;
  v_paid_medium integer := 0;
  v_paid_high integer := 0;
begin
  select * into s from public.commercial_subscriptions where user_id = p_user_id;
  if not found or s.status not in ('active', 'trialing') or (s.current_period_end is not null and s.current_period_end < now()) then
    select * into p from public.commercial_plans where plan_key = 'free';
    s.plan_key := 'free';
  else
    select * into p from public.commercial_plans where plan_key = s.plan_key and active;
  end if;
  v_usage := public.commercial_usage(p_user_id);
  if s.plan_key <> 'free' then
    select coalesce(sum(quantity_delta), 0)::integer into v_monthly_medium
      from public.render_credit_ledger where user_id = p_user_id and credit_class = 'medium'
      and period_start = s.current_period_start and source_type in ('monthly_allowance','render_reservation','render_refund');
    select coalesce(sum(quantity_delta), 0)::integer into v_monthly_high
      from public.render_credit_ledger where user_id = p_user_id and credit_class = 'high'
      and period_start = s.current_period_start and source_type in ('monthly_allowance','render_reservation','render_refund');
  end if;
  select coalesce(sum(quantity_delta), 0)::integer into v_paid_medium from public.render_credit_ledger
    where user_id = p_user_id and credit_class = 'medium' and source_type in ('purchase','render_reservation','render_refund')
    and (source_type = 'purchase' or metadata->>'credit_origin' = 'purchased');
  select coalesce(sum(quantity_delta), 0)::integer into v_paid_high from public.render_credit_ledger
    where user_id = p_user_id and credit_class = 'high' and source_type in ('purchase','render_reservation','render_refund')
    and (source_type = 'purchase' or metadata->>'credit_origin' = 'purchased');
  return jsonb_build_object(
    'plan', p.plan_key, 'name', p.name, 'monthly_price_pence', p.monthly_price_pence,
    'status', case when p.plan_key = 'free' then 'free' else s.status end,
    'current_period_end', s.current_period_end, 'cancel_at_period_end', coalesce(s.cancel_at_period_end, false),
    'storage_limit_bytes', p.storage_limit_bytes, 'asset_limit', p.asset_limit, 'project_limit', p.project_limit,
    'included_medium', p.included_medium, 'included_high', p.included_high,
    'usage', v_usage,
    'medium_remaining', greatest(0, v_monthly_medium) + greatest(0, v_paid_medium),
    'high_remaining', greatest(0, v_monthly_high) + greatest(0, v_paid_high),
    'included_medium_remaining', greatest(0, v_monthly_medium),
    'included_high_remaining', greatest(0, v_monthly_high),
    'purchased_medium_remaining', greatest(0, v_paid_medium),
    'purchased_high_remaining', greatest(0, v_paid_high),
    'can_use_cloud', p.plan_key <> 'free', 'can_use_ai', p.plan_key <> 'free'
  );
end $$;

create or replace function public.save_cloud_project(
  p_user_id uuid, p_project_id uuid, p_schema_version integer, p_title text,
  p_project_json jsonb, p_expected_revision bigint
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  p public.commercial_plans%rowtype;
  existing public.cloud_projects%rowtype;
  v_size bigint;
  v_usage jsonb;
  v_exists boolean;
  v_restore boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  if p_project_json->>'projectId' is distinct from p_project_id::text or
     (p_project_json->>'schemaVersion')::integer is distinct from p_schema_version or p_schema_version <> 1 or
     p_project_json->>'units' is distinct from 'mm' or length(p_title) not between 1 and 200 then
    raise exception 'invalid_project_document' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_project_json->'assets','[]'::jsonb)) requested_asset
      where not exists (select 1 from public.asset_definitions a where a.user_id=p_user_id
        and a.local_asset_key=requested_asset->>'assetId' and a.processing_status='ready')
  ) then raise exception 'project_asset_not_ready' using errcode='55000'; end if;
  if octet_length(p_project_json::text) > 8388608 then raise exception 'project_too_large' using errcode = '22001'; end if;
  select * into p from public.commercial_plans where plan_key = (
    select plan_key from public.commercial_subscriptions where user_id = p_user_id
      and status in ('active','trialing') and (current_period_end is null or current_period_end >= now())
  ) and active;
  if not found or p.plan_key = 'free' then raise exception 'cloud_entitlement_required' using errcode = '42501'; end if;
  select * into existing from public.cloud_projects where user_id = p_user_id and project_id = p_project_id for update;
  v_exists := found;
  v_restore := v_exists and existing.deleted_at is not null;
  if v_exists then
    if v_restore then
      if p_expected_revision is not null then
        return jsonb_build_object('status','conflict','revision',null,'project_json',null);
      end if;
    else
      if p_expected_revision is null or existing.revision <> p_expected_revision then
        return jsonb_build_object('status','conflict','revision',existing.revision,'project_json',existing.project_json);
      end if;
    end if;
  elsif p_expected_revision is not null then
    return jsonb_build_object('status','conflict','revision',null,'project_json',null);
  end if;
  if (not v_exists or v_restore) and (select count(*) from public.cloud_projects where user_id=p_user_id and deleted_at is null) >= p.project_limit then
    raise exception 'project_quota_exceeded' using errcode = '54000';
  end if;
  v_size := octet_length(p_project_json::text);
  v_usage := public.commercial_usage(p_user_id);
  if (coalesce((v_usage->>'storage_bytes')::bigint,0) - case when v_restore then 0 else coalesce(existing.byte_size,0) end + v_size) > p.storage_limit_bytes then
    raise exception 'storage_quota_exceeded' using errcode = '54000';
  end if;
  if not v_exists then
    insert into public.cloud_projects(project_id,user_id,schema_version,title,project_json,revision,byte_size)
      values (p_project_id,p_user_id,p_schema_version,p_title,p_project_json,1,v_size) returning * into existing;
  else
    update public.cloud_projects set schema_version=p_schema_version,title=p_title,project_json=p_project_json,
      deleted_at=null,revision=revision+1,byte_size=v_size,updated_at=now() where project_id=p_project_id and user_id=p_user_id returning * into existing;
  end if;
  return jsonb_build_object('status','saved','project',to_jsonb(existing));
end $$;

create or replace function public.delete_cloud_project(p_user_id uuid,p_project_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare affected integer;
begin
  update public.cloud_projects set deleted_at=now(),title='Deleted project',project_json='{}'::jsonb,byte_size=0,updated_at=now()
    where user_id=p_user_id and project_id=p_project_id and deleted_at is null;
  get diagnostics affected = row_count;
  if affected=0 then return jsonb_build_object('status','not_found'); end if;
  return jsonb_build_object('status','deleted');
end $$;

create or replace function public.reserve_asset_upload(
  p_user_id uuid, p_asset_id uuid, p_reservation_id uuid, p_name text,
  p_format text, p_content_type text, p_object_key text, p_expected_bytes bigint, p_source_unit text,p_local_asset_key text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.commercial_plans%rowtype; v_usage jsonb; v_count bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  select * into p from public.commercial_plans where plan_key = (
    select plan_key from public.commercial_subscriptions where user_id=p_user_id
      and status in ('active','trialing') and (current_period_end is null or current_period_end >= now())
  ) and active;
  if not found or p.plan_key='free' then raise exception 'cloud_entitlement_required' using errcode='42501'; end if;
  if p_format not in ('glb','stl') or p_expected_bytes not between 20 and 104857600 or
     (p_format='stl' and p_source_unit not in ('mm','cm','in')) or length(p_name) not between 1 and 200 or
     (p_local_asset_key is not null and (p_format<>'glb' or p_local_asset_key !~ '^local-[a-f0-9]{64}$')) then
    raise exception 'invalid_asset_upload' using errcode='22023';
  end if;
  if p_local_asset_key is not null and exists (select 1 from public.asset_definitions where user_id=p_user_id and local_asset_key=p_local_asset_key and processing_status<>'deleted') then
    raise exception 'asset_already_uploaded' using errcode='23505';
  end if;
  select count(*) into v_count from public.asset_definitions where user_id=p_user_id and processing_status <> 'deleted';
  if v_count >= p.asset_limit then raise exception 'asset_quota_exceeded' using errcode='54000'; end if;
  v_usage := public.commercial_usage(p_user_id);
  if (coalesce((v_usage->>'storage_bytes')::bigint,0)+p_expected_bytes) > p.storage_limit_bytes then
    raise exception 'storage_quota_exceeded' using errcode='54000';
  end if;
  insert into public.asset_definitions(asset_id,user_id,local_asset_key,name,original_format,original_object_key,source_unit,processing_status)
    values (p_asset_id,p_user_id,p_local_asset_key,p_name,p_format,p_object_key,p_source_unit,'uploading');
  insert into public.upload_reservations(reservation_id,user_id,purpose,asset_id,object_key,content_type,expected_byte_size,expires_at)
    values (p_reservation_id,p_user_id,'asset',p_asset_id,p_object_key,p_content_type,p_expected_bytes,now()+interval '15 minutes');
  return jsonb_build_object('asset_id',p_asset_id,'reservation_id',p_reservation_id,'object_key',p_object_key,'expires_at',now()+interval '15 minutes');
end $$;

create or replace function public.soft_delete_asset(p_user_id uuid,p_asset_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.asset_definitions%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,0));
  select * into a from public.asset_definitions where asset_id=p_asset_id and user_id=p_user_id and processing_status<>'deleted' for update;
  if not found then return jsonb_build_object('status','not_found'); end if;
  if a.processing_status='uploading' and exists (
    select 1 from public.upload_reservations where asset_id=p_asset_id and user_id=p_user_id and purpose='asset'
      and status='reserved' and expires_at>now()
  ) then return jsonb_build_object('status','uploading'); end if;
  if exists (select 1 from public.commercial_jobs where asset_id=p_asset_id and user_id=p_user_id and status='processing') then
    return jsonb_build_object('status','processing');
  end if;
  if a.local_asset_key is not null and exists (
    select 1 from public.cloud_projects p, jsonb_array_elements(coalesce(p.project_json->'assets','[]'::jsonb)) requested_asset
      where p.user_id=p_user_id and p.deleted_at is null and requested_asset->>'assetId'=a.local_asset_key
  ) then return jsonb_build_object('status','in_use'); end if;
  update public.commercial_jobs set status='cancelled',locked_at=null,locked_by=null
    where asset_id=p_asset_id and user_id=p_user_id and status='queued';
  update public.upload_reservations set status='expired'
    where asset_id=p_asset_id and user_id=p_user_id and purpose='asset' and status='reserved';
  update public.asset_definitions set processing_status='deleted',local_asset_key=null,name='Deleted asset',content_hash=null,
    original_byte_size=0,derived_byte_size=0,triangle_count=null,computed_bounds_mm=null,declared_dimensions_mm=null,
    source_unit=null,processing_error=null,updated_at=now() where asset_id=p_asset_id and user_id=p_user_id;
  return jsonb_build_object('status','deleted','object_keys',jsonb_build_array(a.original_object_key,a.derived_object_key,a.thumbnail_object_key));
end $$;

create or replace function public.finalize_asset_upload(p_user_id uuid,p_asset_id uuid,p_actual_bytes bigint,p_content_hash text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.asset_definitions%rowtype; r public.upload_reservations%rowtype; v_usage jsonb; v_plan public.commercial_plans%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  select * into a from public.asset_definitions where asset_id=p_asset_id and user_id=p_user_id for update;
  if not found then raise exception 'asset_upload_not_found' using errcode='P0002'; end if;
  if a.processing_status <> 'uploading' then
    return jsonb_build_object('asset_id',a.asset_id,'processing_status',a.processing_status,'idempotent',true);
  end if;
  select * into r from public.upload_reservations where asset_id=p_asset_id and user_id=p_user_id and purpose='asset' and status='reserved' for update;
  if not found or r.expires_at < now() then raise exception 'upload_reservation_expired' using errcode='22023'; end if;
  if p_actual_bytes < 20 or p_actual_bytes > r.expected_byte_size or p_content_hash !~ '^[a-f0-9]{64}$' then
    update public.asset_definitions set processing_status='failed',
      original_byte_size=greatest(0,least(p_actual_bytes,104857600)),
      processing_error='Uploaded file did not match its reservation.',updated_at=now() where asset_id=p_asset_id;
    update public.upload_reservations set status='rejected' where reservation_id=r.reservation_id;
    return jsonb_build_object('status','rejected','asset_id',p_asset_id);
  end if;
  select * into v_plan from public.commercial_plans where plan_key=(select plan_key from public.commercial_subscriptions where user_id=p_user_id and status in ('active','trialing') and (current_period_end is null or current_period_end>=now())) and active;
  if not found then raise exception 'cloud_entitlement_required' using errcode='42501'; end if;
  v_usage := public.commercial_usage(p_user_id);
  if (coalesce((v_usage->>'storage_bytes')::bigint,0)-r.expected_byte_size+p_actual_bytes) > v_plan.storage_limit_bytes then
    raise exception 'storage_quota_exceeded' using errcode='54000';
  end if;
  update public.asset_definitions set content_hash=p_content_hash,original_byte_size=p_actual_bytes,
    processing_status='queued',updated_at=now() where asset_id=p_asset_id returning * into a;
  update public.upload_reservations set status='consumed' where reservation_id=r.reservation_id;
  insert into public.commercial_jobs(user_id,job_type,asset_id) values (p_user_id,'process-asset',p_asset_id);
  return jsonb_build_object('asset_id',a.asset_id,'processing_status',a.processing_status);
end $$;

create or replace function public.reserve_render_reference(
  p_user_id uuid,p_reservation_id uuid,p_object_key text,p_content_type text,p_expected_bytes bigint
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from public.commercial_subscriptions where user_id=p_user_id and status in ('active','trialing') and (current_period_end is null or current_period_end>=now())) then
    raise exception 'active_subscription_required' using errcode='42501';
  end if;
  if p_content_type not in ('image/png','image/jpeg','image/webp') or p_expected_bytes not between 1 and 10485760 then
    raise exception 'invalid_render_reference' using errcode='22023';
  end if;
  insert into public.upload_reservations(reservation_id,user_id,purpose,object_key,content_type,expected_byte_size,expires_at)
    values (p_reservation_id,p_user_id,'render-reference',p_object_key,p_content_type,p_expected_bytes,now()+interval '15 minutes');
  return jsonb_build_object('reservation_id',p_reservation_id,'object_key',p_object_key,'expires_at',now()+interval '15 minutes');
end $$;

create or replace function public.create_render_job(
  p_user_id uuid,p_render_id uuid,p_project_id uuid,p_reservation_id uuid,p_quality text,
  p_prompt text,p_idempotency_key text,p_provider_model text,p_size text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.commercial_subscriptions%rowtype; p public.commercial_plans%rowtype;
  r public.upload_reservations%rowtype; v_included integer; v_purchased integer; v_origin text;
  v_existing public.render_jobs%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,0));
  select * into v_existing from public.render_jobs where user_id=p_user_id and idempotency_key=p_idempotency_key;
  if found then return jsonb_build_object('status','existing','render',to_jsonb(v_existing)); end if;
  select * into s from public.commercial_subscriptions where user_id=p_user_id and status in ('active','trialing') and (current_period_end is null or current_period_end>=now());
  if not found then raise exception 'active_subscription_required' using errcode='42501'; end if;
  select * into p from public.commercial_plans where plan_key=s.plan_key and active;
  if p_quality not in ('medium','high') or length(p_prompt)>1000 then raise exception 'invalid_render_request' using errcode='22023'; end if;
  if p_project_id is not null and not exists (select 1 from public.cloud_projects where user_id=p_user_id and project_id=p_project_id and deleted_at is null) then
    raise exception 'project_not_found' using errcode='P0002';
  end if;
  select * into r from public.upload_reservations where reservation_id=p_reservation_id and user_id=p_user_id and purpose='render-reference' and status='reserved' and expires_at>=now() for update;
  if not found then raise exception 'render_reference_missing' using errcode='P0002'; end if;
  if p_quality='medium' then
    select coalesce(sum(quantity_delta),0)::integer into v_included from public.render_credit_ledger
      where user_id=p_user_id and credit_class='medium' and period_start=s.current_period_start and source_type in ('monthly_allowance','render_reservation','render_refund');
    select coalesce(sum(quantity_delta),0)::integer into v_purchased from public.render_credit_ledger
      where user_id=p_user_id and credit_class='medium' and source_type in ('purchase','render_reservation','render_refund') and (source_type='purchase' or metadata->>'credit_origin'='purchased');
  else
    select coalesce(sum(quantity_delta),0)::integer into v_included from public.render_credit_ledger
      where user_id=p_user_id and credit_class='high' and period_start=s.current_period_start and source_type in ('monthly_allowance','render_reservation','render_refund');
    select coalesce(sum(quantity_delta),0)::integer into v_purchased from public.render_credit_ledger
      where user_id=p_user_id and credit_class='high' and source_type in ('purchase','render_reservation','render_refund') and (source_type='purchase' or metadata->>'credit_origin'='purchased');
  end if;
  if v_included > 0 then v_origin := 'included';
  elsif v_purchased > 0 then v_origin := 'purchased';
  else raise exception 'render_credit_unavailable' using errcode='54000'; end if;
  insert into public.render_jobs(render_id,user_id,project_id,quality_class,provider_model,provider_quality,requested_size,
    reference_object_key,output_object_key,prompt,status,reserved_credit_source,idempotency_key)
    values (p_render_id,p_user_id,p_project_id,p_quality,p_provider_model,p_quality,p_size,r.object_key,
      'users/'||p_user_id::text||'/renders/'||p_render_id::text||'/output.webp',p_prompt,'queued',
      case when v_origin='included' then 'included' else 'purchased' end,p_idempotency_key)
    returning * into v_existing;
  insert into public.render_credit_ledger(user_id,credit_class,quantity_delta,source_type,source_reference,period_start,period_end,render_job_id,metadata)
    values (p_user_id,p_quality,-1,'render_reservation',p_render_id::text,
      case when v_origin='included' then s.current_period_start else null end,
      case when v_origin='included' then s.current_period_end else null end,p_render_id,jsonb_build_object('credit_origin',v_origin));
  update public.upload_reservations set status='consumed' where reservation_id=p_reservation_id;
  insert into public.commercial_jobs(user_id,job_type,render_id) values (p_user_id,'render',p_render_id);
  return jsonb_build_object('status','created','render',to_jsonb(v_existing));
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
    'render', case when j.render_id is null then null else (select to_jsonb(r) from public.render_jobs r where r.render_id=j.render_id and r.user_id=j.user_id) end
  );
end $$;

create or replace function public.finish_asset_processing(
  p_user_id uuid,p_asset_id uuid,p_status text,p_derived_key text,p_thumbnail_key text,
  p_derived_bytes bigint,p_triangles bigint,p_bounds jsonb,p_error text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.asset_definitions%rowtype; p public.commercial_plans%rowtype; u jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,0));
  select * into a from public.asset_definitions where asset_id=p_asset_id and user_id=p_user_id for update;
  if not found or a.processing_status not in ('queued','processing') then return jsonb_build_object('status','ignored'); end if;
  if p_status='ready' then
    if p_derived_bytes < 0 or p_triangles not between 0 and 2000000 or jsonb_typeof(p_bounds)<>'object' then raise exception 'invalid_processed_asset' using errcode='22023'; end if;
    select * into p from public.commercial_plans where plan_key=(select plan_key from public.commercial_subscriptions where user_id=p_user_id and status in ('active','trialing') and (current_period_end is null or current_period_end>=now())) and active;
    if not found then raise exception 'cloud_entitlement_required' using errcode='42501'; end if;
    u:=public.commercial_usage(p_user_id);
    if (coalesce((u->>'storage_bytes')::bigint,0)+p_derived_bytes)>p.storage_limit_bytes then
      update public.asset_definitions set processing_status='failed',processing_error='Processed files would exceed your storage allowance.',updated_at=now() where asset_id=p_asset_id;
      update public.commercial_jobs set status='failed',last_error='storage_quota_exceeded' where asset_id=p_asset_id and user_id=p_user_id and status='processing';
      return jsonb_build_object('status','quota_exceeded');
    end if;
    update public.asset_definitions set derived_object_key=p_derived_key,thumbnail_object_key=p_thumbnail_key,
      derived_byte_size=p_derived_bytes,triangle_count=p_triangles,computed_bounds_mm=p_bounds,
      geometry_authority='visual-only',processing_status='ready',processing_error=null,updated_at=now()
      where asset_id=p_asset_id returning * into a;
    update public.commercial_jobs set status='succeeded',locked_at=null,locked_by=null where asset_id=p_asset_id and user_id=p_user_id and status='processing';
  else
    update public.asset_definitions set processing_status='failed',processing_error=left(coalesce(p_error,'Asset processing failed.'),500),updated_at=now()
      where asset_id=p_asset_id returning * into a;
    update public.commercial_jobs set status='failed',last_error=left(coalesce(p_error,'Asset processing failed.'),500),locked_at=null,locked_by=null
      where asset_id=p_asset_id and user_id=p_user_id and status='processing';
  end if;
  return jsonb_build_object('status',a.processing_status,'asset',to_jsonb(a));
end $$;

create or replace function public.finish_render_job(
  p_user_id uuid,p_render_id uuid,p_output_bytes bigint,p_provider_usage jsonb,p_error text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.render_jobs%rowtype; p public.commercial_plans%rowtype; u jsonb; v_status text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,0));
  select * into r from public.render_jobs where render_id=p_render_id and user_id=p_user_id for update;
  if not found or r.status in ('succeeded','failed','cancelled') then return jsonb_build_object('status','ignored'); end if;
  if p_error is null and p_output_bytes between 1 and 52428800 then
    select * into p from public.commercial_plans where plan_key=(select plan_key from public.commercial_subscriptions where user_id=p_user_id and status in ('active','trialing') and (current_period_end is null or current_period_end>=now())) and active;
    if not found then p_error := 'AI rendering requires an active subscription.';
    else
      u:=public.commercial_usage(p_user_id);
      if (coalesce((u->>'storage_bytes')::bigint,0)+p_output_bytes)>p.storage_limit_bytes then p_error := 'Render output would exceed your storage allowance.'; end if;
    end if;
  else
    p_error := coalesce(p_error,'Render output is invalid or too large.');
  end if;
  if p_error is null then
    update public.render_jobs set status='succeeded',output_byte_size=p_output_bytes,provider_usage=coalesce(p_provider_usage,'{}'::jsonb),completed_at=now(),safe_error=null
      where render_id=p_render_id and user_id=p_user_id returning * into r;
    update public.commercial_jobs set status='succeeded',locked_at=null,locked_by=null where render_id=p_render_id and user_id=p_user_id and status='processing';
    v_status := 'succeeded';
  else
    update public.render_jobs set status='failed',completed_at=now(),safe_error=left(p_error,500)
      where render_id=p_render_id and user_id=p_user_id returning * into r;
    insert into public.render_credit_ledger(user_id,credit_class,quantity_delta,source_type,source_reference,period_start,period_end,render_job_id,metadata)
      select p_user_id,r.quality_class,1,'render_refund',r.render_id::text,period_start,period_end,r.render_id,
        jsonb_build_object('credit_origin',metadata->>'credit_origin')
      from public.render_credit_ledger where user_id=p_user_id and render_job_id=p_render_id and source_type='render_reservation'
      on conflict (user_id,source_type,source_reference,credit_class) do nothing;
    update public.commercial_jobs set status='failed',last_error=left(p_error,500),locked_at=null,locked_by=null where render_id=p_render_id and user_id=p_user_id and status='processing';
    v_status := 'failed';
  end if;
  return jsonb_build_object('status',v_status,'render',to_jsonb(r));
end $$;

-- Billing event application is a single database transaction. Event payloads
-- are not retained here; only the non-secret identifier/type/outcome is kept.
create or replace function public.apply_stripe_event(
  p_event_id text,p_event_type text,p_user_id uuid,p_customer_id text,p_subscription_id text,
  p_plan_key text,p_subscription_status text,p_period_start timestamptz,p_period_end timestamptz,
  p_cancel_at_period_end boolean,p_invoice_id text,p_credit_pack_key text,p_checkout_id text,
  p_event_created bigint,p_invoice_period_start timestamptz,p_invoice_period_end timestamptz
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare inserted integer; v_pack public.render_credit_packs%rowtype; v_plan public.commercial_plans%rowtype;
  v_user uuid; v_period_start timestamptz; v_period_end timestamptz;
begin
  insert into public.stripe_webhook_events(stripe_event_id,event_type) values(p_event_id,p_event_type)
    on conflict (stripe_event_id) do nothing;
  get diagnostics inserted = row_count;
  if inserted = 0 then return jsonb_build_object('status','duplicate'); end if;
  v_user := p_user_id;
  if v_user is null and p_customer_id is not null then
    select user_id into v_user from public.commercial_subscriptions where stripe_customer_id=p_customer_id;
  end if;
  if p_event_type in ('checkout.session.completed','checkout.session.async_payment_succeeded') and p_credit_pack_key is not null then
    if v_user is null or p_checkout_id is null then raise exception 'checkout_owner_missing' using errcode='22023'; end if;
    select * into v_pack from public.render_credit_packs where pack_key=p_credit_pack_key and active;
    if not found then raise exception 'unknown_render_pack' using errcode='22023'; end if;
    insert into public.render_credit_ledger(user_id,credit_class,quantity_delta,source_type,source_reference,stripe_event_id,metadata)
      values(v_user,v_pack.quality_class,v_pack.quantity,'purchase',p_checkout_id,p_event_id,jsonb_build_object('pack_key',p_credit_pack_key))
      on conflict (user_id,source_type,source_reference,credit_class) do nothing;
  elsif p_event_type in ('customer.subscription.created','customer.subscription.updated','customer.subscription.deleted','checkout.session.completed') then
    if v_user is not null and p_subscription_id is not null then
      if p_plan_key is null or p_subscription_status is null then raise exception 'subscription_projection_missing' using errcode='22023'; end if;
      insert into public.commercial_subscriptions(user_id,stripe_customer_id,stripe_subscription_id,plan_key,status,current_period_start,current_period_end,cancel_at_period_end,last_stripe_event_created,updated_at)
        values(v_user,p_customer_id,p_subscription_id,p_plan_key,p_subscription_status,p_period_start,p_period_end,coalesce(p_cancel_at_period_end,false),coalesce(p_event_created,0),now())
        on conflict (user_id) do update set stripe_customer_id=coalesce(excluded.stripe_customer_id,commercial_subscriptions.stripe_customer_id),
          stripe_subscription_id=excluded.stripe_subscription_id,plan_key=excluded.plan_key,status=excluded.status,
          current_period_start=excluded.current_period_start,current_period_end=excluded.current_period_end,
          cancel_at_period_end=excluded.cancel_at_period_end,last_stripe_event_created=excluded.last_stripe_event_created,updated_at=now()
        where excluded.last_stripe_event_created >= commercial_subscriptions.last_stripe_event_created;
    end if;
  elsif p_event_type='invoice.paid' and p_subscription_id is not null then
    if v_user is not null and p_plan_key in ('starter','pro','studio') and p_subscription_status in ('active','trialing','past_due','unpaid','canceled','paused') then
      insert into public.commercial_subscriptions(user_id,stripe_customer_id,stripe_subscription_id,plan_key,status,current_period_start,current_period_end,cancel_at_period_end,last_stripe_event_created,updated_at)
        values(v_user,p_customer_id,p_subscription_id,p_plan_key,p_subscription_status,p_period_start,p_period_end,coalesce(p_cancel_at_period_end,false),coalesce(p_event_created,0),now())
        on conflict (user_id) do update set stripe_customer_id=coalesce(excluded.stripe_customer_id,commercial_subscriptions.stripe_customer_id),
          stripe_subscription_id=excluded.stripe_subscription_id,plan_key=excluded.plan_key,status=excluded.status,
          current_period_start=excluded.current_period_start,current_period_end=excluded.current_period_end,
          cancel_at_period_end=excluded.cancel_at_period_end,last_stripe_event_created=excluded.last_stripe_event_created,updated_at=now()
        where excluded.last_stripe_event_created >= commercial_subscriptions.last_stripe_event_created;
    end if;
    select user_id,plan_key,current_period_start,current_period_end into v_user,p_plan_key,v_period_start,v_period_end
      from public.commercial_subscriptions where stripe_subscription_id=p_subscription_id for update;
    v_period_start := coalesce(p_invoice_period_start,v_period_start);
    v_period_end := coalesce(p_invoice_period_end,v_period_end);
    if v_user is not null and v_period_start is not null then
      select * into v_plan from public.commercial_plans where plan_key=p_plan_key and active;
      if v_plan.included_medium > 0 then
        insert into public.render_credit_ledger(user_id,credit_class,quantity_delta,source_type,source_reference,period_start,period_end,stripe_event_id,metadata)
          values(v_user,'medium',v_plan.included_medium,'monthly_allowance',p_subscription_id||':'||extract(epoch from v_period_start)::bigint||':medium',v_period_start,v_period_end,p_event_id,'{}'::jsonb)
          on conflict (user_id,source_type,source_reference,credit_class) do nothing;
      end if;
      if v_plan.included_high > 0 then
        insert into public.render_credit_ledger(user_id,credit_class,quantity_delta,source_type,source_reference,period_start,period_end,stripe_event_id,metadata)
          values(v_user,'high',v_plan.included_high,'monthly_allowance',p_subscription_id||':'||extract(epoch from v_period_start)::bigint||':high',v_period_start,v_period_end,p_event_id,'{}'::jsonb)
          on conflict (user_id,source_type,source_reference,credit_class) do nothing;
      end if;
    end if;
  elsif p_event_type='invoice.payment_failed' and v_user is not null then
    update public.commercial_subscriptions set status=coalesce(p_subscription_status,'past_due'),last_stripe_event_created=greatest(last_stripe_event_created,coalesce(p_event_created,0)),updated_at=now()
      where user_id=v_user and (p_subscription_id is null or stripe_subscription_id=p_subscription_id)
        and coalesce(p_event_created,0) >= last_stripe_event_created;
  end if;
  return jsonb_build_object('status','processed');
end $$;

revoke all on function public.commercial_usage(uuid), public.commercial_summary(uuid),
  public.save_cloud_project(uuid,uuid,integer,text,jsonb,bigint),
  public.delete_cloud_project(uuid,uuid),
  public.reserve_asset_upload(uuid,uuid,uuid,text,text,text,text,bigint,text,text),
  public.soft_delete_asset(uuid,uuid),
  public.finalize_asset_upload(uuid,uuid,bigint,text),
  public.reserve_render_reference(uuid,uuid,text,text,bigint),
  public.create_render_job(uuid,uuid,uuid,uuid,text,text,text,text,text),
  public.claim_commercial_job(text),
  public.finish_asset_processing(uuid,uuid,text,text,text,bigint,bigint,jsonb,text),
  public.finish_render_job(uuid,uuid,bigint,jsonb,text),
  public.apply_stripe_event(text,text,uuid,text,text,text,text,timestamptz,timestamptz,boolean,text,text,text,bigint,timestamptz,timestamptz)
  from public, anon, authenticated;
grant execute on function public.commercial_usage(uuid), public.commercial_summary(uuid),
  public.save_cloud_project(uuid,uuid,integer,text,jsonb,bigint),
  public.delete_cloud_project(uuid,uuid),
  public.reserve_asset_upload(uuid,uuid,uuid,text,text,text,text,bigint,text,text),
  public.soft_delete_asset(uuid,uuid),
  public.finalize_asset_upload(uuid,uuid,bigint,text),
  public.reserve_render_reference(uuid,uuid,text,text,bigint),
  public.create_render_job(uuid,uuid,uuid,uuid,text,text,text,text,text),
  public.claim_commercial_job(text),
  public.finish_asset_processing(uuid,uuid,text,text,text,bigint,bigint,jsonb,text),
  public.finish_render_job(uuid,uuid,bigint,jsonb,text),
  public.apply_stripe_event(text,text,uuid,text,text,text,text,timestamptz,timestamptz,boolean,text,text,text,bigint,timestamptz,timestamptz)
  to service_role;
