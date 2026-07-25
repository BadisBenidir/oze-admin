-- ============================================================================
-- Module B2B Revendeurs — 41 : préférences de livraison enregistrées
-- (adresse par défaut + point relais favori) pour accélérer le checkout.
--
-- - profiles.address/city/postal_code/country/phone existent déjà (0023) et
--   servent déjà à préremplir "Livrer à mon entreprise" — inchangés ici.
-- - delivery_instructions : instructions de livraison à domicile (étage,
--   digicode, etc.), nouveau champ.
-- - default_relay_point : point relais favori, même forme que
--   ChronopostPickupPoint côté client (code/name/network/address/city/
--   zipCode/country/lat/lng) — stocké tel quel en jsonb, jamais recalculé
--   côté serveur (juste un mémo pour préremplir le picker au checkout).
-- - default_delivery_type : lequel des deux (domicile/point_relais) le
--   revendeur veut voir présélectionné au checkout. Aucune des deux
--   informations n'est un engagement : le revendeur garde la main pour
--   changer à la volée sur cette commande précise (ShippingForm reste
--   éditable, ceci ne fait que fixer la valeur initiale).
--
-- Aucune policy RLS nouvelle : ces colonnes vivent sur `profiles`, dont la
-- policy de self-update existante (non trackée dans ce dépôt, partagée avec
-- oze-storefront — voir 0019) couvre déjà address/city/postal_code/country/
-- phone ; les nouvelles colonnes en héritent automatiquement.
-- ============================================================================

alter table public.profiles add column if not exists delivery_instructions text;
alter table public.profiles add column if not exists default_relay_point jsonb;
alter table public.profiles add column if not exists default_delivery_type text
  check (default_delivery_type in ('domicile', 'point_relais'));

notify pgrst, 'reload schema';
