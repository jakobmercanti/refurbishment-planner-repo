-- Remove customer records/narrative content from cloud planning copies.
-- Operators must review affected-row counts before applying to an existing dataset.
begin;
create function public.minimise_planning_document(value jsonb) returns jsonb
language plpgsql immutable strict set search_path = '' as $$
begin
  if jsonb_typeof(value)='object' then
    return coalesce((select jsonb_object_agg(key,case
      when key='annotations' then '[]'::jsonb
      when key in ('notes','note','description','email','telephone','phone','address','postcode',
                   'customerName','customerEmail','contact') and jsonb_typeof(item)='string' then '""'::jsonb
      else public.minimise_planning_document(item) end)
      from jsonb_each(value) as fields(key,item)
      where key not in ('quotes','plannerBuild','electricalLayout','renderCamera')),'{}'::jsonb);
  elsif jsonb_typeof(value)='array' then
    return coalesce((select jsonb_agg(public.minimise_planning_document(item) order by pos)
                     from jsonb_array_elements(value) with ordinality as items(item,pos)),'[]'::jsonb);
  end if;
  return value;
end;
$$;
revoke all on function public.minimise_planning_document(jsonb) from public,anon,authenticated;
grant execute on function public.minimise_planning_document(jsonb) to service_role;

-- Apply the same boundary to older API deployments and every future writer.
create function public.minimise_cloud_document_write() returns trigger
language plpgsql set search_path = '' as $$
begin
  if TG_TABLE_NAME='planner_resume' then
    new.document=public.minimise_planning_document(new.document);
  else
    new.project_json=public.minimise_planning_document(new.project_json);
    new.byte_size=octet_length(new.project_json::text);
  end if;
  return new;
end;
$$;
revoke all on function public.minimise_cloud_document_write() from public,anon,authenticated;
grant execute on function public.minimise_cloud_document_write() to service_role;
create trigger minimise_resume_write before insert or update of document on public.planner_resume
for each row execute function public.minimise_cloud_document_write();
create trigger minimise_project_write before insert or update of project_json on public.cloud_projects
for each row execute function public.minimise_cloud_document_write();

-- This is an auth trigger, never a browser-callable RPC.
revoke all on function public.create_commercial_profile() from public,anon,authenticated;

update public.planner_resume set document=public.minimise_planning_document(document),revision=revision+1
where document is not null and document is distinct from public.minimise_planning_document(document);
update public.cloud_projects set project_json=public.minimise_planning_document(project_json),revision=revision+1,
  byte_size=octet_length(public.minimise_planning_document(project_json)::text)
where deleted_at is null and project_json is distinct from public.minimise_planning_document(project_json);
commit;
