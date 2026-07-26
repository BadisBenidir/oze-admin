-- ============================================================================
-- Module B2B Revendeurs — 49 : expose products.original_price au catalogue
-- B2B, pour afficher le prix barré + la réduction (comme sur ozeparis.com).
--
-- b2b_catalog / b2b_reseller_product_detail (0042) ne sélectionnaient jamais
-- cette colonne — un admin pouvait renseigner "Prix d'origine (barré)" sur
-- la fiche produit, la valeur existait bien en base, mais n'atteignait
-- jamais le catalogue revendeur : aucune modification front ne pouvait
-- l'afficher tant qu'elle n'était pas dans la vue elle-même.
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
  ) as held_by_other,
  p.original_price
from public.products p
where p.status = 'for-sale-b2b'
  and exists (
    select 1 from public.reseller_contacts rc
    join public.resellers rs on rs.id = rc.reseller_id
    where rc.profile_id = auth.uid() and rs.status = 'active'
  );

grant select on public.b2b_catalog to authenticated;

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
  ) as held_by_other,
  p.original_price
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
