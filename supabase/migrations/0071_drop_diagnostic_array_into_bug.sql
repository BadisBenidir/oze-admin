-- ============================================================================
-- Nettoyage : supprime debug_array_into_pattern (0069), un helper de
-- diagnostic temporaire utilisé pour confirmer le bug corrigé en 0070.
-- ============================================================================

drop function if exists public.debug_array_into_pattern();

notify pgrst, 'reload schema';
