-- ============================================================================
-- Corrige l'accès découverte (0147) : les vues b2b_catalog et
-- b2b_reseller_product_detail (0135) vérifient rs.status = 'active' EN DUR
-- dans leur propre clause WHERE, indépendamment de current_reseller_id() —
-- 0147 n'avait mis à jour que cette dernière fonction, donc un compte
-- 'discovery' ne remontait aucune ligne dans ces deux vues : ni le
-- catalogue classique, ni les drops. Corps identique à 0135, seuls les
-- `rs.status = 'active'` deviennent `rs.status in ('active', 'discovery')`.
-- ============================================================================

create or replace view public.b2b_catalog as
select
  p.id, p.product_code, p.reference, p.b2b_reference, p.name, p.brand_id, p.category_id, p.genre,
  p.weight, p.images, p.main_image_index, p.condition, p.description, p.colors,
  p.material, p.status, p.created_at, p.sale_price as price,
  p.defects, p.defect_images,
  exists (
    select 1 from public.cart_items ci
    where ci.product_id = p.id
      and ci.user_id <> auth.uid()
      and ci.expires_at is not null and ci.expires_at > now()
  ) as held_by_other,
  p.original_price,
  (
    select d.scheduled_at
    from public.drops d
    where d.status = 'planifie' and p.id = any(d.product_ids)
    order by d.scheduled_at asc
    limit 1
  ) as drop_preview_scheduled_at
from public.products p
where (
  p.status = 'for-sale-b2b'
  and exists (
    select 1 from public.reseller_contacts rc
    join public.resellers rs on rs.id = rc.reseller_id
    where rc.profile_id = auth.uid() and rs.status in ('active', 'discovery')
  )
)
or (
  p.status in ('draft', 'draft-b2b', 'drop-b2b')
  and exists (
    select 1 from public.drops d
    where d.status = 'planifie' and p.id = any(d.product_ids)
  )
  and exists (
    select 1 from public.reseller_contacts rc
    join public.resellers rs on rs.id = rc.reseller_id
    where rc.profile_id = auth.uid() and rs.status in ('active', 'discovery') and rc.can_preview_drops = true
  )
);

grant select on public.b2b_catalog to authenticated;

create or replace view public.b2b_reseller_product_detail as
select
  p.id, p.product_code, p.reference, p.b2b_reference, p.name, p.brand_id, p.category_id, p.genre,
  p.weight, p.images, p.main_image_index, p.condition, p.description, p.colors,
  p.material, p.status, p.created_at, p.sale_price as price,
  p.defects, p.defect_images,
  exists (
    select 1 from public.cart_items ci
    where ci.product_id = p.id
      and ci.user_id <> auth.uid()
      and ci.expires_at is not null and ci.expires_at > now()
  ) as held_by_other,
  p.original_price,
  (
    select d.scheduled_at
    from public.drops d
    where d.status = 'planifie' and p.id = any(d.product_ids)
    order by d.scheduled_at asc
    limit 1
  ) as drop_preview_scheduled_at
from public.products p
where (
  p.status = 'for-sale-b2b'
  and exists (
    select 1 from public.reseller_contacts rc
    join public.resellers rs on rs.id = rc.reseller_id
    where rc.profile_id = auth.uid() and rs.status in ('active', 'discovery')
  )
)
or (
  p.status in ('draft', 'draft-b2b', 'drop-b2b')
  and exists (
    select 1 from public.drops d
    where d.status = 'planifie' and p.id = any(d.product_ids)
  )
  and exists (
    select 1 from public.reseller_contacts rc
    join public.resellers rs on rs.id = rc.reseller_id
    where rc.profile_id = auth.uid() and rs.status in ('active', 'discovery') and rc.can_preview_drops = true
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
