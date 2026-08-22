-- ============================================================================
-- Nettoyage : supprime debug_rls_status (0074), un helper de diagnostic
-- temporaire utilisé pour confirmer que RLS était bien désactivé sur
-- orders/order_items avant de le corriger (0075).
-- ============================================================================

drop function if exists public.debug_rls_status();

notify pgrst, 'reload schema';
