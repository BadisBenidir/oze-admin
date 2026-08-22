-- ============================================================================
-- Nettoyage : supprime debug_verify_array_agg_fix (0072), un helper de
-- diagnostic temporaire utilisé pour confirmer que le correctif 0070
-- fonctionne bien sur une ligne réelle.
-- ============================================================================

drop function if exists public.debug_verify_array_agg_fix();

notify pgrst, 'reload schema';
