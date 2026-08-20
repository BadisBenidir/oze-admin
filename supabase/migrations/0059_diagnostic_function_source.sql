-- ============================================================================
-- Diagnostic temporaire — supprimé par la migration 0061. Expose la
-- définition SQL réelle d'une fonction déployée (pg_get_functiondef), pour
-- retirer chirurgicalement l'auto-assignation à delivery_batches de
-- confirm_b2b_payment / pay_b2b_order_with_wallet sans risquer de perdre la
-- logique existante (remises, assurance, code promo, paiement mixte...).
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
