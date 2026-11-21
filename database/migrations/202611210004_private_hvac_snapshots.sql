-- Historical boundary packages contain nested JSON strings that can retain notes.
-- Keep those derived snapshots local; current geometry and shared inputs remain recoverable.
begin;
create or replace function public.minimise_planning_document(value jsonb) returns jsonb
language plpgsql immutable strict set search_path = '' as $$
begin
  if jsonb_typeof(value)='object' then
    return coalesce((select jsonb_object_agg(key,case
      when key='annotations' then '[]'::jsonb
      when key in ('notes','note','description','email','telephone','phone','address','postcode',
                   'customerName','customerEmail','contact') and jsonb_typeof(item)='string' then '""'::jsonb
      else public.minimise_planning_document(item) end)
      from jsonb_each(value) as fields(key,item)
      where key not in ('quotes','plannerBuild','electricalLayout','renderCamera','snapshots')),'{}'::jsonb);
  elsif jsonb_typeof(value)='array' then
    return coalesce((select jsonb_agg(public.minimise_planning_document(item) order by pos)
                     from jsonb_array_elements(value) with ordinality as items(item,pos)),'[]'::jsonb);
  end if;
  return value;
end;
$$;
revoke all on function public.minimise_planning_document(jsonb) from public,anon,authenticated;
grant execute on function public.minimise_planning_document(jsonb) to service_role;
update public.planner_resume set document=public.minimise_planning_document(document),revision=revision+1
where document is not null and document is distinct from public.minimise_planning_document(document);
update public.cloud_projects set project_json=public.minimise_planning_document(project_json),revision=revision+1,
  byte_size=octet_length(public.minimise_planning_document(project_json)::text)
where deleted_at is null and project_json is distinct from public.minimise_planning_document(project_json);
commit;
