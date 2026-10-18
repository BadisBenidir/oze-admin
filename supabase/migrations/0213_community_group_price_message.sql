-- ============================================================================
-- Message personnalisé joint à un changement de prix programmé (0212) :
-- l'admin écrit, pour chaque groupe, un texte affiché aux membres concernés
-- dans la fenêtre d'annonce à la connexion (CommunityPriceNotice).
-- ============================================================================

alter table public.community_group_prices add column if not exists message text;

notify pgrst, 'reload schema';
