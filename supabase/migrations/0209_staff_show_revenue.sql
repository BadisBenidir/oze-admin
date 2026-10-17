-- ============================================================================
-- Comptes employés (0208) : deux droits distincts pour les chiffres.
--   - show_figures  : prix d'achat, coûts et marges (fiches produit,
--                     sourcing, baisses de prix, drops, enchères…) ;
--   - show_revenue  : chiffre d'affaires (Dashboard, montants des ventes,
--                     CA B2B). Faux par défaut, y compris pour les employés
--                     existants : à ouvrir explicitement.
-- ============================================================================

alter table public.staff_permissions add column if not exists show_revenue boolean not null default false;

notify pgrst, 'reload schema';
