-- ============================================================================
-- Nettoyage : supprime debug_view_source (0051), un helper de diagnostic
-- temporaire utilisé pour confirmer que b2b_order_item_revenue déployée
-- correspondait bien à la migration 0038 (confirmé : aucune dérive).
-- ============================================================================

drop function if exists public.debug_view_source(text);

notify pgrst, 'reload schema';
