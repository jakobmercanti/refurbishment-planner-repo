-- Personal asset taxonomy uses the existing built-in category tree without
-- inserting user models into the shared furniture catalogue.
alter table public.asset_definitions
  add column if not exists category_id text not null default 'custom',
  add column if not exists category_name text not null default 'Custom',
  add column if not exists subcategory text not null default 'General';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'asset_definitions_category_id_check') then
    alter table public.asset_definitions add constraint asset_definitions_category_id_check
      check (category_id ~ '^[a-z0-9][a-z0-9-]{0,79}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'asset_definitions_category_name_check') then
    alter table public.asset_definitions add constraint asset_definitions_category_name_check
      check (length(trim(category_name)) between 1 and 120);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'asset_definitions_subcategory_check') then
    alter table public.asset_definitions add constraint asset_definitions_subcategory_check
      check (length(trim(subcategory)) between 1 and 120);
  end if;
end $$;

create index if not exists asset_definitions_user_category_idx
  on public.asset_definitions(user_id, category_id, subcategory)
  where processing_status <> 'deleted';
