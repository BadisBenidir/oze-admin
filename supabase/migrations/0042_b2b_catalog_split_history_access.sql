-- ============================================================================
-- Module B2B Revendeurs — 42 : sépare le catalogue parcourable de l'accès
-- "fiche produit après achat", pour que le bug du 2026-07-25 (produits
-- vendus/réservés/cadeaux visibles dans le catalogue B2B) devienne
-- STRUCTURELLEMENT impossible plutôt que dépendant d'un filtre client
-- qu'un futur développeur pourrait oublier de reproduire.
--
-- Incident : `b2b_catalog` (0035) avait volontairement un second bras
-- `or exists (... order_items ...)` pour qu'un revendeur puisse encore
-- consulter la fiche d'un produit déjà commandé après que son statut ait
-- changé (sold-b2b, cadeau-livre, etc.). useB2BCatalog.ts (le catalogue
-- PARCOURU) interrogeait cette même vue SANS filtre de statut explicite,
-- en comptant sur elle pour ne montrer que les articles en vente — ce
-- second bras faisait donc réapparaître dans le catalogue général tout
-- produit déjà commandé par ce revendeur, quel que soit son statut actuel.
--
-- Fix : `b2b_catalog` ne fait plus JAMAIS que `status = 'for-sale-b2b'` —
-- aucune requête dessus ne peut désormais recevoir un produit indisponible,
-- même sans filtre côté client. Le cas "revoir un produit déjà commandé"
-- est déplacé dans une vue dédiée, `b2b_reseller_product_detail`, utilisée
-- UNIQUEMENT par la fiche produit individuelle (useB2BProduct.ts), jamais
-- par une liste parcourue.
--
-- ⚠️ RÈGLE POUR TOUTE MODIFICATION FUTURE DE CES VUES : `b2b_catalog` ne
-- doit JAMAIS regagner de condition qui permette de renvoyer un produit
-- dont le statut n'est pas 'for-sale-b2b', même pour un cas d'usage qui
-- semble légitime (historique, favoris, etc.) — créez plutôt une nouvelle
-- vue dédiée à ce cas, comme `b2b_reseller_product_detail` ci-dessous.
-- ============================================================================

create or replace view public.b2b_catalog as
select
  p.id, p.product_code, p.reference, p.b2b_reference, p.name, p.brand_id, p.category_id, p.genre,
  p.weight, p.images, p.main_image_index, p.condition, p.description, p.colors,
  p.material, p.status, p.created_at, p.sale_price as price,
  p.defects, p.defect_images,
  exists (
    select 1 from public.b2b_cart_holds h
    where h.product_id = p.id
      and h.profile_id <> auth.uid()
      and h.expires_at > now()
  ) as held_by_other
from public.products p
where p.status = 'for-sale-b2b'
  and exists (
    select 1 from public.reseller_contacts rc
    join public.resellers rs on rs.id = rc.reseller_id
    where rc.profile_id = auth.uid() and rs.status = 'active'
  );

grant select on public.b2b_catalog to authenticated;

-- Fiche produit individuelle : même colonnes, mais accessible aussi pour un
-- produit déjà commandé par CE revendeur (quel que soit son statut actuel)
-- — jamais utilisée pour une liste parcourue, uniquement pour un lookup par
-- id depuis l'historique de commandes (useB2BProduct.ts).
create or replace view public.b2b_reseller_product_detail as
select
  p.id, p.product_code, p.reference, p.b2b_reference, p.name, p.brand_id, p.category_id, p.genre,
  p.weight, p.images, p.main_image_index, p.condition, p.description, p.colors,
  p.material, p.status, p.created_at, p.sale_price as price,
  p.defects, p.defect_images,
  exists (
    select 1 from public.b2b_cart_holds h
    where h.product_id = p.id
      and h.profile_id <> auth.uid()
      and h.expires_at > now()
  ) as held_by_other
from public.products p
where (
  p.status = 'for-sale-b2b'
  and exists (
    select 1 from public.reseller_contacts rc
    join public.resellers rs on rs.id = rc.reseller_id
    where rc.profile_id = auth.uid() and rs.status = 'active'
  )
)
or exists (
  select 1
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where oi.product_id = p.id
    and o.reseller_id = public.current_reseller_id()
);

grant select on public.b2b_reseller_product_detail to authenticated;

notify pgrst, 'reload schema';
