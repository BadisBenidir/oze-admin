-- ============================================================================
-- Diagnostic temporaire — supprimé par la migration suivante. Expose la
-- définition SQL réelle de b2b_order_item_revenue actuellement déployée,
-- pour vérifier qu'elle correspond bien à 0038 (LEFT JOIN products en
-- direct) et pas à une version antérieure (0037, snapshot figé) restée
-- active suite à un problème de cache/synchronisation.
-- ============================================================================

create or replace function public.debug_view_source(p_view_name text)
returns text
language sql
security definer
set search_path = public
as $$
  select pg_get_viewdef(p_view_name::regclass, true);
$$;

grant execute on function public.debug_view_source(text) to service_role;

notify pgrst, 'reload schema';
