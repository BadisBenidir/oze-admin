-- ============================================================================
-- Module B2B Revendeurs — 3/4 : vue catalogue à prix de gros
--
-- Possédée par le rôle `postgres` (comportement par défaut lors de la création
-- via l'éditeur SQL Supabase) : elle contourne donc le RLS de `products`, ce
-- qui lui permet d'exposer une lecture filtrée même si `products` interdit
-- l'accès direct au rôle `authenticated`. Ne PAS ajouter `security_invoker`.
--
-- Colonnes volontairement exclues : purchase_price, internal_comments,
-- serial_number, barcode (jamais exposées à un revendeur).
-- ============================================================================

create or replace view public.b2b_catalog as
select
  p.id,
  p.product_code,
  p.reference,
  p.name,
  p.brand_id,
  p.category_id,
  p.genre,
  p.weight,
  p.images,
  p.main_image_index,
  p.condition,
  p.description,
  p.colors,
  p.material,
  p.status,
  p.created_at,
  p.sale_price as catalog_price,
  r.discount_percent,
  round(p.sale_price * (1 - r.discount_percent / 100.0), 2) as wholesale_price
from public.products p
cross join lateral (
  select rs.discount_percent
  from public.reseller_contacts rc
  join public.resellers rs on rs.id = rc.reseller_id
  where rc.profile_id = auth.uid() and rs.status = 'active'
  limit 1
) r
where p.status = 'for-sale-online';

-- La sous-requête `cross join lateral` ne renvoie aucune ligne pour un
-- utilisateur qui n'est pas un contact revendeur actif : la vue retourne donc
-- 0 ligne pour tout le monde sauf un revendeur actif connecté (défense en
-- profondeur, en plus du GRANT ci-dessous).
grant select on public.b2b_catalog to authenticated;
