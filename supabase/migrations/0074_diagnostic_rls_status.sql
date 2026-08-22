-- ============================================================================
-- Diagnostic temporaire — supprimé par la migration suivante. Vérifie si RLS
-- est réellement ACTIVÉ (relrowsecurity) sur orders/order_items/shipments/
-- shipment_parcels, et liste les policies existantes sur ces tables — pour
-- confirmer/infirmer un signalement urgent de fuite de données entre
-- revendeurs.
-- ============================================================================

create or replace function public.debug_rls_status()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'tables', (
      select jsonb_agg(jsonb_build_object('table', c.relname, 'rls_enabled', c.relrowsecurity, 'rls_forced', c.relforcerowsecurity))
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname in ('orders', 'order_items', 'shipments', 'shipment_parcels')
    ),
    'policies', (
      select jsonb_agg(jsonb_build_object('table', tablename, 'policy', policyname, 'cmd', cmd, 'using', qual, 'with_check', with_check))
      from pg_policies
      where schemaname = 'public'
        and tablename in ('orders', 'order_items', 'shipments', 'shipment_parcels')
    )
  );
$$;

grant execute on function public.debug_rls_status() to service_role;

notify pgrst, 'reload schema';
