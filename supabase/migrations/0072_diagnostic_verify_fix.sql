-- ============================================================================
-- Diagnostic temporaire — supprimé par la migration suivante. Vérifie que le
-- motif corrigé (CTE + array_agg) ne reproduit pas l'erreur "malformed
-- array literal" observée avant le correctif 0070, sur la même ligne réelle.
-- ============================================================================

create or replace function public.debug_verify_array_agg_fix()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
begin
  with updated as (
    update public.order_items oi
    set fulfillment_status = oi.fulfillment_status
    where oi.id = (select id from public.order_items limit 1)
    returning oi.id
  )
  select array_agg(id) into v_ids from updated;

  return jsonb_build_object('v_ids', to_jsonb(v_ids), 'count', coalesce(array_length(v_ids, 1), 0));
end;
$$;

grant execute on function public.debug_verify_array_agg_fix() to service_role;

notify pgrst, 'reload schema';
