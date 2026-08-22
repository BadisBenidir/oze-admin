-- ============================================================================
-- Diagnostic temporaire — supprimé par la migration suivante. Reproduit
-- isolément le motif exact utilisé dans admin_mark_items_received /
-- admin_mark_items_ready_to_ship (`update ... returning col into
-- array_var`) sur une requête sans effet de bord, pour confirmer avant
-- correctif si ce motif échoue silencieusement ou lève une erreur.
-- ============================================================================

create or replace function public.debug_array_into_pattern()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
begin
  -- Update inoffensif sur EXACTEMENT une ligne réelle (set = valeur
  -- identique, aucun changement sémantique) : on veut voir si "into v_ids"
  -- (déclaré uuid[]) échoue/se comporte mal quand au moins une ligne est
  -- réellement renvoyée par RETURNING, pas seulement le cas 0-ligne.
  update public.order_items oi
  set fulfillment_status = oi.fulfillment_status
  where oi.id = (select id from public.order_items limit 1)
  returning oi.id into v_ids;

  return jsonb_build_object('v_ids', to_jsonb(v_ids), 'is_null', v_ids is null);
end;
$$;

grant execute on function public.debug_array_into_pattern() to service_role;

notify pgrst, 'reload schema';
