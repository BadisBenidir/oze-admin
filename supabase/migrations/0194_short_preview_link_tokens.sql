-- ============================================================================
-- Liens d'avant-première plus courts : code de 10 caractères (au lieu de 64)
-- pour les NOUVEAUX liens, servis sur /p/<code> (PreviewLinkPage accepte aussi
-- l'ancien chemin /avant-premiere/<code>). Les liens existants gardent leur
-- code : ceux déjà partagés sur Discord restent valides.
-- 10 caractères hexadécimaux aléatoires ≈ 1 000 milliards de combinaisons,
-- largement assez pour des liens de prévisualisation (la contrainte unique
-- protège d'une collision).
-- ============================================================================

alter table public.preview_links
  alter column token set default substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);

notify pgrst, 'reload schema';
