-- ============================================================================
-- Nettoyage : supprime debug_profiles_rls (0077), un helper de diagnostic
-- temporaire utilisé pour confirmer qu'un admin peut lire n'importe quel
-- profil (policy profiles_select_admin, gérée hors des migrations de ce
-- dépôt) avant d'ajouter le join shipments -> profiles.
-- ============================================================================

drop function if exists public.debug_profiles_rls();

notify pgrst, 'reload schema';
