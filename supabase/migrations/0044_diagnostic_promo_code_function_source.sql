-- ============================================================================
-- Diagnostic temporaire — supprimé par la migration suivante (0045) une fois
-- l'investigation terminée. Expose le corps SQL réel actuellement déployé de
-- validate_promo_code/record_promo_code_use, pour vérifier qu'il correspond
-- bien à la dernière migration (0034) et non à une version plus ancienne
-- restée active suite à un problème de synchronisation entre les deux
-- dépôts partageant cette base.
-- ============================================================================

create or replace function public.debug_function_source(p_function_name text)
returns text
language sql
security definer
set search_path = public
as $$
  select pg_get_functiondef(p_function_name::regproc);
$$;

grant execute on function public.debug_function_source(text) to service_role;

notify pgrst, 'reload schema';
