-- Facture d'une commande web passée sans compte client (achat invité,
-- storefront) : pas de profil. Nécessaire pour la facture rectificative de
-- FA-2026-07-0001 (OZ-2026-5956, 0287). Les droits de lecture des revendeurs
-- restent fondés sur profile_id : une facture sans profil ne leur est jamais
-- visible.
alter table public.invoices alter column profile_id drop not null;
