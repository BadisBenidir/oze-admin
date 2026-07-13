-- ============================================================================
-- Module B2B Revendeurs — 10 : adresse de livraison au niveau du compte
--
-- L'adresse n'est plus saisie par le revendeur à chaque commande : elle est
-- configurée par l'admin OZË sur la fiche de l'entreprise (une seule adresse
-- par revendeur, partagée par le contact principal et ses sous-comptes).
-- ============================================================================

alter table public.resellers
  add column if not exists shipping_address jsonb;
