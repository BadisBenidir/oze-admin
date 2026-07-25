-- ============================================================================
-- Nettoyage : supprime debug_function_source (0044), un helper de diagnostic
-- temporaire utilisé pour confirmer que validate_promo_code/
-- record_promo_code_use déployées correspondaient bien à la migration 0034
-- (confirmé : aucune dérive). Plus aucune utilité en production.
-- ============================================================================

drop function if exists public.debug_function_source(text);

notify pgrst, 'reload schema';
