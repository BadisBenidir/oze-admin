-- ============================================================================
-- CORRECTIF DE SÉCURITÉ URGENT : RLS n'a jamais été activé sur `orders` /
-- `order_items` (confirmé en direct : pg_class.relrowsecurity = false sur les
-- deux tables), alors que des policies de scoping par revendeur existent et
-- sont correctement écrites depuis 0002/0011/0017 — elles étaient purement
-- décoratives, jamais appliquées. Concrètement : n'importe quel utilisateur
-- authentifié pouvait lire `order_items`/`orders` de N'IMPORTE QUEL
-- revendeur via le SDK client, sans aucune restriction.
--
-- Les policies existantes couvrent déjà le scoping revendeur (son propre
-- profil, ou toute l'entreprise s'il est le contact principal) mais
-- n'incluent PAS d'accès admin — contrairement à shipments/shipment_parcels
-- qui ont déjà les deux. On ajoute donc l'accès admin ici avant d'activer
-- RLS, pour ne pas casser les pages admin (Commandes B2B, Vue Réception,
-- Demandes de livraison, Comptabilité...).
--
-- Vérifié avant activation : aucune écriture directe (update/insert/delete)
-- côté client sur ces deux tables dans oze-admin ni oze-storefront — tout
-- passe par des RPC SECURITY DEFINER ou des edge functions en service_role,
-- qui contournent RLS de toute façon. Seules des policies SELECT sont donc
-- nécessaires ici.
-- ============================================================================

create policy "Admins can view all orders"
  on public.orders for select
  using (public.is_admin());

create policy "Admins can view all order items"
  on public.order_items for select
  using (public.is_admin());

alter table public.orders enable row level security;
alter table public.order_items enable row level security;
